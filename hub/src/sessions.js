// Agent session registry (v0.6 — agent-only; shell/terminal stay ad-hoc per codex #10).
// In-memory metadata only: {id, deviceId, kind, title, cwd, status, createdAt}. The claude child
// process lifecycle lives in server.js (the WS bridge); this just tracks what exists so the phone
// can list / create / kill. In-mem is fine for v0.6 — a hub restart clears sessions (documented).
import crypto from 'node:crypto';

const sessions = new Map();
const STATUSES = new Set(['starting', 'running', 'idle', 'exited', 'error']);

// ── Transcript ────────────────────────────────────────────────────────────────
// The WS is a live relay, not a log: `deliverAgent` used to send an event and keep
// nothing, so leaving the screen emptied the chat and there was no past to replay.
//
// The transcript hangs off the SESSION, not the bridge, on purpose. The claude
// child is killed 45s after the socket detaches, and the bridge dies with it — so
// a transcript kept on the bridge would be gone exactly when the user comes back,
// which is the case that prompted this.
//
// In-memory, like the rest of this registry: a hub restart clears it. Bounded two
// ways because a single Bash tool result can be megabytes.
const transcripts = new Map();
const MAX_EVENTS = 500;
const MAX_FIELD_CHARS = 4096;

/** Trim the unbounded fields. Live delivery keeps the full text; only the stored copy shrinks. */
function _bound(evt) {
  const out = { ...evt };
  for (const field of ['output', 'text']) {
    const v = out[field];
    if (typeof v === 'string' && v.length > MAX_FIELD_CHARS) {
      out[field] = `${v.slice(0, MAX_FIELD_CHARS)}\n… (truncated in transcript)`;
    }
  }
  return out;
}

/**
 * Append one replayable event. Returns the stored event, or null if skipped.
 *
 * `assistant_delta` is deliberately NOT stored: it is the token-by-token stream
 * for the typing feel, and the `assistant` event that follows carries the same
 * text in full. Keeping deltas would multiply the log by ~100x to replay
 * something the next event already says.
 */
export function appendEvent(sessionId, evt) {
  if (!sessionId || !evt || evt.type === 'assistant_delta') return null;
  const log = transcripts.get(sessionId) || [];
  const stored = _bound(evt);
  log.push(stored);
  if (log.length > MAX_EVENTS) log.splice(0, log.length - MAX_EVENTS);
  transcripts.set(sessionId, log);
  return stored;
}

/** Everything needed to rebuild the chat, oldest first. Empty for an unknown session. */
export function getTranscript(sessionId) {
  return transcripts.get(sessionId) || [];
}

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
  transcripts.delete(id); // explicit kill discards the chat; a detach must not
  return s;
}

/** Test-only reset. */
export function _clear() {
  sessions.clear();
  transcripts.clear();
}
