# cloud-claude

My phone shows me the truth of my day — and I didn't have to write any of it.

I tried journaling. It lasted four days. The problem isn't discipline, it's that a journal asks
you to *remember* your day, and memory is a liar. But I'm a developer: my day already leaves
evidence — commits, agent sessions, terminal activity — scattered across four machines. So I
stopped asking myself what I did and started asking my devices.

**cloud-claude is a phone-first personal OS, self-hosted on my own hardware, where every device
I own is a sensor and none of my data ever leaves my tailnet.** In the evening I open one screen
and it shows me what actually happened. Then I write one line. That's the whole ritual.

```
Wednesday, July 2

cloud-claude
  190492a  chore(release): bump to 0.8.0 (Sprint 6 merged)
  1c3d111  Merge pull request #9 — Today evening reflection
  f3d73e6  feat(today): /rollup + /note + Today screen

           ~active 20:12–23:40 · 37 beats

┌────────────────────────────────────────────────┐
│  One line about today                    Save  │
└────────────────────────────────────────────────┘
```

Built solo with [Claude Code](https://docs.anthropic.com/en/docs/claude-code), sprint by sprint:
**v0.2 → v0.8 in 48 hours** — React migration, hardened PIN auth, device probes, a WebSocket
terminal relay, a structured Claude agent mode, the sensor pipeline, and the reflection screen.
9 PRs, 147 tests, every commit logged in [`docs/git/commit-logs/`](docs/git/commit-logs/).
The point isn't who typed it. It's what shipped.

## Two planes, one app

```
        iPhone PWA ── HTTPS/WSS, tailnet-only ──▶ hub (always-on, systemd)
                                                   │
   🪞 Hub plane      collector (launchd, 180s) ──▶ /ingest ─▶ SQLite timeline ─▶ /rollup ─▶ Today
   🖥 Device plane   /pty /run /agent ◀── ssh · tmux · claude -p stream-json ──▶ my machines
```

### 🪞 Hub plane — the day, reflected back

A tiny collector runs on each machine. Not a daemon — launchd fires a fresh process every
3 minutes: diff git repos against a watermark, emit a heartbeat, push to the hub, exit. Crash-proof
by construction. The hub stores events append-only with deterministic ids, so restarts and retries
**dedupe instead of duplicating**. Miss the hub? Events wait in an on-disk outbox and flush later.
Nothing observed is ever lost.

The Today screen derives the day on read and tells the truth about it:

| It says | It means |
|---|---|
| `quiet day` | the sensor ran; I genuinely did nothing. Allowed. |
| `no data — offline` | the collector hasn't reported in 15 min — the summary may be incomplete |
| `sensor issue` | the git scan is failing. A broken sensor **never** masquerades as a quiet day |
| `~active 09:12–23:40` | always `~`. A poller sees snapshots; the UI never fakes precision |

### 🖥 Device plane — my machines, in my pocket

No laptop, doesn't matter. Machines tab → pick a box →

- **Agent** — structured chat driving `claude -p --output-format stream-json` *on the device
  itself*. Streaming text, tool-use chips, killable sessions. The hub only pipes bytes;
  Claude credentials never leave each machine.
- **Shell** — command blocks over a persistent login shell. One command, one card, one exit code.
- **Terminal** — raw xterm.js into a persistent tmux session, for when only vim will do.

## The repo is public. The system is not.

- **Tailnet-only.** `tailscale serve` — the HTTPS endpoint exists only inside my private network.
  Never Funnel.
- **Split credentials.** Phone → PIN session (constant-time compare, lockout, HMAC cookie).
  Collector → per-device bearer token that can *only* post its own device's events. A leaked
  token buys an attacker my commit subjects, not a shell.
- **WebSockets don't trust cookies.** Every socket needs a 30-second single-use token + Origin check.
- **No shell strings, ever.** Remote commands are `spawn(file, args)` with validated argv against
  a gitignored device allowlist.

## Stack — boring on purpose

| Piece | Choice | Why |
|---|---|---|
| Hub | one Node 20 process — express + ws + node-pty + better-sqlite3, under systemd | one box, one process, auto-restart |
| Frontend | React 18 + TS + Vite PWA, CSS Modules, zero UI framework | home-screen install, no app store, dark HIG |
| Collector | plain Node + launchd `StartInterval` | fresh process per scan = nothing to keep alive |
| Storage | append-only SQLite (WAL) + deterministic event ids | idempotency as a table constraint, not app logic |
| Network | Tailscale | private by default beats hardened-public |

```
hub/         auth, WS relays, ingest, rollup     collector/   git scan · heartbeat · outbox
frontend/    the PWA                             shared/      one schema, imported by both sides
deploy/      systemd unit + launchd plist        docs/        sprints, workflow, commit logs
```

Tests need zero infrastructure: `node --test` in `hub/` `shared/` `collector/`, `vitest` in
`frontend/`. Run instructions: [`deploy/README.md`](deploy/README.md) ·
[`collector/README.md`](collector/README.md).

## Status

`v0.8.0` — both planes live on the real tailnet. The current experiment isn't code: **open the
Today screen seven evenings straight.** If the loop survives a week, next comes session
observation (`ps`-scan → agent sessions on the timeline), permanent daily rollups + retention,
and the Growth screen. Full plan: [`docs/SPRINTS.md`](docs/SPRINTS.md).

Built for exactly one user. Fork the ideas, not the config.
