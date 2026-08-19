import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, listSessions, getSession, setStatus, removeSession, appendEvent, getTranscript, _clear } from './sessions.js';

beforeEach(() => _clear());

test('createSession: defaults + agent kind + starting status', () => {
  const s = createSession({ deviceId: 'macbook-pro', cwd: '/Users/dev/proj' }, 1000);
  assert.equal(s.deviceId, 'macbook-pro');
  assert.equal(s.kind, 'agent');
  assert.equal(s.status, 'starting');
  assert.equal(s.cwd, '/Users/dev/proj');
  assert.equal(s.title, '/Users/dev/proj'); // falls back to cwd
  assert.ok(s.id && getSession(s.id));
});

test('createSession: requires deviceId', () => {
  assert.throws(() => createSession({ cwd: '/x' }), /deviceId required/);
});

test('listSessions: filters by device, newest first', () => {
  createSession({ deviceId: 'a' }, 1);
  createSession({ deviceId: 'b' }, 2);
  const a2 = createSession({ deviceId: 'a' }, 3);
  assert.equal(listSessions().length, 3);
  const forA = listSessions('a');
  assert.deepEqual(forA.map((s) => s.id), [a2.id, listSessions('a')[1].id]); // newest first
  assert.equal(forA.length, 2);
});

test('setStatus: valid transitions, rejects garbage', () => {
  const s = createSession({ deviceId: 'a' });
  setStatus(s.id, 'running');
  assert.equal(getSession(s.id).status, 'running');
  assert.throws(() => setStatus(s.id, 'bogus'), /bad status/);
});

test('removeSession: returns the removed, then gone', () => {
  const s = createSession({ deviceId: 'a' });
  assert.equal(removeSession(s.id).id, s.id);
  assert.equal(getSession(s.id), null);
  assert.equal(removeSession('nope'), null);
});

// ── Transcript (agent chat survives leaving the app) ──────────────────────────

test('appendEvent + getTranscript: replayable events, oldest first', () => {
  const s = createSession({ deviceId: 'mac' });
  appendEvent(s.id, { type: 'user', text: 'run the tests' });
  appendEvent(s.id, { type: 'assistant', text: 'sure' });
  appendEvent(s.id, { type: 'result', ok: true, ms: 12 });

  const log = getTranscript(s.id);
  assert.deepEqual(log.map((e) => e.type), ['user', 'assistant', 'result']);
  assert.equal(log[0].text, 'run the tests');
});

test('appendEvent: assistant_delta is not stored', () => {
  // The `assistant` event that follows carries the same text in full; storing
  // every token would multiply the log ~100x to replay a duplicate.
  const s = createSession({ deviceId: 'mac' });
  assert.equal(appendEvent(s.id, { type: 'assistant_delta', text: 'he' }), null);
  appendEvent(s.id, { type: 'assistant', text: 'hello' });
  assert.deepEqual(getTranscript(s.id).map((e) => e.type), ['assistant']);
});

test('appendEvent: bounded so one session cannot eat the hub', () => {
  const s = createSession({ deviceId: 'mac' });
  for (let i = 0; i < 700; i += 1) appendEvent(s.id, { type: 'assistant', text: `m${i}` });
  const log = getTranscript(s.id);
  assert.equal(log.length, 500);
  assert.equal(log[log.length - 1].text, 'm699');  // newest kept
  assert.equal(log[0].text, 'm200');               // oldest dropped
});

test('appendEvent: a huge tool result is truncated in the transcript', () => {
  const s = createSession({ deviceId: 'mac' });
  appendEvent(s.id, { type: 'tool_result', id: 't1', ok: true, output: 'x'.repeat(20000) });
  const stored = getTranscript(s.id)[0];
  assert.ok(stored.output.length < 20000);
  assert.match(stored.output, /truncated in transcript/);
});

test('getTranscript: unknown session is empty, not an error', () => {
  assert.deepEqual(getTranscript('nope'), []);
});

test('the transcript outlives the child but not an explicit kill', () => {
  // The claude child is killed 45s after the socket detaches. The chat must
  // still be there when the user comes back — that is the whole point.
  const s = createSession({ deviceId: 'mac' });
  appendEvent(s.id, { type: 'assistant', text: 'still here' });
  setStatus(s.id, 'exited');
  assert.equal(getTranscript(s.id).length, 1);

  removeSession(s.id);
  assert.deepEqual(getTranscript(s.id), []);
});
