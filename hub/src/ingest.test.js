import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleIngest, bearer, tokenMatches, INGEST_MAX } from './ingest.js';
import { SCHEMA_VERSION, commitEventId, heartbeatEventId } from '../../shared/schema.js';

const DEV = 'macbook-pro';
const TOKEN = 'tok-secret-abc';
const devices = [
  { id: DEV, ingestToken: TOKEN },
  { id: 'notoken' },
  { id: 'disabled', ingestToken: TOKEN, enabled: false },
];

const commit = (sha) => ({
  event_id: commitEventId(DEV, 'cloud-claude', sha),
  device_id: DEV, kind: 'commit_seen', ts_device: 1700000000000, schema_version: SCHEMA_VERSION,
  payload: { repoId: 'cloud-claude', sha, subject: 's', author_ts: 1700000000000 },
});
// insertFn stub records what it was handed and reports all-accepted.
function stubInsert() {
  const calls = [];
  const fn = (events) => { calls.push(events); return { accepted: events.length, ignored: 0 }; };
  return { fn, calls };
}
const auth = `Bearer ${TOKEN}`;

test('bearer() + tokenMatches()', () => {
  assert.equal(bearer('Bearer xyz'), 'xyz');
  assert.equal(bearer('Basic xyz'), null);
  assert.equal(bearer(undefined), null);
  assert.equal(tokenMatches('abc', 'abc'), true);
  assert.equal(tokenMatches('abc', 'abd'), false);
  assert.equal(tokenMatches('', ''), false);       // empty never matches
  assert.equal(tokenMatches('ab', 'abc'), false);  // length mismatch
});

test('happy path → 200 accepted', () => {
  const ins = stubInsert();
  const r = handleIngest({ devices, body: { device_id: DEV, events: [commit('a')] }, authHeader: auth, insertFn: ins.fn });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { accepted: 1, ignored: 0 });
  assert.equal(ins.calls.length, 1);
});

test('missing token → 401, insert never called', () => {
  let called = false;
  const r = handleIngest({ devices, body: { device_id: DEV, events: [commit('a')] }, authHeader: '', insertFn: () => { called = true; } });
  assert.equal(r.status, 401);
  assert.equal(called, false);
});

test('wrong token → 401', () => {
  const r = handleIngest({ devices, body: { device_id: DEV, events: [commit('a')] }, authHeader: 'Bearer WRONG', insertFn: () => {} });
  assert.equal(r.status, 401);
});

test('device without a configured ingestToken → 401', () => {
  const r = handleIngest({ devices, body: { device_id: 'notoken', events: [] }, authHeader: 'Bearer anything', insertFn: () => {} });
  assert.equal(r.status, 401);
});

test('unknown device → 401', () => {
  const r = handleIngest({ devices, body: { device_id: 'ghost', events: [] }, authHeader: auth, insertFn: () => {} });
  assert.equal(r.status, 401);
});

test('disabled device (enabled:false) → 401, even with a valid token (kill switch)', () => {
  const r = handleIngest({ devices, body: { device_id: 'disabled', events: [] }, authHeader: auth, insertFn: () => {} });
  assert.equal(r.status, 401);
});

test('schema-invalid event → 400', () => {
  const bad = { ...commit('a'), kind: 'session_observed' }; // not in V1_KINDS
  const r = handleIngest({ devices, body: { device_id: DEV, events: [bad] }, authHeader: auth, insertFn: () => {} });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid_event');
});

test('cross-device event in a batch → 400 (device_mismatch)', () => {
  const other = { ...commit('a'), device_id: 'someone-else' };
  const r = handleIngest({ devices, body: { device_id: DEV, events: [other] }, authHeader: auth, insertFn: () => {} });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'device_mismatch');
});

test('too many events → 400', () => {
  const many = Array.from({ length: INGEST_MAX + 1 }, (_, i) => commit(`c${i}`));
  const r = handleIngest({ devices, body: { device_id: DEV, events: many }, authHeader: auth, insertFn: () => {} });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'too_many_events');
});

test('events not an array → 400', () => {
  const r = handleIngest({ devices, body: { device_id: DEV, events: 'nope' }, authHeader: auth, insertFn: () => {} });
  assert.equal(r.status, 400);
});

test('empty batch → 200 zero (no insert)', () => {
  let called = false;
  const r = handleIngest({ devices, body: { device_id: DEV, events: [] }, authHeader: auth, insertFn: () => { called = true; } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { accepted: 0, ignored: 0 });
  assert.equal(called, false);
});
