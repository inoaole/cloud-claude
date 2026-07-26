# cloud-claude v1.0 Terminal Resilience and Release Design

Date: 2026-07-26  
Branch: `sprint/7-v1-close`  
Status: Approved for implementation planning

## Goal

Ship cloud-claude v1.0 with two promises that hold in real use:

1. Today keeps a permanent daily history even after raw activity events expire.
2. A phone can lose its network, background the PWA, or receive a large terminal stream without
   losing the remote tmux session or starving the hub.

The v1.0 live acceptance scope is the Ubuntu hub, MacBook Pro, and iPhone. Mac mini and Desktop
remain visible as disabled/offline devices but are not release blockers.

## Scope

### Included

- Sprint 4 Terminal resilience and safety.
- Resource limits for the already-exposed Shell and Agent modes.
- Permanent `day_rollups` plus raw-event retention.
- Verification of the remaining Sprint 7 design carryovers.
- Full local, integration, security, phone, and live-hub QA.
- Documentation cleanup, version `1.0.0`, and production deployment.

### Excluded

- Agent inline approve/deny.
- Codex Agent mode.
- Agent conversation persistence or resume after a hub restart.
- Multiple named tmux sessions or concurrent terminal viewers.
- Mac mini and Desktop setup.
- Collector fan-out, Growth, calendar, web push, and file transfer.

Agent, Shell, and Terminal are supported v1.0 surfaces because they are already exposed in the
PWA and described as live in the README. The exclusions above remain v1.5 or later work.

## Architecture

### PTY session boundary

Add `hub/src/pty-session.js`. It owns live raw-terminal state and is independent of Express and
WebSocket upgrade authentication.

The manager is created with injected dependencies so its lifecycle can be tested without real
SSH, tmux, clocks, or sockets:

- PTY spawn and scrollback capture.
- Clock and timer functions.
- Resource limiter.
- Metadata-only audit callback.
- Configured limits.

It maintains one entry per device:

```text
deviceId -> {
  term,
  ws,
  state,
  outputBuffer,
  bufferedBytes,
  outputBytes,
  openedAt,
  lastInputAt,
  graceTimer,
  connectTimer,
  drainTimer
}
```

`hub/src/server.js` continues to own:

- PIN-session verification.
- single-use WebSocket token consumption.
- same-origin verification.
- device allowlist lookup.
- WebSocket upgrade and protocol selection.

After those checks, `/pty` delegates the live connection to the PTY session manager.

### State model

```text
STARTING -> ATTACHED -> DETACHED_GRACE -> ATTACHED
    |          |               |
    |          |               +-> CLOSED after 45 seconds
    |          +-> CLOSED on idle, output cap, process exit, or shutdown
    +-> CLOSED on connect timeout or spawn failure
```

- A device has one PTY relay and one active phone client.
- A new phone connection replaces the old socket and reuses the live PTY.
- A dropped socket enters `DETACHED_GRACE`; the PTY and SSH stay alive for 45 seconds.
- Output produced during the grace window is buffered in order.
- Reconnection flushes the buffer before resuming live output.
- Grace expiry kills only the local PTY/SSH relay. The remote `tmux phone` session survives.
- A later connection creates a fresh PTY and attaches to the surviving tmux session.
- Hub shutdown closes all local PTYs; remote tmux sessions remain the source of truth.

### Scrollback recovery

Short reconnects preserve the existing browser xterm instance and live PTY, so no replay is
needed.

After grace expiry or a hub restart:

1. Run a separate, fixed-argument `tmux capture-pane -p -S -300 -t phone` command.
2. Sanitize and send at most the most recent 300 lines.
3. Spawn the interactive PTY and attach with `tmux new -A -s phone`.
4. Let tmux redraw the current screen, including alternate-screen applications such as vim.

Add a safe `buildCaptureCommand()` beside `buildCommand()` in `hub/src/pty.js`. Device fields
remain allowlisted and validated. No user-controlled shell string is introduced.

Failure to capture scrollback is non-fatal. The live attach still proceeds and the failure is
audited as a reason code without command output.

## Terminal Data Flow

### Phone to PTY

