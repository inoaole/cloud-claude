# Commit Log — 2026-07-04 · session_observed (feat/session-observed)

- `feat(collector): observe claude/codex/tmux sessions — the timeline's second signal (v1b)`
  The Sprint 5 scope-split's second half, built AFTER the live process-scan spike it was gated on.
  A session is observed by poll-diff (`ps` executable basename → track in state → pid vanishes →
  emit ONCE with a deterministic id) and lands on the Today screen as a Sessions card with an
  honest `~duration`.
  - **Spike findings baked in as regression tests:** substring matching would drag in the Claude
    desktop app's 7 helpers + the `disclaimer` wrapper → match `ps -o comm=` basename only;
    codex `app-server` is a resident daemon, not a session → excluded via args; `lstart` parsed
    under LC_ALL=C. Plus a real-machine bug: lsof exits 1 even WITH output → recover err.stdout.
  - **Privacy:** cwd is a BASENAME only (schema rejects '/'), and the home dir reports null
    (its basename is the username). Full paths never go on the wire.
  - collector: scan.js (pure diffSessions: emit-on-end, ended=lastSeen observation bound, pid-reuse
    ±60s guard, tmux client+server collapsed to one), state.sessions persisted, scan errors fold
    into sensor health instead of killing the run.
  - hub: session_observed joins V1_KINDS (schema: tool whitelist, id/ts integrity); rollup gains
    sessions[] (attributed to the day the work BEGAN) and a session-only day is now "normal",
    not "quiet".
  - frontend: Sessions group above Commits (`claude ~2h 10m · cloud_claude · 14:09–16:20`).
  - Verified: 161 unit tests + live e2e (spawned claude → tracked → exited → emitted → live hub
    timeline + rollup show it; deploy sequenced hub-first with the collector paused so no
    session events hit the old schema). code-review: Approve, 2 nits folded.
