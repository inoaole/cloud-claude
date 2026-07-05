import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShellCommand, wrapCommand, matchSentinel, isValidRunId } from './shell.js';

test('buildShellCommand: hub → local login bash', () => {
  assert.deepEqual(buildShellCommand({ id: 'hub', role: 'hub' }), { file: 'bash', args: ['-l'] });
});

test('buildShellCommand: Mac → ssh + hub key + bash -l (no -tt)', () => {
  const c = buildShellCommand({ sshUser: 'dev', sshHost: '100.64.0.7', connect: 'ssh' }, { hubKeyPath: '/k' });
  assert.equal(c.file, 'ssh');
  assert.ok(!c.args.includes('-tt'), 'no pty for command-block mode');
  assert.deepEqual(c.args.slice(-3), ['dev@100.64.0.7', 'bash', '-l']);
});

test('buildShellCommand: rejects arg-injection', () => {
  assert.throws(() => buildShellCommand({ sshUser: '-oProxyCommand=x', sshHost: 'h', connect: 'ssh' }, { hubKeyPath: '/k' }), /unsafe/);
});

test('wrapCommand: /dev/null stdin, merged stderr, exit sentinel', () => {
  const w = wrapCommand('abc123', 'git status');
  assert.match(w, /git status/);
  assert.match(w, /<\/dev\/null 2>&1/);
  assert.match(w, /__CC_END_abc123_%s__/);
});

test('matchSentinel: parses id + exit, ignores plain lines', () => {
  assert.deepEqual(matchSentinel('__CC_END_abc123_0__'), { id: 'abc123', exit: 0 });
  assert.deepEqual(matchSentinel('__CC_END_x_127__'), { id: 'x', exit: 127 });
  assert.equal(matchSentinel('total 48'), null);
});

test('isValidRunId: alphanumeric only', () => {
  assert.equal(isValidRunId('a1B2'), true);
  assert.equal(isValidRunId('a-b'), false);
  assert.equal(isValidRunId(''), false);
  assert.equal(isValidRunId(undefined), false);
});