The client sends JSON control frames:

- `{type:"stdin", data:string}`
- `{type:"resize", cols:number, rows:number}`

Rules:

- Input frames are measured as UTF-8 and capped at 64 KiB.
- Oversized input closes the socket with an explicit `input_too_large` reason.
- Resize remains clamped to 500 columns by 300 rows.
- Invalid JSON and unknown frame types are ignored and counted, not logged with their contents.
- An idle timer is reset by valid user input. Thirty minutes without input closes the relay while
  preserving tmux.

### PTY to phone

Every output chunk follows this order:

1. Preserve a trailing UTF-16 high surrogate until the next chunk.
2. Pass the text through the stateful terminal sanitizer.
3. Account for sanitized UTF-8 bytes.
4. Buffer or send the chunk in original order.
5. Apply flow control based on queued bytes.

No PTY output is intentionally dropped. If a limit is reached, the relay terminates with an
explicit reason and leaves tmux alive.

## Flow Control and Resource Limits

All defaults are configurable through environment variables and documented in `.env.example`.

| Limit | Default | Behavior |
|---|---:|---|
| Total live Device relays | 4 | Reject new relay as overloaded |
| Live PTY relays | 2 | Reject new PTY as overloaded |
| PTY reconnect grace | 45 seconds | Kill local relay after expiry |
| SSH/connect timeout | 15 seconds | Close failed connection |
| PTY idle timeout | 30 minutes without input | Kill local relay, keep tmux |
| Client input frame | 64 KiB | Close offending socket |
| PTY lifetime output | 64 MiB | End relay, keep tmux |
| High-water queued output | 256 KiB | Pause PTY reads |
| Low-water queued output | 64 KiB | Resume PTY reads |
| Sustained blocked output | 10 seconds | End relay, keep tmux |
| Recovered tmux scrollback | 300 lines | Truncate oldest lines |

For an attached client, WebSocket `bufferedAmount` drives the high- and low-water checks. For a
detached client, the in-memory reconnect buffer uses the same byte thresholds. `node-pty.pause()`
stops the read side at the high-water mark; `resume()` runs only after queued bytes fall below the
low-water mark.

The buffer may exceed the high-water mark by one incoming PTY chunk, but it never grows without
bound. If the client cannot drain within ten seconds, the relay closes instead of consuming more
hub memory.

## Terminal Output Sanitization

Add `hub/src/terminal-sanitize.js` as a streaming state machine.

- Strip every OSC sequence, including OSC 52 clipboard writes, terminal-title changes, and OSC 8
  hyperlinks.
- Recognize both BEL and ST terminators.
- Keep parser state across PTY chunks so splitting an escape sequence cannot bypass the filter.
- Preserve CSI sequences required for color, cursor movement, tmux, vim, and htop.
- Bound an unterminated OSC sequence to 8 KiB. Exceeding the bound discards that OSC and returns to
  normal text.
- Apply the same sanitizer to captured scrollback.

The backend is the security boundary. Browser-side xterm configuration is defense in depth only.

## Frontend Reconnection

`frontend/src/screens/Terminal.tsx` keeps one xterm instance while reconnecting.

- Add `reconnecting` to the connection status model.
- On an unexpected close, request a new single-use token and reconnect with backoff at 1, 2, and
  4 seconds, then remain disconnected with a retry affordance.
- Keep existing xterm scrollback during those attempts.
- Do not retry after an intentional component unmount.
- Map server close reasons to quiet, specific messages:
  - replaced by another tab
  - idle timeout
  - input too large
  - output limit
  - client too slow
  - hub overloaded
- A manual retry always obtains a fresh token.

The normal PWA route still opens Terminal from the selected online device. No new navigation or
session naming UI is added.

## Shell and Agent Hardening

Shell and Agent keep their current protocols and UI. They do not move into the PTY state machine.
A small shared `hub/src/relay-limits.js` provides counters and byte-limit helpers without unifying
the three bridge implementations.

### Shell

