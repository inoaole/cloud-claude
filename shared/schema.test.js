import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION, KINDS, V1_KINDS, commitEventId, heartbeatEventId, validateEvent,
} from './schema.js';

const DEV = 'macbook-pro';
const goodCommit = () => ({
  event_id: commitEventId(DEV, 'cloud-claude', 'abc123'),
  device_id: DEV, kind: 'commit_seen', ts_device: 1700000000000, schema_version: SCHEMA_VERSION,
  payload: { repoId: 'cloud-claude', sha: 'abc123', subject: 'feat: x', author_ts: 1700000000000 },
});
const goodHeartbeat = () => ({
  event_id: heartbeatEventId(DEV, 1700000100000),
  device_id: DEV, kind: 'heartbeat', ts_device: 1700000100000, schema_version: SCHEMA_VERSION,
  payload: { intervalSec: 180 },
});

test('valid commit_seen + heartbeat pass', () => {
  assert.equal(validateEvent(goodCommit(), V1_KINDS), null);
  assert.equal(validateEvent(goodHeartbeat(), V1_KINDS), null);
});

test('rejects non-v1a kinds when restricted to V1_KINDS', () => {
  const e = { ...goodCommit(), kind: 'session_observed' };
  assert.match(validateEvent(e, V1_KINDS), /bad kind/);
  // session_observed is a known kind under the full set, though (still allowed there):
  assert.ok(KINDS.includes('session_observed'));
});

test('rejects wrong schema_version', () => {
  assert.match(validateEvent({ ...goodCommit(), schema_version: 999 }, V1_KINDS), /schema_version/);
});

test('rejects missing/blank required fields', () => {
  assert.match(validateEvent({ ...goodCommit(), event_id: '' }, V1_KINDS), /event_id/);
  assert.match(validateEvent({ ...goodCommit(), device_id: '' }, V1_KINDS), /device_id/);
  assert.match(validateEvent({ ...goodCommit(), ts_device: 0 }, V1_KINDS), /ts_device/);
  assert.match(validateEvent({ ...goodCommit(), payload: null }, V1_KINDS), /payload/);
});

test('commit_seen: event_id must match payload (no forged ids)', () => {
  const e = goodCommit();
  e.event_id = commitEventId(DEV, 'cloud-claude', 'DIFFERENT');
  assert.match(validateEvent(e, V1_KINDS), /does not match/);
});

test('commit_seen: rejects bad payload fields', () => {
  const e = goodCommit(); e.payload = { ...e.payload, author_ts: 'nope' };
  assert.match(validateEvent(e, V1_KINDS), /author_ts/);
});

test('heartbeat: event_id must be keyed on ts_device', () => {
  const e = goodHeartbeat();
  e.event_id = heartbeatEventId(DEV, 999); // wrong bucket
  assert.match(validateEvent(e, V1_KINDS), /heartbeat/);
});

test('non-object → error', () => {
  assert.match(validateEvent(null, V1_KINDS), /not an object/);
});
