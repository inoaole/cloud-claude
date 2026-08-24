// POST /ingest logic (Sprint 5, v1a) — kept as a pure function so it's unit-testable without HTTP.
// Auth = per-device ingest token (Bearer), SEPARATE from the phone PIN. A leaked token can only
// POST timeline events for that one allowlisted device — no shell, no agent, minimal blast radius.
import { validateEvent, V1_KINDS } from '../../shared/schema.js';
import { authorizeDevice, bearer, tokenMatches } from './bearer-auth.js';

export const INGEST_MAX = 200; // events per request (paired with the 64kb body cap in server.js)

// Re-exported so existing importers (and ingest.test.js) keep working after the
// move to bearer-auth.js, which /api/market/briefing shares.
export { bearer, tokenMatches };

/**
 * Validate auth + body, then insert via the injected `insertFn(events, now)`.
 * Returns { status, body } — the caller (server.js route) just forwards it.
 */
export function handleIngest({ devices, body, authHeader, insertFn, now }) {
  const deviceId = body?.device_id;
  // Unknown/disabled device, no configured token, or a bad/missing bearer → 401 (don't say why).
  if (!authorizeDevice(devices, deviceId, authHeader)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }

  const events = body?.events;
  if (!Array.isArray(events)) return { status: 400, body: { error: 'events_not_array' } };
  if (events.length > INGEST_MAX) return { status: 400, body: { error: 'too_many_events' } };
  for (const e of events) {
    // Every event must belong to the authed device — no cross-device forging on one token.
    if (e?.device_id !== deviceId) return { status: 400, body: { error: 'device_mismatch' } };
    const err = validateEvent(e, V1_KINDS); // v1a: commit_seen/heartbeat only
    if (err) return { status: 400, body: { error: 'invalid_event', detail: err } };
  }
  if (events.length === 0) return { status: 200, body: { accepted: 0, ignored: 0 } };

  const { accepted, ignored } = insertFn(events, now ?? Date.now());
  return { status: 200, body: { accepted, ignored } };
}
