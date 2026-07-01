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

/** POSIX single-quote a string so it survives a remote shell re-parse. */
function sq(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

/**
 * Build the spawn command to run claude on a device. The device runs `cd <cwd> && exec claude …`
 * via a login shell (for PATH). Key correctness points:
 *  - NO `-tt`: a pty would echo our stream-json stdin back into claude's stdout and corrupt the
 *    event stream. We pipe stdin/stdout cleanly instead.
 *  - Cleanup: closing the local ssh EOFs claude's stdin and `claude -p --input-format stream-json`
 *    exits on EOF — so no orphan on the device (Stop = kill the ssh, D4 v0.6 = coarse brake).
 *  - ssh flattens argv after the host, so the remote command is ONE shell-quoted string.
 *  - cwd validated (assertCwd) + device fields via assertSafeArg → no injection.
 */
export function buildAgentCommand(device, cwd, opts = {}) {
  const safeCwd = assertCwd(cwd, opts.allowedRoots);
  const mode = opts.permissionMode || 'acceptEdits';
  const claudeCmd = ['claude', ...CLAUDE_FLAGS, '--permission-mode', mode].join(' ');
  // A non-login zsh user's brew PATH isn't on bash's login PATH, so `claude` isn't found —
  // prepend the common bin dirs (same fix as the shell relay's SHELL_INIT).
  const inner = `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; cd ${sq(safeCwd)} && exec ${claudeCmd}`;

  if (device.role === 'hub') {
    return { file: 'bash', args: ['-lc', inner] }; // local; detached spawn gives its own group
  }
  if (device.connect === 'tailscale-ssh') {
    const user = assertSafeArg(device.sshUser || 'ubuntu', 'sshUser');
    const host = assertSafeArg(device.tailnet || device.sshHost, 'tailnet');
    return { file: 'tailscale', args: ['ssh', `${user}@${host}`, '--', 'bash', '-lc', inner] };
  }
  const user = assertSafeArg(device.sshUser, 'sshUser');
  const host = assertSafeArg(device.sshHost || device.tailnet, 'sshHost');
  return {
    file: 'ssh',
    args: ['-i', opts.hubKeyPath, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes',
      '-o', 'ServerAliveInterval=20', `${user}@${host}`, `bash -lc ${sq(inner)}`],
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
