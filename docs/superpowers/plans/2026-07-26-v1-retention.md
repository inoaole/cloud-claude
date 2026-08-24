# v1 Permanent Rollups and Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Today summaries forever while expiring raw events after 90 days plus a seven-day late-delivery grace.

**Architecture:** Persist canonical-timezone historical summaries in `day_rollups`, refresh them while raw events remain, and delete a complete local day only after its final archive upsert succeeds in the same SQLite transaction. Keep current dates on the raw calculation path and consume events older than 97 days as explicit expirations.

**Tech Stack:** Node 20 ESM, better-sqlite3, `node:test`, existing rollup and ingest modules.

## Global Constraints

- Canonical archive timezone is `config.tz`, currently `Asia/Seoul`.
- Raw data is archived at 90 days and eligible for deletion after 97 days.
- Notes are permanent and never copied into `day_rollups`.
- Expired events in a mixed valid batch must not cause valid neighbors to be dropped.
- `RETENTION_DELETE_ENABLED` defaults to `false`.
- Every destructive production pass requires a verified database backup and archive parity check.

---

### Task 1: Day-rollup schema and storage helpers

**Files:**
- Modify: `hub/src/db.js`
- Modify: `hub/src/db.test.js`
- Create: `hub/src/day-rollups.js`
- Create: `hub/src/day-rollups.test.js`

**Interfaces:**
- Produces: `upsertDayRollup(db, { date, tz, now })`.
- Produces: `getDayRollup(db, date, tz)`.
- Produces: `countRawForDay(db, date, tz)`.

- [ ] **Step 1: Write failing migration and round-trip tests**

```js
test('day rollup round-trips historical summary without note', () => {
  const db = openDb(':memory:');
  seedNormalDay(db);
  const saved = upsertDayRollup(db, { date: '2026-07-02', tz: 'Asia/Seoul', now: NOW });
  assert.equal(saved.sourceEventCount, 3);
  const read = getDayRollup(db, '2026-07-02', 'Asia/Seoul');
  assert.equal(read.status, 'normal');
  assert.equal(read.note, undefined);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `cd hub && node --test src/day-rollups.test.js`  
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Add schema**

Append to `openDb()`:

```sql
CREATE TABLE IF NOT EXISTS day_rollups (
  date               TEXT NOT NULL,
  tz                 TEXT NOT NULL,
  summary            TEXT NOT NULL,
  source_event_count INTEGER NOT NULL,
  computed_at        INTEGER NOT NULL,
  PRIMARY KEY (date, tz)
);
```

- [ ] **Step 4: Implement storage helpers**

```js
export function countRawForDay(db, date, tz) {
  const [start, end] = localDayRange(date, tz);
  return db.prepare(
    'SELECT COUNT(*) AS n FROM events WHERE ts_device >= ? AND ts_device < ?',
  ).get(start, end).n;
}

export function upsertDayRollup(db, { date, tz, now }) {
  const summary = buildRollup(db, { date, tz, now });
  summary.status = summary.commitCount || summary.sessions.length ? 'normal' : 'quiet';
  summary.sensorDegraded = false;
  const sourceEventCount = countRawForDay(db, date, tz);
  db.prepare(`
    INSERT INTO day_rollups (date,tz,summary,source_event_count,computed_at)
    VALUES (@date,@tz,@summary,@sourceEventCount,@now)
    ON CONFLICT(date,tz) DO UPDATE SET
      summary=excluded.summary,
      source_event_count=excluded.source_event_count,
      computed_at=excluded.computed_at
  `).run({ date, tz, summary: JSON.stringify(summary), sourceEventCount, now });
  return { ...summary, sourceEventCount };
}

export function getDayRollup(db, date, tz) {
  const row = db.prepare(
    'SELECT summary FROM day_rollups WHERE date=? AND tz=?',
  ).get(date, tz);
  return row ? JSON.parse(row.summary) : null;
}
```

- [ ] **Step 5: Run storage tests**

Run: `cd hub && node --test src/day-rollups.test.js src/db.test.js src/rollup.test.js`  
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add hub/src/db.js hub/src/db.test.js hub/src/day-rollups.js hub/src/day-rollups.test.js
git commit -m "feat(retention): persist permanent daily rollups"
```

---

### Task 2: Archived rollup read path

**Files:**
- Modify: `hub/src/day-rollups.js`
- Modify: `hub/src/day-rollups.test.js`
- Modify: `hub/src/server.js`

**Interfaces:**
- Produces: `readRollup(db, { date, tz, now }) -> { status, body }`.
- Replaces direct `buildRollup()` call in `GET /rollup`.

- [ ] **Step 1: Add failing read-path tests**

Cover:

