// Shared bearer-token auth for device-authenticated POST routes (/ingest, /api/market/briefing).
//
// Extracted from ingest.js when the briefing endpoint arrived: two copies of a constant-time
// compare is one copy too many. Security code that exists twice gets fixed once.
import crypto from 'node:crypto';

/** Extract the bearer token from an Authorization header, or null. */
export function bearer(authHeader) {
  const m = /^Bearer (.+)$/.exec(authHeader || '');
  return m ? m[1] : null;
}

/** Constant-time token compare (length-guarded) — no early-exit on the trust boundary. */
export function tokenMatches(input, expected) {
  const a = Buffer.from(String(input ?? ''), 'utf8');
  const b = Buffer.from(String(expected ?? ''), 'utf8');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Resolve the posting device, or null when it may not post.
 *
 * `enabled:false` is a kill switch: disabling a compromised device must revoke ALL of its
 * access, not just the console. Callers return an undifferentiated 401 — never say which
 * of "unknown device" / "no token configured" / "wrong token" it was.
 */
export function authorizeDevice(devices, deviceId, authHeader) {
  const device = devices.find((d) => d.id === deviceId && d.enabled !== false);
  const token = bearer(authHeader);
  if (!device || !device.ingestToken || !token || !tokenMatches(token, device.ingestToken)) {
    return null;
  }
  return device;
}
