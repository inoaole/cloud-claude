import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listCandidates, startedMs, isCodexDaemon, observeSessions, diffSessions } from './scan.js';
import { sessionEventId } from '../../shared/schema.js';

// Fake execFile keyed on (file, first args) — returns canned stdout per call shape.
function fakeExec(responses) {
  return async (file, args) => {
    const key = `${file} ${args[0]}${args[1] ? ` ${args[1]}` : ''}`;
    for (const [pattern, stdout] of responses) {
      if (key.startsWith(pattern)) {
        if (typeof stdout === 'function') return { stdout: stdout(args) };
        return { stdout };
      }
    }
    throw new Error(`unexpected exec: ${key}`);
  };
}

// The spike's real-world ps output shape: desktop-app helpers + a wrapper whose ARGS
// contain "claude", none of which are sessions. comm= shows the EXECUTABLE only.
const PS_COMM = `
    1  /sbin/launchd
28018  /Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper
29030  /Applications/Claude.app/Contents/Helpers/disclaimer
29031  /Users/dev/Library/Application Support/Claude/claude-code/2.1.181/claude.app/Contents/MacOS/claude
41028  /Applications/Codex.app/Contents/Resources/codex
41029  /opt/homebrew/bin/codex
50001  /opt/homebrew/bin/tmux
50002  /opt/homebrew/bin/tmux
`;

test('spike guard 1: matches executable basename only — helpers/wrappers excluded', async () => {
  const exec = fakeExec([['ps -axo', PS_COMM]]);
  const c = await listCandidates(exec);
  assert.deepEqual(
    c.map((x) => `${x.tool}:${x.pid}`).sort(),
    ['claude:29031', 'codex:41028', 'codex:41029', 'tmux:50001', 'tmux:50002'],
  ); // NOT 28018 (Claude Helper), NOT 29030 (disclaimer wrapper)
});

test('spike guard 2: codex app-server daemon is not a session', async () => {
  const exec = fakeExec([
    ['ps -o args=', (args) => (args[3] === '41028' ? 'codex app-server --analytics\n' : 'codex exec something\n')],
  ]);
  assert.equal(await isCodexDaemon(41028, exec), true);
  assert.equal(await isCodexDaemon(41029, exec), false);
});

test('spike guard 3: lstart parses with double spaces (LC_ALL=C shape)', async () => {
  const exec = fakeExec([['ps -o lstart=', 'Sat Jul  4 14:09:33 2026\n']]);
  const t = await startedMs(29031, exec);
  assert.equal(new Date(t).getFullYear(), 2026);
  assert.equal(new Date(t).getMonth(), 6); // July
});

test('observeSessions: full pipeline — daemon dropped, tmux collapsed to one, cwd basename', async () => {
  const exec = fakeExec([
    ['ps -axo', PS_COMM],
    ['ps -o args=', (args) => (args[3] === '41028' ? 'codex app-server\n' : 'codex exec\n')],
    ['ps -o lstart=', (args) => {
      const started = { 29031: 'Sat Jul  4 14:00:00 2026', 41029: 'Sat Jul  4 15:00:00 2026', 50001: 'Sat Jul  4 09:00:00 2026', 50002: 'Sat Jul  4 10:00:00 2026' };
      return `${started[args[3]]}\n`;
    }],
    ['lsof -a', 'p29031\nn/Users/dev/code/my-project\n'],
  ]);
  const seen = await observeSessions(exec);
  const keys = seen.map((s) => s.key).sort();
  assert.deepEqual(keys, ['claude:29031', 'codex:41029', 'tmux:50001']); // 50002 collapsed (later start)
  assert.equal(seen.find((s) => s.pid === 29031).cwd, 'my-project'); // basename, not full path
});

test('diffSessions: still-alive keeps first-seen data; vanished emits ended=lastSeen', () => {
  const dev = 'macbook-pro';
  const prev = {
    'claude:100': { pid: 100, tool: 'claude', started: 1000, cwd: 'proj', lastSeen: 5000 },
    'codex:200': { pid: 200, tool: 'codex', started: 2000, cwd: null, lastSeen: 5000 },
  };
  const observed = [{ key: 'claude:100', pid: 100, tool: 'claude', started: 1000, cwd: 'proj' }];
  const { events, nextSessions } = diffSessions(prev, observed, dev, 9000);
  // claude still alive → tracked, lastSeen advanced, no event
  assert.equal(nextSessions['claude:100'].lastSeen, 9000);
  // codex vanished → one session_observed, ended = lastSeen (honest observation bound)
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.kind, 'session_observed');
  assert.equal(e.event_id, sessionEventId(dev, 'codex', 200, 2000));
  assert.equal(e.ts_device, 2000); // belongs to the day the work began
  assert.deepEqual(e.payload, { tool: 'codex', pid: 200, cwd: null, started: 2000, ended: 5000 });
  assert.equal(nextSessions['codex:200'], undefined);
});

test('diffSessions: pid reuse (started far off) ends the old session and tracks the new one', () => {
  const prev = { 'claude:100': { pid: 100, tool: 'claude', started: 1000, cwd: 'old', lastSeen: 5000 } };
  const observed = [{ key: 'claude:100', pid: 100, tool: 'claude', started: 500_000, cwd: 'new' }];
  const { events, nextSessions } = diffSessions(prev, observed, 'd', 600_000);
  assert.equal(events.length, 1); // old session ended
  assert.equal(events[0].payload.started, 1000);
  assert.equal(nextSessions['claude:100'].started, 500_000); // new lineage tracked
  assert.equal(nextSessions['claude:100'].cwd, 'new');
});

test('diffSessions: new pid → tracked, no event yet (emit-on-end only)', () => {
  const observed = [{ key: 'tmux:50001', pid: 50001, tool: 'tmux', started: 100, cwd: null }];
  const { events, nextSessions } = diffSessions({}, observed, 'd', 200);
  assert.equal(events.length, 0);
  assert.equal(nextSessions['tmux:50001'].lastSeen, 200);
});