- Enforce one running command per Shell connection.
- Cap command text at 64 KiB.
- Cap output at 8 MiB per command and 64 MiB per connection.
- Pause child stdout when the client socket is backed up; resume after drain.
- Apply the global live-relay and idle limits.
- Do not write remote stderr content to audit logs.

### Agent

- Keep the existing 45-second reattach behavior.
- Cap prompt text at 64 KiB.
- Enforce at most two live Agent children and the global live-relay limit.
- Replace the current 500-message “drop oldest” buffer with byte-counted buffering.
- Pause child stdout at the high-water mark.
- If the buffer cannot drain or the lifetime output cap is reached, terminate the Agent process
  group and report a specific status.
- Keep malformed JSONL handling and the 1 MiB unterminated-line cap.
- Do not log Agent stderr contents.

Agent sessions remain in memory. A hub restart clearing them is an explicit v1.0 limitation.

## Audit and Error Handling

Audit events contain only:

- timestamp
- mode
- device id or Agent session id
- lifecycle event
- duration
- byte counts
- stable reason code

Terminal, command, prompt, stdout, stderr, cwd, and captured scrollback content are never logged.

Use private WebSocket close codes in the 4000–4099 range for expected application conditions and
standard codes for protocol failures:

| Condition | Close code |
|---|---:|
| Replaced by another tab | 4001 |
| Idle timeout | 4002 |
| Output cap | 4003 |
| Client too slow | 4005 |
| Hub relay limit | 4006 |
| Input too large | 1009 |
| Spawn/internal failure | 1011 |

Authentication and allowlist failures continue to be rejected during the HTTP upgrade, before a
WebSocket exists.

Reconnect-grace expiry is audited but has no close code: the phone socket is already gone when the
timer fires. A later connection simply creates a fresh PTY and reattaches to tmux.

## Permanent Rollups and Raw Retention

### Storage

Add:

```sql
CREATE TABLE day_rollups (
  date               TEXT NOT NULL,
  tz                 TEXT NOT NULL,
  summary            TEXT NOT NULL,
  source_event_count INTEGER NOT NULL,
  computed_at        INTEGER NOT NULL,
  PRIMARY KEY (date, tz)
);
```

`summary` stores the historical parts of `buildRollup`: commits, sessions, pulse, counts, and the
historical `normal` or `quiet` status. It does not store the mutable reflection note or a
present-time `offline` status.

The v1.0 archival timezone is the configured canonical `TZ`, currently `Asia/Seoul`. Raw dates may
still be queried in another valid timezone. After raw deletion, an archived request must match a
persisted `(date, tz)` row; otherwise the API returns `archived_tz_unavailable` instead of
silently returning the wrong day.

Notes remain in the permanent `notes` table and are overlaid when `/rollup` responds.

### Maintenance

Add a retention module with one transaction per local day:

1. Find complete canonical-timezone days whose end is at least 90 days old.
2. Compute or refresh their permanent rollup.
3. Continue refreshing days in the seven-day grace band so late delivery is reflected.
4. For a complete day whose end is at least 97 days old, upsert the final rollup and delete that
   day’s raw events in the same transaction.

Maintenance runs once at hub startup and then daily. It processes a bounded number of days per
pass and schedules another pass when a backlog remains, preventing a long synchronous SQLite job
from starving HTTP and WebSocket traffic.

`RETENTION_DELETE_ENABLED` defaults to `false`. When false, maintenance writes and refreshes
archives but does not delete raw rows. Production enables it only after archive parity has been
verified.

### Late events

An ingest batch is validated first. Events more than 97 days old by `ts_device` are counted as
expired and consumed without insertion. Valid newer events in the same batch are still inserted.
The `200` response becomes `{accepted, ignored, expired}` so the collector can consume the batch
without losing valid neighbors or retrying permanently expired data.

Schema-invalid events and cross-device events remain whole-batch `400` failures.

This gives the promised seven-day late-delivery grace and prevents a post-purge event from
silently replacing an already archived day with an incomplete recomputation.

### Reads

- If raw events exist for the requested day, `/rollup` recomputes from raw events as it does now.
- If raw events are gone and the matching archived row exists, `/rollup` returns the stored
  summary plus the current note.
