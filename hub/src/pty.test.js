import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueWsToken, consumeWsToken, buildCommand, originAllowed } from './pty.js';

test('WS token is single-use and session-bound', () => {
  const { token, ttl } = issueWsToken('sid-1');
  assert.equal(ttl, 30);
  assert.equal(consumeWsToken(token), 'sid-1');
  assert.equal(consumeWsToken(token), null, 'second use is rejected');
});

test('WS token expires', () => {
  const t0 = 1_000_000;
  const { token } = issueWsToken('sid-2', t0);
  assert.equal(consumeWsToken(token, t0 + 31_000), null, 'expired token rejected');
});

test('consumeWsToken rejects unknown/empty tokens', () => {
  assert.equal(consumeWsToken(''), null);
  assert.equal(consumeWsToken('nope'), null);
});

test('buildCommand: hub → local tmux, no ssh hop', () => {
  const c = buildCommand({ id: 'hub', role: 'hub' }, { session: 'phone' });
  assert.deepEqual(c, { file: 'tmux', args: ['new', '-A', '-s', 'phone'] });
});

test('buildCommand: Mac → classic ssh with hub key + absolute tmux, fixed session', () => {
  const c = buildCommand(
    { id: 'macbook-pro', sshUser: 'a1234', sshHost: '100.66.78.59', connect: 'ssh' },
    { hubKeyPath: '/home/ubuntu/.ssh/id_cloud_claude', macTmuxPath: '/opt/homebrew/bin/tmux', session: 'phone' },
  );
  assert.equal(c.file, 'ssh');
  assert.ok(c.args.includes('-i') && c.args.includes('/home/ubuntu/.ssh/id_cloud_claude'));
  assert.equal(c.args.at(-5), '/opt/homebrew/bin/tmux'); // tmux, then: new -A -s phone
  assert.deepEqual(c.args.slice(-3), ['-A', '-s', 'phone']);
  assert.equal(c.args.at(-6), 'a1234@100.66.78.59'); // target precedes tmux
});

test('buildCommand: Linux peer → tailscale ssh', () => {
  const c = buildCommand({ id: 'box', connect: 'tailscale-ssh', sshUser: 'ubuntu', tailnet: 'box' });
  assert.equal(c.file, 'tailscale');
  assert.deepEqual(c.args, ['ssh', 'ubuntu@box', '--', 'tmux', 'new', '-A', '-s', 'phone']);
});

test('buildCommand: rejects option-injection in device fields', () => {
  assert.throws(
    () => buildCommand({ id: 'x', connect: 'ssh', sshUser: '-oProxyCommand=calc', sshHost: '100.1.1.1' }, { hubKeyPath: '/k' }),
    /unsafe/,
  );
  assert.throws(
    () => buildCommand({ id: 'x', connect: 'ssh', sshUser: 'a', sshHost: 'host with space' }, { hubKeyPath: '/k' }),
    /unsafe/,
  );
});

test('originAllowed: same host only', () => {
  assert.equal(originAllowed('https://cloud-claude-hub.tail.ts.net', 'cloud-claude-hub.tail.ts.net'), true);
  assert.equal(originAllowed('https://evil.example', 'cloud-claude-hub.tail.ts.net'), false);
  assert.equal(originAllowed('', 'host'), false);
  assert.equal(originAllowed('not a url', 'host'), false);
});
