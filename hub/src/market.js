// POST /api/market/briefing + GET /api/market/latest.
//
// The briefing runner (a device, bearer-authed like a collector) posts one record per run.
// Pure-handler pattern like ingest.js/notes.js so the logic tests without HTTP.
//
// Two decisions worth stating, because both look like over-engineering until they aren't:
//
// 1. `run_id` is the key, not `date`. A briefing that came out degraded gets re-run and
//    corrected the same morning; keying on date would make INSERT OR IGNORE reject the fix.
//    "Current" for a date is simply the newest row.
//
// 2. `latest` answers ready | pending | missing, never 404. "No briefing yet" and "the
//    generator never reported" are different sentences, and the client renders them
//    differently. A 404 collapses both into something indistinguishable from a routing bug.
import { authorizeDevice } from './bearer-auth.js';

export const STATUSES = new Set(['ok', 'degraded', 'failed']);
const RUN_ID_RE = /^[A-Za-z0-9:_.\-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The briefing is expected by 06:30 in Seoul. Past that with nothing stored, the hub calls it
// missing on its own authority — the runner cannot report a machine that was powered off.
export const EXPECTED_HOUR_KST = 6;
export const EXPECTED_MINUTE_KST = 30;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Local (Asia/Seoul) civil date+time for an epoch ms, without pulling in a tz library. */
export function kstParts(nowMs) {
  const d = new Date(nowMs + KST_OFFSET_MS);
  return {
    date: d.toISOString().slice(0, 10),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

/** Validate + store one briefing. Returns { status, body } for the route to forward. */
export function handleBriefing({ devices, body, authHeader, insertFn, now = Date.now() }) {
  if (!authorizeDevice(devices, body?.device_id, authHeader)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  const runId = body?.run_id;
  if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) {
    return { status: 400, body: { error: 'bad_run_id' } };
  }
  if (typeof body?.date !== 'string' || !DATE_RE.test(body.date)) {
    return { status: 400, body: { error: 'bad_date' } };
  }
  if (!STATUSES.has(body?.status)) {
    return { status: 400, body: { error: 'bad_status' } };
  }
  // A failed briefing legitimately has no audio; anything else must be a plain filename so
  // it cannot escape the served directory.
  const audioPath = body?.audio?.path ?? null;
  if (audioPath !== null && (typeof audioPath !== 'string' || audioPath.includes('/') || audioPath.includes('..'))) {
    return { status: 400, body: { error: 'bad_audio_path' } };
  }

  const inserted = insertFn({
    run_id: runId,
    date: body.date,
    status: body.status,
    payload: JSON.stringify(body),
    audio_path: audioPath,
    created_at: now,
  });
  return { status: 200, body: { ok: true, run_id: runId, stored: inserted } };
}

/**
 * What the phone should render right now.
 *
 * ready   — a briefing exists for today
 * pending — none yet, but 06:30 KST has not passed
 * missing — none, and the deadline is behind us (the generator did not report)
 */
export function latestFor(getFn, now = Date.now()) {
  const { date, minutes } = kstParts(now);
  const row = getFn(date);
  if (row) {
    return { state: 'ready', briefing: JSON.parse(row.payload), run_id: row.run_id };
  }
  const deadline = EXPECTED_HOUR_KST * 60 + EXPECTED_MINUTE_KST;
  return {
    state: minutes < deadline ? 'pending' : 'missing',
    expected_at: `${date}T06:30:00+09:00`,
  };
}
