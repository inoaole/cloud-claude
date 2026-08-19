# v1 Terminal and Relay Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Terminal, Shell, and Agent safe under reconnects, slow clients, large output, and forgotten sessions without losing the remote tmux session.

**Architecture:** Extract raw-terminal lifecycle into a dependency-injected PTY session manager keyed by device id. Keep Shell and Agent protocols separate, sharing only a global relay limiter and byte-limit constants. Sanitize terminal output on the Hub and keep the React xterm instance alive across automatic retries.

**Tech Stack:** Node 20 ESM, `node:test`, `node-pty`, `ws`, React 18, TypeScript, Vitest, xterm.js.

## Global Constraints

- One PTY relay and one active phone client per device.
- PTY reconnect grace is 45 seconds; grace expiry kills PTY/SSH but never remote tmux.
- Maximums: 4 total live relays, 2 PTYs, 2 Agents, 64 KiB input, 64 MiB PTY/Agent lifetime output.
- Backpressure means pause/resume; terminal or Agent protocol events must never be discarded.
- Strip every OSC sequence on the Hub while preserving CSI.
- Audit metadata only. Never log terminal, command, prompt, stdout, stderr, cwd, or scrollback content.
- No new runtime dependencies and no user-controlled shell interpolation.

---

### Task 1: Streaming terminal sanitizer

**Files:**
- Create: `hub/src/terminal-sanitize.js`
- Create: `hub/src/terminal-sanitize.test.js`

**Interfaces:**
- Produces: `createTerminalSanitizer({ maxOscBytes = 8192 }) -> { push(chunk): string, flush(): string }`
- Consumes: plain JavaScript strings from node-pty and captured tmux output.

- [ ] **Step 1: Write failing sanitizer tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalSanitizer } from './terminal-sanitize.js';

test('strips OSC 52 split across chunks and preserves CSI', () => {
  const s = createTerminalSanitizer();
  assert.equal(s.push('a\x1b]52;c;SGV'), 'a');
  assert.equal(s.push('sbG8=\x07b\x1b[31mred\x1b[0m'), 'b\x1b[31mred\x1b[0m');
});

test('strips ST-terminated OSC and holds a trailing high surrogate', () => {
  const s = createTerminalSanitizer();
  assert.equal(s.push('x\x1b]8;;https://bad'), 'x');
  assert.equal(s.push('\x1b\\y\uD83D'), 'y');
  assert.equal(s.push('\uDE00z'), '😀z');
});

test('bounds an unterminated OSC without swallowing later text forever', () => {
  const s = createTerminalSanitizer({ maxOscBytes: 4 });
  assert.equal(s.push('\x1b]52;abcdef'), 'ef');
});
```

- [ ] **Step 2: Verify tests fail**

Run: `cd hub && node --test src/terminal-sanitize.test.js`  
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the state machine**

```js
export function createTerminalSanitizer({ maxOscBytes = 8192 } = {}) {
  let state = 'text';
  let oscBytes = 0;
  let surrogate = '';

  function push(input) {
    let chunk = surrogate + String(input ?? '');
    surrogate = '';
    if (chunk && /[\uD800-\uDBFF]/.test(chunk.at(-1))) {
      surrogate = chunk.at(-1);
      chunk = chunk.slice(0, -1);
    }
    let out = '';
    for (const ch of chunk) {
      if (state === 'text') {
        if (ch === '\x1b') state = 'esc';
        else out += ch;
      } else if (state === 'esc') {
        if (ch === ']') { state = 'osc'; oscBytes = 0; }
        else { out += `\x1b${ch}`; state = 'text'; }
      } else if (state === 'osc') {
        oscBytes += Buffer.byteLength(ch);
        if (ch === '\x07') state = 'text';
        else if (ch === '\x1b') state = 'oscEsc';
        else if (oscBytes > maxOscBytes) state = 'text';
      } else if (state === 'oscEsc') {
        oscBytes += Buffer.byteLength(ch);
        state = ch === '\\' || oscBytes > maxOscBytes ? 'text' : 'osc';
      }
    }
    return out;
  }

  function flush() {
    const out = state === 'esc' ? '\x1b' : '';
    state = 'text'; oscBytes = 0;
    const tail = surrogate;
    surrogate = '';
    return out + tail;
  }

  return { push, flush };
}
```

- [ ] **Step 4: Run sanitizer tests**

Run: `cd hub && node --test src/terminal-sanitize.test.js`  
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add hub/src/terminal-sanitize.js hub/src/terminal-sanitize.test.js
git commit -m "feat(pty): sanitize streaming terminal output"
```