```js
test('prefers raw while present, then serves identical archive after deletion', () => {
  const before = readRollup(db, args).body;
  upsertDayRollup(db, args);
  deleteRawDay(db, args.date, args.tz);
  const after = readRollup(db, args).body;
  assert.deepEqual(after, before);
});

test('returns archived_tz_unavailable instead of a wrong archived day', () => {
  upsertDayRollup(db, { ...args, tz: 'Asia/Seoul' });
  deleteRawDay(db, args.date, 'Asia/Seoul');
  assert.deepEqual(readRollup(db, { ...args, tz: 'America/New_York' }), {
    status: 409, body: { error: 'archived_tz_unavailable' },
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `cd hub && node --test src/day-rollups.test.js`  
Expected: FAIL because `readRollup` is missing.

- [ ] **Step 3: Implement read selection**

`readRollup()` must:

1. validate date/tz;
2. use raw `buildRollup()` for today;
3. use raw `buildRollup()` when `countRawForDay() > 0`;
4. return exact archived row when present;
5. return 409 when another timezone row exists for that date;
6. otherwise return an empty historical `buildRollup()`.

The server route overlays `getNote(db, date)` after a successful result.

- [ ] **Step 4: Run Today backend tests**

Run: `cd hub && node --test src/day-rollups.test.js src/rollup.test.js src/notes.test.js`  
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add hub/src/day-rollups.js hub/src/day-rollups.test.js hub/src/server.js
git commit -m "feat(rollup): read permanent summaries after raw expiry"
```

---

### Task 3: Transactional retention maintenance

**Files:**
- Create: `hub/src/retention.js`
- Create: `hub/src/retention.test.js`

**Interfaces:**
- Produces: `runRetention(db, options) -> { archived, deleted, backlog }`.
- Consumes: `upsertDayRollup`, `countRawForDay`, `localDayRange`, `todayInTz`.

- [ ] **Step 1: Write failing retention tests**

Cover:

```js
test('refreshes 90-day archive but does not delete during grace', () => {
  const r = runRetention(db, { now: NOW, tz: 'Asia/Seoul', deleteEnabled: true });
  assert.equal(r.archived, 1);
  assert.equal(r.deleted, 0);
  assert.ok(countEvents(db) > 0);
});

test('upserts then deletes a 97-day complete day atomically', () => {
  const r = runRetention(db, { now: NOW_100_DAYS_LATER, tz: 'Asia/Seoul', deleteEnabled: true });
  assert.equal(r.deleted, 1);
  assert.equal(countEvents(db), 0);
  assert.ok(getDayRollup(db, DAY, 'Asia/Seoul'));
});

test('rollback preserves raw events when archive write throws', () => {
  assert.throws(() => runRetention(db, {
    now: NOW_100_DAYS_LATER, tz: 'Asia/Seoul', deleteEnabled: true,
    upsert: () => { throw new Error('boom'); },
  }));
  assert.ok(countEvents(db) > 0);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `cd hub && node --test src/retention.test.js`  
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement bounded daily maintenance**

Use constants:

```js
export const RAW_DAYS = 90;
export const GRACE_DAYS = 7;
export const DAY_MS = 86_400_000;
```

Query `ts_device` values below the 90-day cutoff, convert them with `todayInTz`, and deduplicate
local dates. For each date, read the current raw count and archived `source_event_count`. Process
the date when the archive is missing, the counts differ, or the day is old enough to delete.
The delete-eligible clause is mandatory: an unchanged archive created at day 90 must be visited
again after day 97. Process at most `maxDays = 32` dates per pass.

For each date, run:

```js
const archiveAndMaybeDelete = db.transaction((date) => {
  upsert(db, { date, tz, now });
  const [, end] = localDayRange(date, tz);
  if (deleteEnabled && end <= now - (RAW_DAYS + GRACE_DAYS) * DAY_MS) {
    const [start] = localDayRange(date, tz);
    db.prepare('DELETE FROM events WHERE ts_device >= ? AND ts_device < ?').run(start, end);
    return true;
  }
  return false;
});
```

Return `backlog: changedDates.length > maxDays`.

- [ ] **Step 4: Run retention tests**

Run: `cd hub && node --test src/retention.test.js src/day-rollups.test.js`  
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add hub/src/retention.js hub/src/retention.test.js
git commit -m "feat(retention): archive before purging raw event days"
```

---

### Task 4: Mixed-batch expired event handling

**Files:**
- Modify: `hub/src/ingest.js`
- Modify: `hub/src/ingest.test.js`
- Modify: `collector/src/outbox.test.js`

**Interfaces:**
- Produces: `MAX_EVENT_AGE_MS = 97 * 86400000`.
- Extends success body to `{ accepted, ignored, expired }`.

- [ ] **Step 1: Write failing mixed-batch tests**

```js
test('expired event is consumed while valid neighbor is inserted', () => {
  const ins = stubInsert();
  const old = { ...commit('old'), ts_device: NOW - MAX_EVENT_AGE_MS - 1 };
  old.payload = { ...old.payload, author_ts: old.ts_device };
  old.event_id = commitEventId(DEV, 'cloud-claude', 'old');
  const fresh = { ...commit('fresh'), ts_device: NOW, payload: { ...commit('fresh').payload, author_ts: NOW } };
  const r = handleIngest({
    devices, body: { device_id: DEV, events: [old, fresh] },
    authHeader: auth, insertFn: ins.fn, now: NOW,
  });
  assert.deepEqual(r.body, { accepted: 1, ignored: 0, expired: 1 });
  assert.deepEqual(ins.calls[0], [fresh]);
});
```

