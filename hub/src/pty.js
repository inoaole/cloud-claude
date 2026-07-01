// Terminal relay helpers (Sprint 3). The WS bridge itself lives in server.js; this module
// holds the two testable, IO-free pieces: short-lived WS tokens and the spawn-command
// builder. NO shell is ever involved — node-pty spawns (file, args) directly, and the tmux
// session name is fixed, so there is no command-injection surface.
import crypto from 'node:crypto';

const TOKEN_TTL_MS = 30_000;
const tokens = new Map(); // token -> { sid, exp }

/** Issue a short-lived, single-use WS token bound to an authenticated session. */
export function issueWsToken(sid, now = Date.now()) {
  const token = crypto.randomBytes(24).toString('base64url');
  tokens.set(token, { sid, exp: now + TOKEN_TTL_MS });
  return { token, ttl: TOKEN_TTL_MS / 1000 };
}

/** Consume a WS token → its sid, or null if unknown/expired. Single-use (deleted on read). */
export function consumeWsToken(token, now = Date.now()) {
  const entry = token && tokens.get(token);
  if (!entry) return null;
  tokens.delete(token);
  return now <= entry.exp ? entry.sid : null;
}

/** Drop expired tokens (called periodically). Exposed for tests. */
export function sweepTokens(now = Date.now()) {
  for (const [t, e] of tokens) if (now > e.exp) tokens.delete(t);
}

/**
 * Build the node-pty spawn command for a device — always `(file, args)`, never a shell
 * string. Target = one of: the hub itself (local tmux), a Linux peer (Tailscale SSH), or a
 * Mac (classic SSH over the tailnet with the hub key + explicit tmux path). Session name is
 * fixed (`opts.session`), so `attach || new` re-attaches the one phone session.
 */
export function buildCommand(device, opts = {}) {
  const session = opts.session || 'phone';
  const tmuxArgs = ['new', '-A', '-s', session];

  if (device.role === 'hub') {
    // We're running ON the hub — spawn tmux locally, no SSH hop.
    return { file: 'tmux', args: tmuxArgs };
  }

  if (device.connect === 'tailscale-ssh') {
    const target = `${device.sshUser || 'ubuntu'}@${device.tailnet || device.sshHost}`;
    return { file: 'tailscale', args: ['ssh', target, '--', 'tmux', ...tmuxArgs] };
  }

  // Mac / classic SSH over the tailnet. Non-login ssh lacks Homebrew's PATH, so tmux is
  // invoked by absolute path. Hub key only; strict-but-TOFU host key; no password prompts.
  const target = `${device.sshUser}@${device.sshHost || device.tailnet}`;
  const tmux = opts.macTmuxPath || '/opt/homebrew/bin/tmux';
  return {
    file: 'ssh',
    args: [
      '-i', opts.hubKeyPath,
      '-tt',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'BatchMode=yes',
      '-o', 'ServerAliveInterval=20',
      target,
      tmux, ...tmuxArgs,
    ],
  };
}

/** Is this WS Origin allowed? Must exactly match the host serving the page (same-origin). */
export function originAllowed(origin, host) {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
