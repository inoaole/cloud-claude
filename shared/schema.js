// Shared event schema + validation — imported by BOTH hub/ and collector/ so they can't drift.
// The collector validates before enqueue (fail fast); the hub validates before insert (trust
// boundary). Same function, same rules, two sides.
//
// WIRE event (what the collector POSTs to /ingest):
//   { event_id, device_id, kind, ts_device, schema_version, payload }
// The hub stamps ts_hub on receive — it is NOT on the wire, so validateEvent does not require it.
//
// event_id is DETERMINISTIC so a restart / re-scan / outbox-retry dedups (INSERT OR IGNORE on the
// hub's PK) instead of duplicating:
//   commit_seen  → commit:<device>:<repoId>:<sha>   (repoId is a stable config id, NOT a path)
//   heartbeat    → heartbeat:<device>:<ts_device>   (ts_device = the run's start ms)

export const SCHEMA_VERSION = 1;

// Every kind the timeline knows about. session_observed/note land later (v1b / Sprint 6).
export const KINDS = ['commit_seen', 'session_observed', 'heartbeat', 'note'];

// The subset /ingest ACCEPTS in v1a. Anything else is rejected so we don't expose untested
// public API surface before the collector actually emits it.
export const V1_KINDS = ['commit_seen', 'heartbeat'];

export function commitEventId(deviceId, repoId, sha) {
  return `commit:${deviceId}:${repoId}:${sha}`;
}
export function heartbeatEventId(deviceId, runStartedMs) {
  return `heartbeat:${deviceId}:${runStartedMs}`;
}

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate a wire event. Returns null if valid, else a short error string.
 * `allowedKinds` lets /ingest restrict to V1_KINDS while the collector uses the same call.
 */
export function validateEvent(e, allowedKinds = KINDS) {
  if (!e || typeof e !== 'object') return 'not an object';
  if (!isStr(e.event_id)) return 'missing event_id';
  if (!isStr(e.device_id)) return 'missing device_id';
  if (!allowedKinds.includes(e.kind)) return `bad kind: ${e.kind}`;
  if (e.schema_version !== SCHEMA_VERSION) return `bad schema_version: ${e.schema_version}`;
  if (!isNum(e.ts_device) || e.ts_device <= 0) return 'bad ts_device';
  if (!e.payload || typeof e.payload !== 'object') return 'bad payload';

  switch (e.kind) {
    case 'commit_seen': {
      const p = e.payload;
      if (!isStr(p.repoId)) return 'commit_seen: bad repoId';
      if (!isStr(p.sha)) return 'commit_seen: bad sha';
      if (typeof p.subject !== 'string') return 'commit_seen: bad subject';
      if (!isNum(p.author_ts)) return 'commit_seen: bad author_ts';
      // Integrity: the id must be derivable from the payload (no forged/mismatched ids).
      if (e.event_id !== commitEventId(e.device_id, p.repoId, p.sha)) {
        return 'commit_seen: event_id does not match payload';
      }
      return null;
    }
    case 'heartbeat': {
      // Integrity: heartbeat id is keyed on the run's own ts_device (stable across outbox
      // retries of THIS run, distinct across runs — no wall-clock bucket collisions).
      if (e.event_id !== heartbeatEventId(e.device_id, e.ts_device)) {
        return 'heartbeat: event_id must be heartbeat:<device>:<ts_device>';
      }
      return null;
    }
    default:
      // session_observed / note: not emitted in v1a; deep validation lands with them.
      return null;
  }
}
