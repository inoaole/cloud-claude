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

// Every kind the timeline knows about. note lands with a later module.
export const KINDS = ['commit_seen', 'session_observed', 'heartbeat', 'note'];

// The subset /ingest ACCEPTS. Kinds join this list only when a collector actually emits them
// (no untested public API surface). v1a: commit_seen + heartbeat. v1b: + session_observed.
export const V1_KINDS = ['commit_seen', 'heartbeat', 'session_observed'];

// Tools the session scanner recognizes (v1b).
export const SESSION_TOOLS = ['claude', 'codex', 'tmux'];

export function commitEventId(deviceId, repoId, sha) {
  return `commit:${deviceId}:${repoId}:${sha}`;
}
export function heartbeatEventId(deviceId, runStartedMs) {
  return `heartbeat:${deviceId}:${runStartedMs}`;
}
export function sessionEventId(deviceId, tool, pid, startedMs) {
  return `session:${deviceId}:${tool}:${pid}:${startedMs}`;
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
    case 'session_observed': {
      // Emitted ONCE when the session ENDS (poll-diff observed the pid vanish).
      // ts_device = started ms → a session belongs to the day the work BEGAN.
      const p = e.payload;
      if (!SESSION_TOOLS.includes(p.tool)) return `session_observed: bad tool: ${p.tool}`;
      if (!isNum(p.pid) || p.pid <= 0) return 'session_observed: bad pid';
      if (!isNum(p.started) || p.started <= 0) return 'session_observed: bad started';
      if (!isNum(p.ended) || p.ended < p.started) return 'session_observed: bad ended';
      // cwd is a BASENAME or null — never a full path (privacy: no machine layout on the wire).
      if (p.cwd !== null && (!isStr(p.cwd) || p.cwd.includes('/'))) return 'session_observed: cwd must be a basename or null';
      if (e.ts_device !== p.started) return 'session_observed: ts_device must equal payload.started';
      if (e.event_id !== sessionEventId(e.device_id, p.tool, p.pid, p.started)) {
        return 'session_observed: event_id does not match payload';
      }
      return null;
    }
    default:
      // note: not device-emitted (the PIN path owns it); deep validation lands with it.
      return null;
  }
}
