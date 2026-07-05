import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, insertEvents, queryTimeline } from './db.js';
import { SCHEMA_VERSION, commitEventId, heartbeatEventId } from '../../shared/schema.js';

const DEV = 'macbook-pro';
function commit(sha, tsDevice) {
  return {
    event_id: commitEventId(DEV, 'cloud-claude', sha),
    device_id: DEV, kind: 'commit_seen', ts_device: tsDevice, schema_version: SCHEMA_VERSION,
    payload: { repoId: 'cloud-claude', sha, subject: `c ${sha}`, author_ts: tsDevice },
  };
}
function heartbeat(ts) {
  return {
    event_id: heartbeatEventId(DEV, ts), device_id: DEV, kind: 'heartbeat',
    ts_device: ts, schema_version: SCHEMA_VERSION, payload: {},
  };
}

test('insert then query round-trips (payload parsed)', () => {
  const db = openDb(':memory:');
  const r = insertEvents(db, [commit('a', 1000), heartbeat(2000)], 5000);
  assert.deepEqual(r, { accepted: 2, ignored: 0 });
  const rows = queryTimeline(db, {});
  assert.equal(rows.length, 2);
  const c = rows.find((e) => e.kind === 'commit_seen');
  assert.equal(c.payload.sha, 'a');
  assert.equal(c.ts_hub, 5000);
});

test('INSERT OR IGNORE dedups on event_id (idempotent)', () => {
  const db = openDb(':memory:');
  insertEvents(db, [commit('a', 1000)], 5000);
  const again = insertEvents(db, [commit('a', 1000), commit('b', 1100)], 6000);
  assert.deepEqual(again, { accepted: 1, ignored: 1 }); // 'a' dup ignored, 'b' new
  assert.equal(queryTimeline(db, {}).length, 2);
});

test('ordering: ts_device DESC with ts_hub tie-break', () => {
  const db = openDb(':memory:');
  // same ts_device, different ts_hub → ts_hub decides
  insertEvents(db, [commit('a', 1000)], 100);
  insertEvents(db, [commit('b', 1000)], 200);
  insertEvents(db, [commit('c', 3000)], 50);
  const order = queryTimeline(db, {}).map((e) => e.payload.sha);
  assert.deepEqual(order, ['c', 'b', 'a']); // c newest ts_device; b before a via ts_hub
});

test('filters by device, kind, and ts range', () => {
  const db = openDb(':memory:');
  insertEvents(db, [commit('a', 1000), commit('b', 2000), heartbeat(1500)], 9000);
  assert.equal(queryTimeline(db, { kind: 'commit_seen' }).length, 2);
  assert.equal(queryTimeline(db, { kind: 'heartbeat' }).length, 1);
  assert.equal(queryTimeline(db, { since: 1600 }).length, 1); // only b(2000) ≥ 1600
  assert.equal(queryTimeline(db, { since: 1400, until: 1800 }).length, 1); // only hb(1500)
  assert.equal(queryTimeline(db, { device: 'other' }).length, 0);
});

test('limit is clamped to [1,1000]', () => {
  const db = openDb(':memory:');
  insertEvents(db, [commit('a', 1000), commit('b', 2000), commit('c', 3000)], 9000);
  assert.equal(queryTimeline(db, { limit: 2 }).length, 2);
  assert.equal(queryTimeline(db, { limit: 0 }).length, 3);   // 0 → default 200, all 3 returned
});