---

### Task 2: Relay limiter and exact configuration

**Files:**
- Create: `hub/src/relay-limits.js`
- Create: `hub/src/relay-limits.test.js`
- Modify: `hub/src/config.js`
- Modify: `.env.example`

**Interfaces:**
- Produces: `createRelayLimiter({ total, pty, shell, agent })`.
- Produces: `acquire(mode) -> release function | null`, `counts() -> object`.
- Produces config keys `relayLimits` and `ptyLimits`.

- [ ] **Step 1: Write failing limiter tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRelayLimiter } from './relay-limits.js';

test('enforces per-mode and total limits and releases once', () => {
  const l = createRelayLimiter({ total: 2, pty: 1, shell: 2, agent: 2 });
  const releasePty = l.acquire('pty');
  assert.equal(typeof releasePty, 'function');
  assert.equal(l.acquire('pty'), null);
  const releaseShell = l.acquire('shell');
  assert.equal(typeof releaseShell, 'function');
  assert.equal(l.acquire('agent'), null);
  releasePty(); releasePty();
  assert.equal(typeof l.acquire('agent'), 'function');
  releaseShell();
});
```

- [ ] **Step 2: Verify the test fails**

Run: `cd hub && node --test src/relay-limits.test.js`  
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the limiter**

```js
export function createRelayLimiter(limits) {
  const active = { total: 0, pty: 0, shell: 0, agent: 0 };
  return {
    acquire(mode) {
      if (!(mode in active) || mode === 'total') throw new Error('bad relay mode');
      if (active.total >= limits.total || active[mode] >= limits[mode]) return null;
      active.total += 1; active[mode] += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true; active.total -= 1; active[mode] -= 1;
      };
    },
    counts: () => ({ ...active }),
  };
}
```

- [ ] **Step 4: Add parsed limits to config**

Extend `config` with:

```js
relayLimits: {
  total: Number(process.env.DEVICE_MAX_LIVE_RELAYS || 4),
  pty: Number(process.env.PTY_MAX_SESSIONS || 2),
  shell: Number(process.env.SHELL_MAX_SESSIONS || 2),
  agent: Number(process.env.AGENT_MAX_SESSIONS || 2),
},
ptyLimits: {
  graceMs: parseTtl(process.env.PTY_GRACE, 45_000),
  connectMs: parseTtl(process.env.PTY_CONNECT_TIMEOUT, 15_000),
  idleMs: parseTtl(process.env.PTY_IDLE_TIMEOUT, 30 * 60_000),
  blockedMs: parseTtl(process.env.PTY_BLOCKED_TIMEOUT, 10_000),
  inputBytes: Number(process.env.PTY_INPUT_BYTES || 65_536),
  outputBytes: Number(process.env.PTY_OUTPUT_BYTES || 64 * 1024 * 1024),
  highWaterBytes: Number(process.env.PTY_HIGH_WATER_BYTES || 256 * 1024),
  lowWaterBytes: Number(process.env.PTY_LOW_WATER_BYTES || 64 * 1024),
  scrollbackLines: Number(process.env.PTY_SCROLLBACK_LINES || 300),
},
```

Add the same variable names and defaults to `.env.example`.

- [ ] **Step 5: Run tests**

Run: `cd hub && node --test src/relay-limits.test.js && node -e "import('./src/config.js')"`  
Expected: limiter passes and the config module imports with exit code 0.

- [ ] **Step 6: Commit**

```bash
git add hub/src/relay-limits.js hub/src/relay-limits.test.js hub/src/config.js .env.example
git commit -m "feat(hub): add device relay resource limits"
```

---

### Task 3: Safe tmux capture and SSH timeout commands

**Files:**
- Modify: `hub/src/pty.js`
- Modify: `hub/src/pty.test.js`

**Interfaces:**
- Produces: `buildCaptureCommand(device, opts) -> { file, args }`.
- Produces: `buildPtyCommands(device, config) -> { live, capture }`.
- Existing `buildCommand()` adds a fixed SSH `ConnectTimeout`.

- [ ] **Step 1: Add failing command tests**

```js
test('buildCaptureCommand: Mac uses fixed argv and bounded lines', () => {
  const c = buildCaptureCommand(
    { id: 'mac', sshUser: 'dev', sshHost: '100.64.0.7', connect: 'ssh' },
    { hubKeyPath: '/k', macTmuxPath: '/opt/homebrew/bin/tmux', session: 'phone', lines: 300 },
  );
  assert.equal(c.file, 'ssh');
  assert.deepEqual(c.args.slice(-8), [
    'dev@100.64.0.7', '/opt/homebrew/bin/tmux',
    'capture-pane', '-p', '-S', '-300', '-t', 'phone',
  ]);
});

