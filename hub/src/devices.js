// Device registry + reachability probe for the Machines tab (Sprint 2).
// The hub is the right vantage point: it's always-on and on the tailnet, so it probes
// the other machines. Probe = `tailscale status` (a hint: is the peer online) + a TCP
// connect to the SSH port (the truth: is it actually reachable). Offline reasons are
// distinguished (asleep / not-on-tailnet / ssh-closed / firewall) so the UI is honest.
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SSH_PORT = 22;

/** Load the allowlist (devices.json). Missing file → [] (honest empty, not a crash). */
export async function loadDevices(file) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.devices) ? parsed.devices : [];
}

/** Read `tailscale status --json`. Returns the parsed object, or null if unavailable. */
export async function readTailnetStatus(runner = defaultRunner) {
  try {
    const out = await runner();
    return JSON.parse(out);
  } catch {
    return null; // tailscale not on PATH / not up — probe degrades gracefully
  }
}

function defaultRunner() {
  return execFileAsync('tailscale', ['status', '--json'], { timeout: 5000 }).then((r) => r.stdout);
}

/** Find the tailnet peer for a device by MagicDNS name or by tailnet IP. */
export function findPeer(device, status) {
  if (!status) return null;
  const all = [status.Self, ...Object.values(status.Peer || {})].filter(Boolean);
  const byName = (p) =>
    device.tailnet &&
    (p.HostName === device.tailnet || (p.DNSName || '').split('.')[0] === device.tailnet);
  const byIp = (p) => device.sshHost && (p.TailscaleIPs || []).includes(device.sshHost);
  return all.find((p) => byName(p) || byIp(p)) || null;
}

/** TCP connect probe. Resolves 'open' | 'refused' | 'timeout' | 'error' (never rejects). */
export function tcpProbe(host, port = SSH_PORT, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; sock.destroy(); resolve(r); } };
    const sock = net.connect({ host, port });
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done('open'));
    sock.once('timeout', () => done('timeout'));
    sock.once('error', (e) => done(e.code === 'ECONNREFUSED' ? 'refused' : 'error'));
  });
}

function result(status, reason, detail) {
  return { status, reason, detail };
}

/**
 * Probe one device. `status` = tailscale status object (or null). `tcp` is injectable
 * for tests. Returns { status: 'online'|'offline'|'disabled', reason, detail }.
 */
export async function probeDevice(device, status, { tcp = tcpProbe } = {}) {
  if (device.enabled === false) return result('disabled', 'disabled', 'Turned off in config');
  if (device.role === 'hub') return result('online', null, 'This hub');

  const peer = findPeer(device, status);
  if (status && !peer) {
    // Visible tailnet but this device isn't in it: ACL-denied or not joined.
    return result('offline', 'not-on-tailnet', 'Not on the tailnet (ACL or not joined)');
  }
  if (peer && !peer.Online) {
    return result('offline', 'asleep', 'Offline or asleep');
  }

  const ip = (peer?.TailscaleIPs || []).find((a) => a.includes('.')) || device.sshHost;
  if (!ip) return result('offline', 'no-address', 'No tailnet address to reach');

  const r = await tcp(ip, SSH_PORT);
  if (r === 'open') return result('online', null, null);
  if (r === 'refused') return result('offline', 'ssh-closed', 'Online, but SSH is closed (Remote Login off?)');
  if (r === 'timeout') return result('offline', 'firewall', 'Online, but the SSH port is blocked (firewall?)');
  return result('offline', 'unreachable', 'Online, but unreachable');
}

/** Probe every device (in parallel) → the shape the Machines tab renders. */
export async function probeAll(devices, status, deps) {
  return Promise.all(
    devices.map(async (d) => {
      const p = await probeDevice(d, status, deps);
      return { id: d.id, label: d.label, os: d.os ?? null, isHub: d.role === 'hub', ...p };
    }),
  );
}
