import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleBriefing, latestFor, kstParts } from './market.js';
import { openDb, insertBriefing, latestBriefing } from './db.js';

const DEV = 'briefing-runner';
const TOKEN = 'tok-briefing-secret';
const devices = [
  { id: DEV, ingestToken: TOKEN },
  { id: 'notoken' },
  { id: 'disabled', ingestToken: TOKEN, enabled: false },
];
const auth = `Bearer ${TOKEN}`;

const briefing = (over = {}) => ({
  device_id: DEV,
  run_id: '2026-08-18T06:30:00Z',
  date: '2026-08-18',
  status: 'ok',
  candidates: [],
  audio: { path: '2026-08-18T06:30:00Z.mp3' },
  ...over,
});

function stubInsert() {
  const rows = [];
  return { fn: (row) => { rows.push(row); return true; }, rows };
}

// ── auth ──────────────────────────────────────────────────────────────────────

test('valid bearer stores the briefing', () => {
  const ins = stubInsert();
  const r = handleBriefing({ devices, body: briefing(), authHeader: auth, insertFn: ins.fn });
  assert.equal(r.status, 200);
  assert.equal(ins.rows.length, 1);
});

test('bad/absent bearer is 401 and stores nothing', () => {
  const ins = stubInsert();
  for (const header of [undefined, 'Bearer wrong', 'Basic x']) {
    const r = handleBriefing({ devices, body: briefing(), authHeader: header, insertFn: ins.fn });
    assert.equal(r.status, 401);
  }
  assert.equal(ins.rows.length, 0);
});

test('disabled device cannot post (kill switch covers briefings too)', () => {
  const ins = stubInsert();
  const r = handleBriefing({
    devices, body: briefing({ device_id: 'disabled' }), authHeader: auth, insertFn: ins.fn,
  });
  assert.equal(r.status, 401);
});

// ── validation ────────────────────────────────────────────────────────────────

test('rejects a missing or malformed run_id', () => {
  const ins = stubInsert();
  for (const run_id of [undefined, '', 'has space', 'x'.repeat(65)]) {
    const r = handleBriefing({ devices, body: briefing({ run_id }), authHeader: auth, insertFn: ins.fn });
    assert.equal(r.status, 400, String(run_id));
    assert.equal(r.body.error, 'bad_run_id');
  }
});

test('rejects a bad date', () => {
  const ins = stubInsert();
  const r = handleBriefing({ devices, body: briefing({ date: '18/08/2026' }), authHeader: auth, insertFn: ins.fn });
  assert.equal(r.body.error, 'bad_date');
});

test('rejects a status outside the three-value enum', () => {
  const ins = stubInsert();
  for (const status of ['fine', 'OK', undefined, 'error']) {
    const r = handleBriefing({ devices, body: briefing({ status }), authHeader: auth, insertFn: ins.fn });
    assert.equal(r.body.error, 'bad_status', String(status));
  }
});

test('accepts all three real statuses', () => {
  const ins = stubInsert();
  for (const status of ['ok', 'degraded', 'failed']) {
    const r = handleBriefing({ devices, body: briefing({ status }), authHeader: auth, insertFn: ins.fn });
    assert.equal(r.status, 200, status);
  }
});

test('a failed briefing may carry no audio', () => {
  const ins = stubInsert();
  const r = handleBriefing({
    devices, body: briefing({ status: 'failed', audio: undefined }), authHeader: auth, insertFn: ins.fn,
  });
  assert.equal(r.status, 200);
  assert.equal(ins.rows[0].audio_path, null);
});

test('audio path may not escape the served directory', () => {
  const ins = stubInsert();
  for (const p of ['../../.env', 'sub/dir.mp3', '/etc/passwd']) {
    const r = handleBriefing({
      devices, body: briefing({ audio: { path: p } }), authHeader: auth, insertFn: ins.fn,
    });
    assert.equal(r.body.error, 'bad_audio_path', p);
  }
});