test('buildCommand adds SSH connect timeout', () => {
  const c = buildCommand(
    { id: 'mac', sshUser: 'dev', sshHost: '100.64.0.7', connect: 'ssh' },
    { hubKeyPath: '/k', session: 'phone', connectTimeoutSec: 15 },
  );
  assert.ok(c.args.includes('ConnectTimeout=15'));
});
```

- [ ] **Step 2: Verify tests fail**

Run: `cd hub && node --test src/pty.test.js`  
Expected: FAIL because `buildCaptureCommand` is missing.

- [ ] **Step 3: Implement safe builders**

Add a shared `tmuxCaptureArgs()` and export:

```js
const captureArgs = (session, lines) => [
  'capture-pane', '-p', '-S', `-${Math.min(Math.max(Number(lines) || 300, 1), 2000)}`, '-t', session,
];

export function buildCaptureCommand(device, opts = {}) {
  const session = opts.session || 'phone';
  const args = captureArgs(session, opts.lines);
  if (device.role === 'hub') return { file: 'tmux', args };
  if (device.connect === 'tailscale-ssh') {
    const user = assertSafeArg(device.sshUser || 'ubuntu', 'sshUser');
    const host = assertSafeArg(device.tailnet || device.sshHost, 'tailnet');
    return { file: 'tailscale', args: ['ssh', `${user}@${host}`, '--', 'tmux', ...args] };
  }
  const user = assertSafeArg(device.sshUser, 'sshUser');
  const host = assertSafeArg(device.sshHost || device.tailnet, 'sshHost');
  return {
    file: 'ssh',
    args: [
      '-i', opts.hubKeyPath, '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'BatchMode=yes', '-o', `ConnectTimeout=${opts.connectTimeoutSec || 15}`,
      `${user}@${host}`, opts.macTmuxPath || '/opt/homebrew/bin/tmux', ...args,
    ],
  };
}
```

Add the same `ConnectTimeout` option to classic SSH in `buildCommand()`.

Add the tested composition helper:

```js
export function buildPtyCommands(device, config) {
  const shared = {
    hubKeyPath: config.hubKeyPath,
    macTmuxPath: config.macTmuxPath,
    session: config.ptySession,
    connectTimeoutSec: Math.ceil(config.ptyLimits.connectMs / 1000),
  };
  return {
    live: buildCommand(device, shared),
    capture: buildCaptureCommand(device, {
      ...shared, lines: config.ptyLimits.scrollbackLines,
    }),
  };
}
```

Test that both returned commands use the same key, tmux path, fixed session, and timeout.

- [ ] **Step 4: Run PTY builder tests**

Run: `cd hub && node --test src/pty.test.js`  
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add hub/src/pty.js hub/src/pty.test.js
git commit -m "feat(pty): add safe tmux scrollback capture"
```

---

### Task 4: PTY session manager state machine

**Files:**
- Create: `hub/src/pty-session.js`
- Create: `hub/src/pty-session.test.js`

**Interfaces:**
- Consumes: sanitizer, limiter lease, injected `spawnPty()` and `capture()`.
- Produces: `createPtySessionManager(deps) -> { attach({ws, device, command, captureCommand}), closeAll(), size() }`.

