import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, listSessions, getSession, setStatus, removeSession, _clear } from './sessions.js';

beforeEach(() => _clear());

test('createSession: defaults + agent kind + starting status', () => {
  const s = createSession({ deviceId: 'macbook-pro', cwd: '/Users/a1234/proj' }, 1000);
  assert.equal(s.deviceId, 'macbook-pro');
  assert.equal(s.kind, 'agent');
  assert.equal(s.status, 'starting');
  assert.equal(s.cwd, '/Users/a1234/proj');
  assert.equal(s.title, '/Users/a1234/proj'); // falls back to cwd
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