- A genuinely empty historical day with neither raw events nor an archive remains `quiet`.
- Current-day liveness and sensor health always use raw events and are never served from an
  archive.

## Design Carryover Verification

Sprint 7 lists tab separation, disclosure edges, muted-text contrast, and project/heat tokens as
unfinished, while the React migration record says they already landed. Treat these as an audit:

1. Check implementation against `DESIGN.md`.
2. Add visual or component evidence where coverage is missing.
3. Fix only confirmed gaps.
4. Update `docs/SPRINTS.md` so one task has one truthful status.

No redesign is part of v1.0.

## Testing

### Unit tests

- PTY manager state transitions with fake clock, PTY, and WebSocket.
- Reattach inside grace and cleanup after grace.
- One active client replacement.
- Buffer ordering, pause/resume thresholds, blocked timeout, byte cap, and idle timeout.
- Split OSC 52, BEL/ST termination, unterminated OSC cap, CSI preservation, and Unicode chunk
  boundaries.
- Safe scrollback command construction for hub, Mac, and Tailscale SSH devices.
- Shell and Agent input, concurrency, byte, and flow-control limits.
- Rollup storage, refresh, transaction rollback, raw purge, expired mixed batches, archive reads,
  notes overlay, and canonical-timezone mismatch.

### Integration tests

- Upgrade rejection for missing auth, bad Origin, bad/used token, unknown device, and disabled
  device.
- Headless PTY echo and resize.
- Disconnect, output during grace, reconnect, ordered flush, and continued input.
- Fresh attach after grace with bounded capture replay.
- Slow WebSocket and sustained output flood without unbounded heap growth.
- Raw-to-archive rollup equality before and after purge.

### Frontend tests

- Automatic reconnect gets a fresh token for every attempt.
- Existing xterm instance survives retry.
- Retry stops on unmount.
- Close reason messages and manual retry.
- Existing Today, Machines, Shell, and Agent behavior remains green.

### Live acceptance

On the production tailnet:

1. iPhone opens Today and saves a reflection.
2. iPhone opens Terminal on the Ubuntu hub and MacBook Pro and runs an echo command.
3. Rotate the phone and verify resize.
4. Background the PWA and flap the network for less than 45 seconds; verify the same stream
   resumes.
5. Reconnect after more than 45 seconds; verify tmux and recent scrollback return.
6. Run vim or htop and verify tmux redraw.
7. Generate bounded output and verify the hub health endpoint remains responsive.
8. Verify unauthorized, bad-Origin, reused-token, and unknown-device paths are rejected.
9. Verify a retention fixture returns the same historical rollup before and after raw deletion.

Mac mini and Desktop are not part of these acceptance steps.

## Release and Rollback

1. Run all Hub, shared, collector, frontend, build, and Playwright suites.
2. Review the complete v1.0 diff, including security and visual review.
3. Update `VERSION`, Hub package version, README, sprint status, deployment docs, and commit logs.
4. Build the frontend locally.
5. Back up the production SQLite database before the schema migration.
6. Deploy Hub code and frontend assets atomically.
7. Restart the systemd service.
8. Verify `/healthz` reports `1.0.0`.
9. Run the live acceptance checks.

Rollback restores the prior Hub/frontend release and the pre-migration database backup. The
schema addition is backward-compatible, but the database backup remains mandatory because the
retention job can delete raw rows after archiving.

The production retention job is first deployed with deletion disabled. After archive parity is
verified on production data, enable deletion and run one bounded maintenance pass. This separates
schema/read-path validation from the first destructive retention action.

## Completion Criteria

v1.0 is complete only when:

- A short phone disconnect resumes the same PTY stream.
- A long disconnect returns to the same tmux session with bounded scrollback.
- Slow or noisy terminals cannot grow Hub memory without bound or starve `/healthz`.
- OSC 52 and other OSC output cannot reach the browser.
- Shell and Agent enforce explicit resource limits without dropping protocol events.
- Historical Today summaries survive raw deletion unchanged.
- All automated and live acceptance checks pass.
- Production reports version `1.0.0`.
- Mac mini and Desktop remain explicitly deferred rather than silently counted as tested.
