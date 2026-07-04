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

test('rejects kinds outside V1_KINDS (note is PIN-path-only, never device-emitted)', () => {
  const e = { ...goodCommit(), kind: 'note' };
  assert.match(validateEvent(e, V1_KINDS), /bad kind/);
  // note is still a known kind in the full set:
  assert.ok(KINDS.includes('note'));
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

// ── session_observed (v1b) ────────────────────────────────────────────────────
import { sessionEventId } from './schema.js';

const goodSession = () => ({
  event_id: sessionEventId(DEV, 'claude', 29031, 1700000000000),
  device_id: DEV, kind: 'session_observed', ts_device: 1700000000000, schema_version: SCHEMA_VERSION,
  payload: { tool: 'claude', pid: 29031, cwd: 'my-project', started: 1700000000000, ended: 1700003600000 },
});

test('v1b: valid session_observed passes (now in V1_KINDS)', () => {
  assert.equal(validateEvent(goodSession(), V1_KINDS), null);
  const nullCwd = goodSession(); nullCwd.payload = { ...nullCwd.payload, cwd: null };
  assert.equal(validateEvent(nullCwd, V1_KINDS), null);
});

test('v1b: rejects unknown tool, bad times, full-path cwd', () => {
  let e = goodSession(); e.payload = { ...e.payload, tool: 'vim' };
  assert.match(validateEvent(e, V1_KINDS), /bad tool/);
  e = goodSession(); e.payload = { ...e.payload, ended: e.payload.started - 1 };
  assert.match(validateEvent(e, V1_KINDS), /bad ended/);
  e = goodSession(); e.payload = { ...e.payload, cwd: '/Users/dev/proj' }; // path leak guard
  assert.match(validateEvent(e, V1_KINDS), /basename/);
});

test('v1b: id + ts_device integrity enforced', () => {
  let e = goodSession(); e.ts_device = 123;
  assert.match(validateEvent(e, V1_KINDS), /ts_device must equal/);
  e = goodSession(); e.event_id = sessionEventId(DEV, 'claude', 999, 1700000000000);
  assert.match(validateEvent(e, V1_KINDS), /does not match/);
});
