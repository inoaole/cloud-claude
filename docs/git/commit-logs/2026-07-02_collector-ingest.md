# Commit Log — 2026-07-02 · Hub plane collector → ingest → timeline (feature/v0.7.0/collector-ingest)

- `feat(collector): device-as-sensor collector → hub /ingest → SQLite timeline (Sprint 5 v1a)`
  The Hub plane's first data pipeline. A macOS **collector** (launchd, one scan per run, not
  resident) scans configured git repos + emits a heartbeat and POSTs events to the always-on hub's
  **`POST /ingest`**, which validates + stores them in an append-only **better-sqlite3** timeline
  (WAL); the phone reads **`GET /timeline`** behind the PIN.
  - **shared/schema.js** filled in: per-kind `validateEvent` (commit_seen/heartbeat) + deterministic
    `event_id` builders, `V1_KINDS`, event_id↔payload integrity. Imported by both sides (`shared/`
    is now `type:module`) so hub + collector can't drift.
  - **hub/src/db.js** (better-sqlite3, WAL, `INSERT OR IGNORE` batch in one transaction = idempotent),
    **ingest.js** (pure `handleIngest`; Bearer per-device token via `crypto.timingSafeEqual`;
    honors `enabled:false` kill switch), routes `POST /ingest` (64kb scoped parser) + `GET /timeline`
    (real-column filters, `ts_device,ts_hub,event_id` ordering).
  - **collector/** — `index.js` (1-pass runOnce), `git.js` (`<lastSha>..HEAD` range NOT `--since`;
    first-run baseline = no backfill; rebase/gc → re-baseline), `outbox.js` (atomic flush; auth/5xx →
    keep so a bad token never loses data, only 400 → drop; 10s fetch timeout), `state.js`
    (atomic tmp+rename). launchd plist template + README + config.example.
  - **Scope (v1a, locked):** commit_seen + heartbeat only, MacBook Pro. session_observed = v1b after
    a process-scan spike. Plan + reviews: eng-review + codex outside-voice (R1–R4 + C1–C6 folded);
    project code-review Approve (3 [important] fixed: outbox auth data-loss, fetch timeout, enabled
    kill switch).
  - **Verified:** 87 unit tests (hub 61, shared 8, collector 18) + full e2e (real hub + collector
    over HTTP): baseline no-backfill, commit_seen, idempotent re-send, bad token 401, kind reject
    400, hub-down → outbox → up → flush, /timeline read.