- [ ] **Step 1: Create fake PTY/WS tests for lifecycle**

Tests must use `EventEmitter` fakes with `emitData`, `emitExit`, `pause`, `resume`, `kill`,
`bufferedAmount`, `send`, and `close`. Cover:

```js
test('reattaches inside grace and flushes output in order', async () => {
  const h = harness({ graceMs: 45_000 });
  await h.manager.attach(h.connection('a'));
  h.term.emitData('one');
  h.ws.closeFromClient();
  h.term.emitData('two');
  await h.manager.attach(h.connection('b'));
  assert.deepEqual(h.ws2.sent, ['two']);
  assert.equal(h.term.killed, false);
});

test('grace expiry kills PTY once and releases the lease', async () => {
  const h = harness({ graceMs: 45_000 });
  await h.manager.attach(h.connection('a'));
  h.ws.closeFromClient();
  h.clock.advance(45_000);
  assert.equal(h.term.killed, true);
  assert.equal(h.limiter.counts().pty, 0);
});

test('high water pauses, low water resumes, blocked timeout closes', async () => {
  const h = harness({ highWaterBytes: 8, lowWaterBytes: 2, blockedMs: 10_000 });
  await h.manager.attach(h.connection('a'));
  h.ws.bufferedAmount = 9; h.term.emitData('x');
  assert.equal(h.term.paused, true);
  h.ws.bufferedAmount = 1; h.clock.advance(25);
  assert.equal(h.term.paused, false);
});
```

Also test replacement code 4001, input limit 1009, resize clamp, idle 4002, output cap 4003,
capture failure fallback, sanitizer use, PTY exit cleanup, and `closeAll()`.

- [ ] **Step 2: Verify tests fail**

Run: `cd hub && node --test src/pty-session.test.js`  
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement manager lifecycle**

Use this public shape:

```js
export function createPtySessionManager({
  spawnPty, capture, limiter, audit = () => {}, timers = globalThis, limits,
}) {
  const sessions = new Map();

  async function attach({ ws, device, command, captureCommand }) {
    const old = sessions.get(device.id);
    if (old && !old.closed) return reattach(old, ws);
    const release = limiter.acquire('pty');
    if (!release) return ws.close(4006, 'hub_overloaded');

    let snapshot = '';
    try { snapshot = await capture(captureCommand); } catch {
      audit('pty_capture_failed', { device: device.id });
    }
    const term = spawnPty(command);
    const session = makeSession({ ws, device, term, release, limits, audit, timers });
    sessions.set(device.id, session);
    session.onClosed = () => sessions.delete(device.id);
    if (snapshot) session.deliver(snapshot);
    session.bind();
  }

  return {
    attach,
    closeAll: () => [...sessions.values()].forEach((s) => s.close(1001, 'shutdown')),
    size: () => sessions.size,
  };
}
```

Implement `makeSession()` in the same file with:

- idempotent `close()`
- byte-counted `deliver()`
- `term.pause()`/`resume()` around high/low water
- a 25 ms unref drain poll while paused
- 10-second blocked timer
- 45-second detach timer
- 30-minute input-idle timer
- message parsing and size checks
- metadata-only `pty_open`, `pty_attach`, `pty_detach`, `pty_close`, `pty_exit` audits
- a single release call on every terminal path

- [ ] **Step 4: Run manager and sanitizer tests**

Run: `cd hub && node --test src/pty-session.test.js src/terminal-sanitize.test.js`  
Expected: all tests pass with no open-handle warning.

- [ ] **Step 5: Commit**

```bash
git add hub/src/pty-session.js hub/src/pty-session.test.js
git commit -m "feat(pty): preserve terminal relays across reconnects"
```

---

### Task 5: Wire the PTY manager into the Hub

**Files:**
- Modify: `hub/src/server.js`

**Interfaces:**
- Consumes: `buildPtyCommands`, `createRelayLimiter`, `createPtySessionManager`.
- Replaces: inline `bridgePty()`.

- [ ] **Step 1: Replace inline PTY bridging**

Create one process-wide limiter and manager:

