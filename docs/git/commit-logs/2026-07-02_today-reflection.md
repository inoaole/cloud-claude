# Commit Log — 2026-07-02 · Today evening reflection (feature/v0.8.0/today-reflection)

- `feat(today): evening reflection — GET /rollup + POST /note + Today screen (Sprint 6)`
  The first screen where the Sprint 5 pipeline becomes a product: open the app in the evening →
  an honest auto-summary of today (commits by repo + `~active` pulse) → write one line → quiet ✓.
  - **hub/src/rollup.js**: day summary derived ON READ (no cache — late events recompute free).
    Hand-rolled 2-pass Intl TZ math (`localDayRange` half-open, DST 23h/25h exact; `todayInTz`
    judges "today" in the REQUEST tz, never the hub clock). Own aggregate SQL (heartbeat GROUP BY
    device — a 1000+ beat day can't truncate; commits deduped by repoId+sha). Commit belongs to
    its AUTHOR day (D5). Liveness = `now − MAX(ts_hub) < 15min` (device clocks untrusted);
    past dates never claim offline; `sensorDegraded` when the latest heartbeat reports failed
    git scans (a broken scanner can't masquerade as a quiet day).
  - **hub/src/notes.js** + notes table (db.js): one MUTABLE line per local date (events table
    stays append-only). UPSERT; newlines/control chars normalized server-side; 500 code points.
  - **server.js**: `GET /rollup` (PIN; embeds the note = one fetch) + `POST /note` (PIN).
  - **collector**: heartbeat payload gains `{reposOk, reposFailed}` sensor health.
  - **frontend**: Today.tsx rewrite (A/Journal) — commits grouped by repo, `~active` pulse line,
    status language quiet/offline/sensor-issue + browser-offline banner, one-line composer with
    quiet-check save, midnight rollover recompute on tab focus, save failure keeps the text.
  - Plan eng-reviewed + codex outside voice (D3–D8 locked; retention purge deliberately moved to
    Sprint 7 paired with day_rollups — codex caught the "purge + no cache = rollups forever"
    contradiction). code-review: 1 important fixed (date header formatted in UTC — tz projection
    shifted the weekday for UTC+13/+14).
  - Tests: hub 85 (rollup 17 + notes 7 new) · shared 8 · collector 20 · frontend 34 (Today 7 new),
    tsc + vite build clean, live HTTP e2e (ingest → rollup → note upsert → re-read, 400/401 paths).
