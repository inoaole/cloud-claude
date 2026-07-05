// Agent session registry (v0.6 — agent-only; shell/terminal stay ad-hoc per codex #10).
// In-memory metadata only: {id, deviceId, kind, title, cwd, status, createdAt}. The claude child
// process lifecycle lives in server.js (the WS bridge); this just tracks what exists so the phone
// can list / create / kill. In-mem is fine for v0.6 — a hub restart clears sessions (documented).
import crypto from 'node:crypto';

const sessions = new Map();
const STATUSES = new Set(['starting', 'running', 'idle', 'exited', 'error']);

/** Create an agent session's metadata. The child is spawned later when a WS attaches. */
export function createSession({ deviceId, cwd, title } = {}, now = Date.now()) {
  if (!deviceId) throw new Error('deviceId required');
  const id = crypto.randomBytes(6).toString('base64url');
  const s = { id, deviceId, kind: 'agent', title: title || cwd || deviceId, cwd: cwd || null, status: 'starting', createdAt: now };
  sessions.set(id, s);
  return s;
}

/** All sessions, or just one device's, newest first. */
export function listSessions(deviceId) {
  const all = [...sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
  return deviceId ? all.filter((s) => s.deviceId === deviceId) : all;
}

export function getSession(id) {
  return sessions.get(id) || null;
}

export function setStatus(id, status) {
  if (!STATUSES.has(status)) throw new Error(`bad status: ${status}`);
  const s = sessions.get(id);
  if (s) s.status = status;
  return s || null;
}

/** Remove a session's metadata (the caller kills the child first). Returns it, or null. */
export function removeSession(id) {
  const s = sessions.get(id) || null;
  sessions.delete(id);
  return s;
}

/** Test-only reset. */
export function _clear() {
  sessions.clear();
}
