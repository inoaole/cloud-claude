// Shared event schema + validation — imported by both hub/ and collector/ so they can't drift.
// Stub for Sprint 0; the Hub-plane collector (Module 2) fills this in.
//
// Event shape (eng-reviewed 2026-07-01):
//   { event_id, device_id, kind, ts_device, ts_hub, schema_version, payload }
// kinds: commit_seen | session_observed | heartbeat | note
// event_id is DETERMINISTIC (e.g. commit:<device>:<repo>:<sha>) so restart/rescan dedups.

export const SCHEMA_VERSION = 1;
export const KINDS = ['commit_seen', 'session_observed', 'heartbeat', 'note'];

/** Placeholder validator — real per-kind validation lands with the collector (Module 2). */
export function validateEvent(e) {
  if (!e || typeof e !== 'object') return 'not an object';
  if (!e.event_id) return 'missing event_id';
  if (!KINDS.includes(e.kind)) return `bad kind: ${e.kind}`;
  return null; // null = valid
}
