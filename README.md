# cloud-claude

> **A phone-first, self-hosted personal OS.** My devices are the sensors, my server is the
> brain, my phone is the window — and none of my data ever leaves my own machines.

Built for exactly one user (me). Every device I own quietly observes what I actually do —
git commits, agent sessions, activity pulse — and reflects it back each evening as an honest
summary of my day. And when I'm away from a computer, the same app *is* my computer: a real
terminal and a structured Claude Code session on any of my machines, from the phone.

```
                       ┌──────────────────────────────┐
                       │        iPhone (PWA)          │
                       │  Today · Timeline · Growth   │
                       │      Machines · Settings     │
                       └──────────────┬───────────────┘
                                      │  HTTPS + WSS, tailnet-only
                                      ▼
                       ┌──────────────────────────────┐
                       │     hub (always-on Linux)    │
                       │  single Node process, systemd │
                       │                              │
                       │  /rollup /note   ← Hub plane │
                       │  /ingest → SQLite timeline   │
                       │  /pty /run /agent ← Device   │
                       │       plane (WS relays)      │
                       └───────┬──────────────┬───────┘
              events (push)    │              │   ssh / tmux / claude
             ┌─────────────────┘              └──────────────────┐
             ▼                                                   ▼
   ┌───────────────────┐                              ┌───────────────────┐
   │  collector (mac)  │                              │  my machines      │
   │  launchd · 180s   │                              │  MacBook · mini   │
   │  git + heartbeat  │                              │  desktop · hub    │
   └───────────────────┘                              └───────────────────┘
```

## Two planes, one app

### 🪞 Hub plane — my day, reflected back
The **device-as-sensor** loop. A tiny collector runs on each machine (launchd, every 3 min,
fresh process — not a daemon): it diffs git repos against a watermark, emits a heartbeat, and
pushes events to the hub's append-only SQLite timeline. In the evening, the **Today** screen
derives the day on read: commits grouped by repo, an `~active 09:12–23:40` pulse line, and a
one-line reflection with a quiet ✓.

Honesty is a feature, not a tone:
- **quiet day** — the sensor ran and I really did nothing. Fine.
- **no data — offline** — the collector hasn't reported in 15 min. The summary may be incomplete.
- **sensor issue** — the git scan is failing. A broken sensor never masquerades as a quiet day.
- Durations are always shown as **estimates (`~`)** — poll-granularity truth, not fake precision.

### 🖥 Device plane — my machines, in my pocket
Pick a machine in **Machines** and open:
- **Agent** — a structured chat driving `claude -p --output-format stream-json` on the device
  itself (streaming text, tool-use chips, session list). The hub only pipes; credentials stay
  on each device.
- **Shell** — command blocks over a persistent login shell (one command = one output card).
- **Terminal** — a raw xterm.js tty into a persistent tmux session, for when only vim will do.

## Design language

Dark-first, SF Pro + SF Mono, a single Action Blue accent, iOS HIG grouped lists — and two
ideas carried through every screen: the **`~` estimate affordance** (never overclaim what a
poller observed) and **honest quiet** (an empty state names what's missing instead of
pretending). See [`DESIGN.md`](DESIGN.md).

## Security model

The repo is public; the system is not.

- **Tailnet-only.** Served via `tailscale serve` — HTTPS exists only inside my tailnet.
  Never Funnel, no public exposure.
- **Two separate credential paths.** Phone → PIN session (constant-time compare, lockout,
  HMAC-signed HttpOnly cookie). Collector → per-device bearer token that can *only* POST
  events for its own allowlisted device — no shell, no agent, minimal blast radius.
- **WebSockets don't trust cookies.** Each terminal/agent socket needs a 30-second single-use
  token plus an Origin check.
- **No shell strings.** Every remote command is `spawn(file, args)` with validated arguments;
  device identity comes from a gitignored allowlist (`devices.json`).
- **Nothing sensitive is committed.** Secrets live in `.env` / `devices.json` / local collector
  config (all gitignored); activity data lives only in the hub's SQLite.

## Stack

| Piece | Choice | Why |
|---|---|---|
| Hub | Node 20, single process (express + ws + node-pty + better-sqlite3, systemd) | one box, one process, supervised restart |
| Frontend | React 18 + TypeScript + Vite, CSS Modules, PWA | installable from the home screen, no app store |
| Collector | plain Node + launchd `StartInterval` | a fresh process per scan is crash-proof by construction |
| Storage | append-only SQLite (WAL), deterministic event ids | restarts and retries dedupe instead of duplicating |
| Network | Tailscale (`tailscale serve`, Tailscale SSH for Linux, classic ssh for Macs) | private by default |

## Repository layout

```
hub/         the always-on Node server (auth, relays, ingest, rollup)
frontend/    the React PWA (Vite; hub serves frontend/dist)
collector/   the device-side sensor (git scan + heartbeat + outbox)
shared/      event schema + validation, imported by hub AND collector
deploy/      systemd unit (hub) + launchd plist (collector) + deploy notes
docs/        sprint plan, workflow, per-commit logs
```

## Running it

This is a personal system, but every moving part is documented:

1. **Hub** — [`deploy/README.md`](deploy/README.md): systemd unit, `tailscale serve`, native
   module notes, deploy/rollback recipe.
2. **Collector** — [`collector/README.md`](collector/README.md): per-device token issuance,
   local config, launchd install, behavior notes (first-run baseline, outbox, re-baseline).
3. **Config shapes** — `.env.example`, `devices.example.json`, `collector/config.example.json`.

Tests run per package with zero infrastructure — `node --test` in `hub/`, `shared/`,
`collector/`; `npx vitest` in `frontend/` (147 tests at v0.8.0).

## Status

`v0.8.0` — both planes live. The daily loop (auto-captured day → evening reflection) and the
remote console (Terminal / Shell / Agent) work end-to-end on the real tailnet.

Next: the 7-evening habit test, session observation (`session_observed` via process scan),
permanent daily rollups + retention, and the Growth screen. The full plan lives in
[`docs/SPRINTS.md`](docs/SPRINTS.md).

---

*Solo-built with Claude Code, sprint by sprint — every commit has a log entry in
[`docs/git/commit-logs/`](docs/git/commit-logs/).*
