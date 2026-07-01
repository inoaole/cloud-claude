// Agent mode (v0.6) — the hub drives `claude -p` in bidirectional stream-json over SSH and
// relays its JSONL events to the phone as structured chat blocks. claude runs ON the device
// (its own auth); the hub only pipes. Proven by the T0 spike (designs/agent-spike-20260701).
// This module holds the IO-free, testable pieces; the WS bridge lives in server.js.
import { assertSafeArg } from './pty.js';

// Fixed claude flags (verified 2.1.170): --print keeps the process alive reading stream-json
// user messages; --include-partial-messages gives token-level deltas for the typing feel.
const CLAUDE_FLAGS = [
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--include-partial-messages',
  '--verbose',
];

/** Validate a working directory: absolute, no traversal, no shell metacharacters, and (if
    allowedRoots given) under one of them. Throws on anything suspicious (codex #5/#14). */
export function assertCwd(cwd, allowedRoots) {
  if (typeof cwd !== 'string' || !cwd.startsWith('/')) throw new Error('cwd must be an absolute path');
  if (cwd.includes('..') || /[\s;&|$`'"\\<>(){}\x00-\x1f]/.test(cwd)) throw new Error(`cwd unsafe: ${cwd}`);
  if (Array.isArray(allowedRoots) && allowedRoots.length &&
      !allowedRoots.some((r) => cwd === r || cwd.startsWith(r.endsWith('/') ? r : `${r}/`))) {
    throw new Error(`cwd outside allowed roots: ${cwd}`);
  }
  return cwd;
}

/**
 * Build the spawn command to run claude on a device (NO shell string we construct — the remote
 * side runs `cd <cwd> && exec claude …` via the login shell; cwd is validated and the flags are
 * fixed constants, so there is no injection surface). `exec` + a device-side process group let
 * killing the ssh reap claude and its children.
 */
export function buildAgentCommand(device, cwd, opts = {}) {
  const safeCwd = assertCwd(cwd, opts.allowedRoots);
  const mode = opts.permissionMode || 'acceptEdits';
  const claude = ['claude', ...CLAUDE_FLAGS, '--permission-mode', mode];
  const remote = `cd '${safeCwd}' && exec ${claude.join(' ')}`;

  if (device.role === 'hub') {
    // Local: run under setsid so the whole group dies together; bash -lc for PATH.
    return { file: 'setsid', args: ['bash', '-lc', remote] };
  }
  if (device.connect === 'tailscale-ssh') {
    const user = assertSafeArg(device.sshUser || 'ubuntu', 'sshUser');
    const host = assertSafeArg(device.tailnet || device.sshHost, 'tailnet');
    return { file: 'tailscale', args: ['ssh', `${user}@${host}`, '--', 'setsid', 'bash', '-lc', remote] };
  }
  const user = assertSafeArg(device.sshUser, 'sshUser');
  const host = assertSafeArg(device.sshHost || device.tailnet, 'sshHost');
  // -tt so the remote gets a controlling tty → Ctrl-C / SIGINT interrupts propagate (Stop, D4).
  return {
    file: 'ssh',
    args: ['-i', opts.hubKeyPath, '-tt', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes',
      '-o', 'ServerAliveInterval=20', `${user}@${host}`, 'setsid', 'bash', '-lc', remote],
  };
}

/** One user turn, as a stream-json line for claude's stdin (schema verified in the spike). */
export function wrapUserMessage(text) {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;
}

/** tool_result content is a string or an array of {type:'text',text}. Normalize to a string. */
function normalizeToolContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === 'string' ? c : c?.text ?? '')).join('');
  return '';
}

/**
 * Map one claude stream-json event to zero-or-more WS events for the phone. An assistant message
 * carries an array of content blocks (thinking / text / tool_use), so it can fan out. Unknown /
 * chrome events (system hooks, rate_limit) map to nothing. Never throws on a malformed event.
 */
export function mapEvent(evt) {
  const out = [];
  try {
    const t = evt?.type;
    if (t === 'assistant' && Array.isArray(evt.message?.content)) {
      for (const c of evt.message.content) {
        if (c.type === 'text' && c.text) out.push({ type: 'assistant', text: c.text });
        else if (c.type === 'thinking' && (c.thinking || c.text)) out.push({ type: 'thinking', text: c.thinking ?? c.text });
        else if (c.type === 'tool_use') out.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input ?? {} });
      }
    } else if (t === 'user' && Array.isArray(evt.message?.content)) {
      for (const c of evt.message.content) {
        if (c.type === 'tool_result') {
          out.push({ type: 'tool_result', id: c.tool_use_id, ok: !c.is_error, output: normalizeToolContent(c.content) });
        }
      }
    } else if (t === 'stream_event') {
      // partial-message delta (token streaming). Surface text deltas for the typing feel.
      const d = evt.event?.delta;
      if (d?.type === 'text_delta' && d.text) out.push({ type: 'assistant_delta', text: d.text });
    } else if (t === 'result') {
      out.push({ type: 'result', ok: !evt.is_error, ms: evt.duration_ms ?? null, text: evt.result ?? null });
    } else if (t === 'system' && evt.subtype === 'init') {
      out.push({ type: 'status', state: 'ready' });
    }
  } catch {
    /* malformed event → emit nothing, keep the session alive (codex #17) */
  }
  return out;
}