// ── idempotency + correction ──────────────────────────────────────────────────

test('same run_id twice stores one row; a new run_id corrects the day', () => {
  const db = openDb(':memory:');
  const row = (run_id, status) => ({
    run_id, date: '2026-08-18', status, payload: JSON.stringify({ run_id, status }),
    audio_path: null, created_at: run_id.length,
  });

  assert.equal(insertBriefing(db, row('run-a', 'degraded')), true);
  assert.equal(insertBriefing(db, row('run-a', 'degraded')), false); // retry is a no-op
  assert.equal(insertBriefing(db, row('run-bb', 'ok')), true);       // correction accepted

  // Newest wins — this is what makes a same-morning re-run actually fix the day.
  assert.equal(latestBriefing(db, '2026-08-18').run_id, 'run-bb');
});

test('a later failure record never masks a delivered briefing', () => {
  // Regression, 2026-08-19: the 06:30 run published `degraded` with full content,
  // then market-briefing-failed.service fired at 09:02 and its bare failure
  // record became "latest". The phone said the generator had failed on a morning
  // whose briefing was sitting in the table.
  const db = openDb(':memory:');
  const row = (run_id, status, created_at) => ({
    run_id, date: '2026-08-19', status, payload: JSON.stringify({ run_id, status }),
    audio_path: null, created_at,
  });

  insertBriefing(db, row('real-0630', 'degraded', 1000));
  insertBriefing(db, row('onfailure-0902', 'failed', 2000)); // newer, but empty

  assert.equal(latestBriefing(db, '2026-08-19').run_id, 'real-0630');
});

test('a failure still surfaces when it is all the day has', () => {
  // The reporter's whole purpose: a dead runner must not read as a quiet morning.
  const db = openDb(':memory:');
  insertBriefing(db, {
    run_id: 'onfailure-only', date: '2026-08-20', status: 'failed',
    payload: JSON.stringify({ status: 'failed' }), audio_path: null, created_at: 1000,
  });

  assert.equal(latestBriefing(db, '2026-08-20').status, 'failed');
});

test('a newer real briefing still overrides an older failure', () => {
  const db = openDb(':memory:');
  const row = (run_id, status, created_at) => ({
    run_id, date: '2026-08-21', status, payload: '{}', audio_path: null, created_at,
  });

  insertBriefing(db, row('early-failure', 'failed', 1000));
  insertBriefing(db, row('retry-ok', 'ok', 2000));

  assert.equal(latestBriefing(db, '2026-08-21').run_id, 'retry-ok');
});

// ── latest: ready / pending / missing ─────────────────────────────────────────

const AUG18_0500_KST = Date.UTC(2026, 7, 17, 20, 0); // 05:00 KST on 2026-08-18
const AUG18_0800_KST = Date.UTC(2026, 7, 17, 23, 0); // 08:00 KST on 2026-08-18

test('kstParts maps a UTC instant to the Seoul civil date', () => {
  const p = kstParts(AUG18_0500_KST);
  assert.equal(p.date, '2026-08-18');
  assert.equal(p.minutes, 5 * 60);
});

test('ready when a briefing exists for today', () => {
  const get = () => ({ run_id: 'r1', payload: JSON.stringify({ status: 'ok' }) });
  const out = latestFor(get, AUG18_0800_KST);
  assert.equal(out.state, 'ready');
  assert.equal(out.briefing.status, 'ok');
});

test('pending before the 06:30 deadline', () => {
  const out = latestFor(() => null, AUG18_0500_KST);
  assert.equal(out.state, 'pending');
  assert.match(out.expected_at, /^2026-08-18T06:30/);
});

test('missing after the deadline — the hub says so on its own authority', () => {
  // The runner cannot report a machine that was powered off, so absence has to be
  // judged here rather than inferred from silence.
  const out = latestFor(() => null, AUG18_0800_KST);
  assert.equal(out.state, 'missing');
});