```js
const relayLimiter = createRelayLimiter(config.relayLimits);
const ptySessions = createPtySessionManager({
  limiter: relayLimiter,
  limits: config.ptyLimits,
  audit,
  spawnPty: ({ file, args }) => pty.spawn(file, args, {
    name: 'xterm-color', cols: 80, rows: 24, cwd: process.env.HOME, env: process.env,
  }),
  capture: ({ file, args }) => new Promise((resolve, reject) => {
    execFile(file, args, { timeout: config.ptyLimits.connectMs, maxBuffer: 1024 * 1024 },
      (err, stdout) => err ? reject(err) : resolve(stdout));
  }),
});
```

The `/pty` upgrade callback becomes:

```js
function bridgePty(ws, device) {
  const commands = buildPtyCommands(device, config);
  void ptySessions.attach({
    ws, device, command: commands.live, captureCommand: commands.capture,
  });
}
```

Delete the old inline `term.onData`, `term.onExit`, message, and immediate-close-kill code.

- [ ] **Step 2: Add graceful local cleanup**

On `SIGTERM` and `SIGINT`, call `ptySessions.closeAll()` before `server.close()`. Do not run
`process.exit()` until the server callback or a five-second hard deadline.

- [ ] **Step 3: Run Hub tests**

Run: `cd hub && npm test`  
Expected: all Hub tests pass.

- [ ] **Step 4: Commit**

```bash
git add hub/src/server.js
git commit -m "refactor(hub): delegate terminal lifecycle to session manager"
```

---

### Task 6: Frontend terminal reconnection

**Files:**
- Modify: `frontend/src/screens/DeviceConsole.tsx`
- Modify: `frontend/src/screens/Terminal.tsx`
- Modify: `frontend/src/screens/Terminal.module.css`
- Modify: `frontend/vite.config.ts`
- Create: `frontend/src/screens/Terminal.test.tsx`

**Interfaces:**
- Extends: `Conn` with `reconnecting`.
- Keeps one xterm instance while replacing WebSocket instances.

- [ ] **Step 1: Write failing Vitest cases**

Mock `@xterm/xterm`, `@xterm/addon-fit`, `getPtyToken`, and `WebSocket`. Cover:

```tsx
it('gets a fresh token and reconnects without recreating xterm', async () => {
  vi.useFakeTimers();
  getPtyTokenMock.mockResolvedValueOnce('t1').mockResolvedValueOnce('t2');
  render(<Terminal id="hub" onStatus={statusSpy} />);
  await flushPromises();
  sockets[0].open();
  sockets[0].close(1006, '');
  expect(statusSpy).toHaveBeenLastCalledWith('reconnecting');
  await vi.advanceTimersByTimeAsync(1000);
  expect(sockets[1].url).toContain('token=t2');
  expect(XtermMock).toHaveBeenCalledTimes(1);
});

it('does not reconnect after unmount', async () => {
  const view = render(<Terminal id="hub" onStatus={statusSpy} />);
  await flushPromises();
  view.unmount();
  sockets[0].close(1006, '');
  await vi.advanceTimersByTimeAsync(8000);
  expect(sockets).toHaveLength(1);
});
```

Also test retry delays 1/2/4 seconds, intentional close, manual retry, and close-reason copy.

- [ ] **Step 2: Verify tests fail**

Run: `cd frontend && npm test -- --run src/screens/Terminal.test.tsx`  
Expected: FAIL because Terminal has no retry loop and `Conn` lacks `reconnecting`.

- [ ] **Step 3: Implement stable-xterm reconnect loop**

Inside one `useEffect`, create xterm once and define:

```ts
const delays = [1000, 2000, 4000];
let attempt = 0;
let retryTimer: number | undefined;

const connect = async () => {
  const token = await getPtyToken();
  if (disposed) return;
  const next = new WebSocket(`${scheme}://${window.location.host}/pty?device=${encodeURIComponent(id)}&token=${token}`);
  next.binaryType = 'arraybuffer';
  ws = next;
  next.onopen = () => { attempt = 0; onStatus('connected'); sendResize(); term.focus(); };
  next.onmessage = (ev) => term.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data));
  next.onclose = (ev) => {
    if (disposed || ev.code === 1000) return onStatus('closed');
    if (attempt < delays.length) {
      onStatus('reconnecting');
      retryTimer = window.setTimeout(() => { attempt += 1; void connect(); }, delays[attempt]);
    } else onStatus('closed');
  };
  next.onerror = () => { if (!disposed) onStatus('error'); };
};
```

Expose a quiet retry button only after automatic retries are exhausted. Map close codes
4001/4002/4003/4005/4006/1009 to fixed copy without rendering server-provided arbitrary text.

- [ ] **Step 4: Complete development proxy and PWA exclusions**

Add WebSocket proxies for `/run` and `/agent`, and HTTP proxies for `/devices`, `/sessions`,
`/rollup`, and `/note`. Add the same backend route prefixes to the Workbox navigation fallback
denylist:

```ts
'/run': { target: HUB_ORIGIN, changeOrigin: true, ws: true },
'/agent': { target: HUB_ORIGIN, changeOrigin: true, ws: true },
'/devices': { target: HUB_ORIGIN, changeOrigin: true },
'/sessions': { target: HUB_ORIGIN, changeOrigin: true },
'/rollup': { target: HUB_ORIGIN, changeOrigin: true },
'/note': { target: HUB_ORIGIN, changeOrigin: true },
```

- [ ] **Step 5: Run Terminal and console tests**

Run: `cd frontend && npm test -- --run src/screens/Terminal.test.tsx src/screens/Machines.test.tsx`  
Expected: all selected tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/DeviceConsole.tsx frontend/src/screens/Terminal.tsx frontend/src/screens/Terminal.module.css frontend/src/screens/Terminal.test.tsx frontend/vite.config.ts
git commit -m "feat(frontend): reconnect terminal without losing xterm state"
```

---

### Task 7: Shell limits and backpressure

**Files:**
- Modify: `hub/src/shell.js`
- Modify: `hub/src/shell.test.js`
- Modify: `hub/src/server.js`

**Interfaces:**
- Produces constants `SHELL_COMMAND_BYTES = 65536`, `SHELL_COMMAND_OUTPUT_BYTES = 8 MiB`,
  `SHELL_CONNECTION_OUTPUT_BYTES = 64 MiB`.
- Consumes a `relayLimiter.acquire('shell')` lease.

- [ ] **Step 1: Add failing pure helper tests**

Add and test:

```js
export const SHELL_COMMAND_BYTES = 65_536;
export const commandFits = (cmd) =>
  typeof cmd === 'string' && Buffer.byteLength(cmd, 'utf8') <= SHELL_COMMAND_BYTES;

test('commandFits measures UTF-8 bytes', () => {
  assert.equal(commandFits('a'.repeat(65_536)), true);
  assert.equal(commandFits('😀'.repeat(20_000)), false);
});
```

- [ ] **Step 2: Verify the test fails, then implement helper**

Run: `cd hub && node --test src/shell.test.js`  
Expected before implementation: FAIL because `commandFits` is missing.  
Expected after implementation: PASS.

- [ ] **Step 3: Harden `bridgeShell()`**

Acquire a Shell lease before spawning. Reject with 4006 when unavailable. Track:

```js
let commandBytes = 0;
let connectionBytes = 0;
let running = false;
let lastInputAt = Date.now();
```

Reject a second command while `running`, reject oversized commands with close code 1009, reset
`commandBytes` at the sentinel, and close with 4003 when command or connection output reaches its
cap. Check `ws.bufferedAmount` and call `child.stdout.pause()` above 256 KiB, then poll until below
64 KiB and call `resume()`. Close 4005 after ten blocked seconds. Release the limiter on child
exit, socket close, spawn failure, and idle timeout exactly once.

Replace `run_stderr` content logging with `{ device, bytes: c.length }`.

- [ ] **Step 4: Run Hub and CommandChat tests**