Update existing success and empty-batch expectations to include `expired: 0`. Collector outbox
still treats the 200 response as `ok`.

- [ ] **Step 2: Verify tests fail**

Run: `cd hub && node --test src/ingest.test.js`  
Expected: FAIL because expired events are inserted and response lacks `expired`.

- [ ] **Step 3: Partition after full validation**

After auth, shape, device, and schema validation:

```js
const cutoff = (now ?? Date.now()) - MAX_EVENT_AGE_MS;
const fresh = events.filter((e) => e.ts_device >= cutoff);
const expired = events.length - fresh.length;
if (fresh.length === 0) {
  return { status: 200, body: { accepted: 0, ignored: 0, expired } };
}
const { accepted, ignored } = insertFn(fresh, now ?? Date.now());
return { status: 200, body: { accepted, ignored, expired } };
```

- [ ] **Step 4: Run Hub and collector tests**

Run: `cd hub && node --test src/ingest.test.js`  
Run: `cd collector && npm test`  
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add hub/src/ingest.js hub/src/ingest.test.js collector/src/outbox.test.js
git commit -m "feat(ingest): consume events beyond retention grace"
```

---

### Task 5: Schedule retention safely

**Files:**
- Modify: `hub/src/config.js`
- Modify: `hub/src/server.js`
- Modify: `.env.example`
- Modify: `deploy/README.md`

**Interfaces:**
- Adds `config.retention = { deleteEnabled, intervalMs, maxDays }`.
- Runs once at startup, then every 24 hours with an unref timer.

- [ ] **Step 1: Add config values**

```js
retention: {
  deleteEnabled: process.env.RETENTION_DELETE_ENABLED === 'true',
  intervalMs: parseTtl(process.env.RETENTION_INTERVAL, 24 * 60 * 60_000),
  maxDays: Number(process.env.RETENTION_MAX_DAYS || 32),
},
```

Document defaults:

```dotenv
RETENTION_DELETE_ENABLED=false
RETENTION_INTERVAL=24h
RETENTION_MAX_DAYS=32
```

- [ ] **Step 2: Add a guarded runner**

```js
function maintainRetention() {
  try {
    const result = runRetention(db, {
      now: Date.now(), tz: config.tz,
      deleteEnabled: config.retention.deleteEnabled,
      maxDays: config.retention.maxDays,
    });
    audit('retention_complete', result);
    if (result.backlog) setTimeout(maintainRetention, 1000).unref();
  } catch (err) {
    audit('retention_error', { msg: String(err?.message || err) });
  }
}
maintainRetention();
setInterval(maintainRetention, config.retention.intervalMs).unref();
```

No summary or event contents enter these audits.

- [ ] **Step 3: Document two-phase production enablement**

`deploy/README.md` must require:

1. SQLite backup;
2. deploy with deletion false;
3. compare archived and raw `/rollup` fixtures;
4. set deletion true;
5. restart and inspect `retention_complete`.

- [ ] **Step 4: Run Hub tests and start a temporary Hub**

Run: `cd hub && npm test`  
Run: `HUB_PORT=8878 DB_FILE=:memory: node hub/src/server.js`  
Expected: `/healthz` responds and startup logs one metadata-only `retention_complete`; stop with
Ctrl-C.

- [ ] **Step 5: Commit**

```bash
git add hub/src/config.js hub/src/server.js .env.example deploy/README.md
git commit -m "feat(hub): schedule guarded retention maintenance"
```

---

### Task 6: Retention verification and documentation

**Files:**
- Modify: `docs/SPRINTS.md`
- Create: `docs/git/commit-logs/2026-07-26_permanent-rollups-retention.md`

**Interfaces:**
- Produces a green retention milestone with deletion still false by default.

- [ ] **Step 1: Run full backend tests**

Run:

```bash
(cd hub && npm test)
(cd shared && node --test)
(cd collector && npm test)
```

Expected: 0 failures.

- [ ] **Step 2: Run archive parity fixture**

Create a temporary database through the test helper, capture a historical `readRollup()` result,
run retention with deletion enabled at a 100-day clock, and deep-compare the result after purge.
This is the integration test in `hub/src/retention.test.js`, not a manual SQL edit.

Run: `cd hub && node --test src/retention.test.js --test-name-pattern="parity"`  
Expected: PASS.

- [ ] **Step 3: Update Sprint 7**

Mark the `day_rollups + raw retention` pair complete. Record that production deletion activation
remains a release task and is false by default.

- [ ] **Step 4: Add commit log and commit**

```bash
git add docs/SPRINTS.md docs/git/commit-logs/2026-07-26_permanent-rollups-retention.md
git commit -m "docs: record permanent rollup retention milestone"
```
