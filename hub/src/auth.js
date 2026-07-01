// PIN auth + session handling (Sprint 1). Single-user, hardened.
// - constant-time PIN compare
// - crypto-random session ids, HMAC-signed cookie (tamper-proof), server-side revocable
// - rate-limit + lockout on failed PINs
import crypto from 'node:crypto';

export const COOKIE = 'cc_session';

// In-memory session store (single process, single user). sid -> expiresAtMs.
const sessions = new Map();
// Failed-attempt / lockout state (global — one user).
let fails = 0;
let lockedUntil = 0;
const MAX_FAILS = 5;
const LOCK_MS = 60_000;

/** Constant-time PIN comparison (avoids timing leaks). */
export function pinMatches(input, expected) {
  const a = Buffer.from(String(input ?? ''), 'utf8');
  const b = Buffer.from(String(expected ?? ''), 'utf8');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Seconds remaining on lockout, or 0 if unlocked. */
export function lockoutSeconds(now = Date.now()) {
  return lockedUntil > now ? Math.ceil((lockedUntil - now) / 1000) : 0;
}

export function recordFailure(now = Date.now()) {
  fails += 1;
  if (fails >= MAX_FAILS) {
    lockedUntil = now + LOCK_MS;
    fails = 0;
  }
}

export function resetFailures() {
  fails = 0;
  lockedUntil = 0;
}

export function createSession(ttlMs, now = Date.now()) {
  const sid = crypto.randomBytes(24).toString('base64url');
  sessions.set(sid, now + ttlMs);
  return sid;
}

export function sessionValid(sid, now = Date.now()) {
  if (!sid) return false;
  const exp = sessions.get(sid);
  if (!exp) return false;
  if (exp <= now) { sessions.delete(sid); return false; }
  return true;
}

export function revokeSession(sid) {
  if (sid) sessions.delete(sid);
}

/** Sign a session id: `<sid>.<hmac>` so a tampered cookie is rejected. */
export function signSid(sid, secret) {
  const mac = crypto.createHmac('sha256', secret).update(sid).digest('base64url');
  return `${sid}.${mac}`;
}

/** Verify + extract the sid from a signed cookie value, or null. */
export function unsignSid(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const sid = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(sid).digest('base64url');
  const macBuf = Buffer.from(mac);
  const expBuf = Buffer.from(expected);
  if (macBuf.length !== expBuf.length) return null;
  return crypto.timingSafeEqual(macBuf, expBuf) ? sid : null;
}
