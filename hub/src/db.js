// SQLite timeline — the Hub-plane spine (Sprint 5, v1a). Append-only events table.
// better-sqlite3: synchronous (no callback churn), fast, and it compiles on the hub (node20).
// node:sqlite would be simpler but it's node22+ experimental and the hub is node20 — so it's out.
import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

/** Open (and create/migrate) the timeline db. Pass ':memory:' in tests. */
export function openDb(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL'); // readers (/timeline) don't block the writer (/ingest)
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      event_id       TEXT PRIMARY KEY,   -- deterministic → INSERT OR IGNORE = idempotent
      device_id      TEXT NOT NULL,
      kind           TEXT NOT NULL,
      ts_device      INTEGER NOT NULL,   -- epoch ms (device clock)
      ts_hub         INTEGER NOT NULL,   -- epoch ms (hub receive; the trusted tie-break)
      schema_version INTEGER NOT NULL,
      payload        TEXT NOT NULL       -- JSON, per-kind
    );
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts_device);
    CREATE INDEX IF NOT EXISTS idx_events_device_kind ON events(device_id, kind);
    CREATE INDEX IF NOT EXISTS idx_events_kind_ts ON events(kind, ts_device);

    -- One-line evening reflections (Sprint 6). MUTABLE (edited in place) — deliberately a
    -- separate table so the events log stays append-only observations. Kept forever.
    CREATE TABLE IF NOT EXISTS notes (
      date       TEXT PRIMARY KEY,   -- local date YYYY-MM-DD (one line per day of MY life)
      tz         TEXT NOT NULL,      -- tz the note was written in (metadata, not part of the key)
      text       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

/**
 * Insert a batch idempotently in ONE transaction (one fsync for the whole batch, not per-row).
 * `INSERT OR IGNORE` drops rows whose event_id already exists (restart/retry dedup).
 * Returns { accepted, ignored }.
 */
export function insertEvents(db, events, tsHub) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO events
      (event_id, device_id, kind, ts_device, ts_hub, schema_version, payload)
    VALUES (@event_id, @device_id, @kind, @ts_device, @ts_hub, @schema_version, @payload)
  `);
  const rows = events.map((e) => ({
    event_id: e.event_id,
    device_id: e.device_id,
    kind: e.kind,
    ts_device: e.ts_device,
    ts_hub: tsHub,
    schema_version: e.schema_version,
    payload: JSON.stringify(e.payload),
  }));
  const run = db.transaction((batch) => {
    let accepted = 0;
    for (const r of batch) accepted += stmt.run(r).changes; // changes = 1 inserted / 0 ignored
    return accepted;
  });
  const accepted = run(rows);
  return { accepted, ignored: rows.length - accepted };
}

/**
 * Read the timeline. Filters on REAL COLUMNS only (device/kind/ts range) — no JSON-field
 * querying into payload until the read model settles (Sprint 6). Tie-break the ordering with
 * ts_hub + event_id so a bad laptop clock (ts_device jump) can't scramble the sequence.
 */
export function queryTimeline(db, opts = {}) {
  const clauses = [];
  const params = {};
  if (opts.device) { clauses.push('device_id = @device'); params.device = opts.device; }
  if (opts.kind) { clauses.push('kind = @kind'); params.kind = opts.kind; }
  if (opts.since != null && Number.isFinite(opts.since)) { clauses.push('ts_device >= @since'); params.since = opts.since; }
  if (opts.until != null && Number.isFinite(opts.until)) { clauses.push('ts_device <= @until'); params.until = opts.until; }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 1000);
  const rows = db.prepare(`
    SELECT event_id, device_id, kind, ts_device, ts_hub, schema_version, payload
    FROM events ${where}
    ORDER BY ts_device DESC, ts_hub DESC, event_id
    LIMIT ${limit}
  `).all(params);
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
}
