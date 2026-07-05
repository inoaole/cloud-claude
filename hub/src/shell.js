// Command-block relay (Chat mode). Unlike /pty (a live tmux stream), this runs a persistent
// non-interactive login shell on the device and delimits each command with a sentinel, so the
// UI can show one command = one output block + exit code. No tty → no echo, no color noise,
// but no live TUIs (vim/htop) — that's what Terminal mode is for.
import { assertSafeArg } from './pty.js';

const SENTINEL_RE = /__CC_END_([A-Za-z0-9]+)_(\d+)__/;

/** Build the spawn command for a persistent login shell on the device (NO tty, NO shell string). */
export function buildShellCommand(device, opts = {}) {
  if (device.role === 'hub') {
    return { file: 'bash', args: ['-l'] }; // we're on the hub — local shell
  }
  if (device.connect === 'tailscale-ssh') {
    const user = assertSafeArg(device.sshUser || 'ubuntu', 'sshUser');
    const host = assertSafeArg(device.tailnet || device.sshHost, 'tailnet');
    return { file: 'tailscale', args: ['ssh', `${user}@${host}`, '--', 'bash', '-l'] };
  }
  const user = assertSafeArg(device.sshUser, 'sshUser');
  const host = assertSafeArg(device.sshHost || device.tailnet, 'sshHost');
  return {
    file: 'ssh',
    args: ['-i', opts.hubKeyPath, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes',
      `${user}@${host}`, 'bash', '-l'],
  };
}

// Sent once on connect so brew tools resolve even in a bare login shell.
export const SHELL_INIT = 'export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" 2>/dev/null\n';

/**
 * Wrap a user command so its output is self-delimiting: run it in a group with stdin from
 * /dev/null (so it can't swallow our control stream), stderr merged into stdout (ordered),
 * then print an exit sentinel. `id` must be alphanumeric (validated at the WS boundary).
 */
export function wrapCommand(id, cmd) {
  return `{ ${cmd}\n} </dev/null 2>&1; __rc=$?; printf '\\n__CC_END_${id}_%s__\\n' "$__rc"\n`;
}

/** If a line IS an exit sentinel, return { id, exit }; else null. */
export function matchSentinel(line) {
  const m = SENTINEL_RE.exec(line);
  return m ? { id: m[1], exit: Number(m[2]) } : null;
}

export const isValidRunId = (id) => typeof id === 'string' && /^[A-Za-z0-9]+$/.test(id);