Run: `cd hub && npm test`  
Run: `cd frontend && npm test -- --run src/screens/CommandChat.test.tsx`  
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add hub/src/shell.js hub/src/shell.test.js hub/src/server.js
git commit -m "feat(shell): bound command relay resources"
```

---

### Task 8: Agent limits without event loss

**Files:**
- Modify: `hub/src/agent.js`
- Modify: `hub/src/agent.test.js`
- Modify: `hub/src/server.js`

**Interfaces:**
- Adds `AGENT_PROMPT_BYTES = 65536` and `agentPromptFits(text)`.
- Agent bridge acquires `relayLimiter.acquire('agent')`.

- [ ] **Step 1: Add failing prompt-byte tests**

```js
test('agentPromptFits caps UTF-8 bytes', () => {
  assert.equal(agentPromptFits('a'.repeat(65_536)), true);
  assert.equal(agentPromptFits('😀'.repeat(20_000)), false);
});
```

- [ ] **Step 2: Verify failure and implement helper**

Run: `cd hub && node --test src/agent.test.js`  
Expected before implementation: FAIL on missing export.  
Expected after implementation: PASS.

- [ ] **Step 3: Replace count-based Agent buffer**

Change bridge state from `buf: []` to:

```js
const b = {
  child, ws, buf: [], bufferedBytes: 0, outputBytes: 0,
  lineBuf: '', graceTimer: null, release, paused: false, blockedTimer: null,
};
```

`deliverAgent()` must count `Buffer.byteLength(msg)`, pause `child.stdout` at 256 KiB while
detached or socket-backed-up, resume below 64 KiB, and terminate the process group at 64 MiB or
after ten blocked seconds. Delete `b.buf.shift()` entirely.

Reject oversized user messages with close code 1009. Acquire the Agent lease before spawn and
release it exactly once on exit, delete, grace kill, or spawn failure. Log stderr byte counts only.
Start a 30-minute idle timer after each completed result; reset it on valid user input and close
the Agent process group with an `idle_timeout` status when it expires.

- [ ] **Step 4: Add focused bridge tests through exported pure accounting helpers**

Export `queueAgentMessage(b, msg, limits)` and test:

```js
test('queueAgentMessage never drops and signals pause at high water', () => {
  const b = { ws: null, buf: [], bufferedBytes: 0, outputBytes: 0 };
  assert.equal(queueAgentMessage(b, '12345', { highWaterBytes: 4, outputBytes: 100 }), 'pause');
  assert.deepEqual(b.buf, ['12345']);
  assert.equal(b.bufferedBytes, 5);
});
```

- [ ] **Step 5: Run Agent, session, and frontend tests**

Run: `cd hub && node --test src/agent.test.js src/sessions.test.js`  
Run: `cd frontend && npm test -- --run src/screens/AgentChat.test.tsx src/screens/AgentSessions.test.tsx`  
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add hub/src/agent.js hub/src/agent.test.js hub/src/server.js
git commit -m "feat(agent): apply bounded lossless output flow control"
```

---

### Task 9: Terminal-resilience verification

**Files:**
- Modify: `docs/SPRINTS.md`
- Create: `docs/git/commit-logs/2026-07-26_terminal-resilience.md`

**Interfaces:**
- Produces a green, documented Terminal/Shell/Agent milestone for the retention plan.

- [ ] **Step 1: Run all automated tests**

Run:

```bash
(cd hub && npm test)
(cd shared && node --test)
(cd collector && npm test)
(cd frontend && npm test)
(cd frontend && npm run typecheck)
(cd frontend && npm run build)
```

Expected: 0 failures; build emits `frontend/dist`.

- [ ] **Step 2: Run local Playwright smoke**

Run: `cd frontend && npm run e2e`  
Expected: unlock-screen smoke passes and `/healthz` responds.

- [ ] **Step 3: Update sprint evidence**

Mark each Sprint 4 checkbox complete only when its associated automated evidence is green. Add
the exact test totals and keep the live iPhone acceptance item explicitly pending for the release
plan.

- [ ] **Step 4: Add commit log**

Record the PTY state manager, OSC sanitizer, flow-control limits, reconnect UI, Shell/Agent caps,
test totals, and the fact that live iPhone acceptance remains for the release phase.

- [ ] **Step 5: Commit**

```bash
git add docs/SPRINTS.md docs/git/commit-logs/2026-07-26_terminal-resilience.md
git commit -m "docs: record terminal resilience milestone"
```
