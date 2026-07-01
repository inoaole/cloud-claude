import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapEvent, buildAgentCommand, wrapUserMessage, assertCwd } from './agent.js';

// Event shapes captured verbatim from the T0 spike (designs/agent-spike-20260701).
test('mapEvent: assistant text → assistant block', () => {
  const evt = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'DONE' }] } };
  assert.deepEqual(mapEvent(evt), [{ type: 'assistant', text: 'DONE' }]);
});

test('mapEvent: assistant tool_use → tool_use block', () => {
  const evt = { type: 'assistant', message: { content: [
    { type: 'thinking', thinking: 'let me run it' },
    { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo SPIKE_TOOL_OK' }, caller: 'x' },
  ] } };
  assert.deepEqual(mapEvent(evt), [
    { type: 'thinking', text: 'let me run it' },
    { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo SPIKE_TOOL_OK' } },
  ]);
});

test('mapEvent: user tool_result → tool_result block (ok + string content)', () => {
  const evt = { type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'toolu_1', content: 'SPIKE_TOOL_OK', is_error: false },
  ] } };
  assert.deepEqual(mapEvent(evt), [{ type: 'tool_result', id: 'toolu_1', ok: true, output: 'SPIKE_TOOL_OK' }]);
});

test('mapEvent: tool_result array content is flattened; is_error → ok:false', () => {
  const evt = { type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'boom' }], is_error: true },
  ] } };
  assert.deepEqual(mapEvent(evt), [{ type: 'tool_result', id: 't2', ok: false, output: 'boom' }]);
});

test('mapEvent: result → result block with ms + final text', () => {
  const evt = { type: 'result', subtype: 'success', is_error: false, duration_ms: 10117, result: 'DONE' };
  assert.deepEqual(mapEvent(evt), [{ type: 'result', ok: true, ms: 10117, text: 'DONE' }]);
});

test('mapEvent: stream_event text_delta → assistant_delta (token streaming)', () => {
  const evt = { type: 'stream_event', event: { delta: { type: 'text_delta', text: 'Hel' } } };
  assert.deepEqual(mapEvent(evt), [{ type: 'assistant_delta', text: 'Hel' }]);
});

test('mapEvent: system/init → status ready; hooks & rate_limit → nothing', () => {
  assert.deepEqual(mapEvent({ type: 'system', subtype: 'init' }), [{ type: 'status', state: 'ready' }]);
  assert.deepEqual(mapEvent({ type: 'system', subtype: 'hook_started' }), []);
  assert.deepEqual(mapEvent({ type: 'rate_limit_event' }), []);
});

test('mapEvent: malformed event never throws', () => {
  assert.deepEqual(mapEvent(null), []);
  assert.deepEqual(mapEvent({ type: 'assistant' }), []); // no content array
  assert.deepEqual(mapEvent('garbage'), []);
});

test('assertCwd: absolute + no traversal + no metachars', () => {
  assert.equal(assertCwd('/Users/a1234/proj'), '/Users/a1234/proj');
  assert.throws(() => assertCwd('relative/path'), /absolute/);
  assert.throws(() => assertCwd('/a/../b'), /unsafe/);
  assert.throws(() => assertCwd('/a; rm -rf /'), /unsafe/);
  assert.throws(() => assertCwd('/a/$(whoami)'), /unsafe/);
});

test('assertCwd: allowedRoots enforced', () => {
  assert.equal(assertCwd('/Users/a1234/proj/x', ['/Users/a1234/proj']), '/Users/a1234/proj/x');
  assert.throws(() => assertCwd('/etc/passwd', ['/Users/a1234/proj']), /outside allowed roots/);
});

test('buildAgentCommand: Mac ssh — no -tt, single quoted remote arg, exec claude in cwd', () => {
  const c = buildAgentCommand(
    { sshUser: 'a1234', sshHost: '100.66.78.59', connect: 'ssh' },
    '/Users/a1234/proj',
    { hubKeyPath: '/k', permissionMode: 'acceptEdits' },
  );
  assert.equal(c.file, 'ssh');
  assert.ok(!c.args.includes('-tt'), 'no pty — keeps stream-json stdin clean');
  assert.equal(c.args.at(-2), 'a1234@100.66.78.59');
  const remote = c.args.at(-1); // ONE arg (ssh flattens argv): bash -lc '<inner>'
  assert.match(remote, /^bash -lc '/);
  assert.match(remote, /export PATH="\/opt\/homebrew\/bin/); // brew PATH so claude resolves
  assert.match(remote, /cd '\\''\/Users\/a1234\/proj'\\'' && exec claude /);
  assert.match(remote, /--permission-mode acceptEdits/);
  assert.match(remote, /--input-format stream-json/);
});

test('buildAgentCommand: null cwd → no cd (runs in login home)', () => {
  const c = buildAgentCommand({ sshUser: 'a1234', sshHost: '1.2.3.4', connect: 'ssh' }, null, { hubKeyPath: '/k' });
  const remote = c.args.at(-1);
  assert.doesNotMatch(remote, /cd /);
  assert.match(remote, /export PATH=.*; exec claude /);
});

test('buildAgentCommand: hub role → local bash -lc, no ssh', () => {
  const c = buildAgentCommand({ role: 'hub' }, '/tmp/x', {});
  assert.equal(c.file, 'bash');
  assert.equal(c.args[0], '-lc');
  assert.match(c.args[1], /export PATH=.*; cd '\/tmp\/x' && exec claude /);
});

test('buildAgentCommand: rejects unsafe cwd before building', () => {
  assert.throws(() => buildAgentCommand({ role: 'hub' }, '/a; rm', {}), /unsafe/);
});

test('wrapUserMessage: stream-json user line (verified schema)', () => {
  assert.equal(wrapUserMessage('hi'), '{"type":"user","message":{"role":"user","content":"hi"}}\n');
});
