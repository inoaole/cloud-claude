import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, insertEvents } from './db.js';
import { localDayRange, todayInTz, buildRollup, assertTz, assertDate } from './rollup.js';
import { SCHEMA_VERSION, commitEventId, heartbeatEventId } from '../../shared/schema.js';

// ── TZ helpers ────────────────────────────────────────────────────────────────
test('localDayRange: KST normal day = [15:00Z prev, 15:00Z) — 24h, no DST', () => {
  const [start, end] = localDayRange('2026-07-02', 'Asia/Seoul');
  assert.equal(start, Date.parse('2026-07-01T15:00:00Z'));
  assert.equal(end, Date.parse('2026-07-02T15:00:00Z'));
  assert.equal(end - start, 24 * 3600_000);
});

test('localDayRange: NY spring-forward day is 23h', () => {
  const [start, end] = localDayRange('2026-03-08', 'America/New_York'); // DST starts 02:00→03:00
  assert.equal(end - start, 23 * 3600_000);
  assert.equal(start, Date.parse('2026-03-08T05:00:00Z')); // EST midnight
});

test('localDayRange: NY fall-back day is 25h', () => {
  const [start, end] = localDayRange('2026-11-01', 'America/New_York');
  assert.equal(end - start, 25 * 3600_000);
});

test('localDayRange: boundary ms — 23:59:59.999 in, next 00:00:00.000 out', () => {
  const [start, end] = localDayRange('2026-07-02', 'Asia/Seoul');
  assert.ok(end - 1 >= start && end - 1 < end); // last ms of the day is inside
  const [nextStart] = localDayRange('2026-07-03', 'Asia/Seoul');
  assert.equal(end, nextStart); // half-open ranges tile perfectly
});

test('todayInTz: 00:10 KST is TOMORROW relative to the hub UTC date', () => {
  const now = Date.parse('2026-07-02T15:10:00Z'); // = 2026-07-03 00:10 KST
  assert.equal(todayInTz(now, 'Asia/Seoul'), '2026-07-03');
  assert.equal(todayInTz(now, 'UTC'), '2026-07-02');
});

test('bad date / bad tz throw', () => {
  assert.throws(() => assertDate('2026-7-2'), /bad date/);
  assert.throws(() => assertDate('2026-13-99'), /bad date/);
  assert.throws(() => assertTz('Mars/Olympus'), /bad tz/);
  assert.throws(() => localDayRange('2026-07-02', ''), /bad tz/);
});

// ── buildRollup ───────────────────────────────────────────────────────────────
const TZ = 'Asia/Seoul';
const DATE = '2026-07-02';
const [DAY_START] = localDayRange(DATE, TZ);
const T = (h) => DAY_START + h * 3600_000; // hour h of the local day

function commit(dev, repoId, sha, ts) {
  return {
    event_id: commitEventId(dev, repoId, sha), device_id: dev, kind: 'commit_seen',
    ts_device: ts, schema_version: SCHEMA_VERSION,
    payload: { repoId, sha, subject: `s-${sha}`, author_ts: ts },
  };
}
function hb(dev, ts, payload = {}) {
  return {
    event_id: heartbeatEventId(dev, ts), device_id: dev, kind: 'heartbeat',
    ts_device: ts, schema_version: SCHEMA_VERSION,
    payload: { intervalSec: 180, reposOk: 1, reposFailed: 0, ...payload },
  };
}
// now = hour 20 of the local day (evening reflection time)
const NOW = T(20);

test('normal day: commits grouped by repo, pulse aggregated', () => {
  const db = openDb(':memory:');
  insertEvents(db, [
    commit('mbp', 'cloud-claude', 'aaa', T(10)), commit('mbp', 'cloud-claude', 'bbb', T(14)),
    commit('mbp', 'other', 'ccc', T(11)),
    hb('mbp', T(9)), hb('mbp', T(19.9)),
  ], NOW);
  const r = buildRollup(db, { date: DATE, tz: TZ, now: NOW });
  assert.equal(r.status, 'normal');
  assert.equal(r.commitCount, 3);
  assert.equal(r.commits.length, 2); // two repos
  const cc = r.commits.find((g) => g.repoId === 'cloud-claude');
  assert.deepEqual(cc.commits.map((c) => c.sha), ['bbb', 'aaa']); // newest first
  assert.equal(r.pulse.beats, 2);
  assert.equal(r.pulse.first, T(9));
  assert.equal(r.pulse.last, T(19.9));
});

test('D8: same commit observed by two devices → deduped once', () => {
  const db = openDb(':memory:');
  insertEvents(db, [
    commit('mbp', 'repo', 'dup', T(10)), commit('mini', 'repo', 'dup', T(10)),
    hb('mbp', T(19.9)),
  ], NOW);
  const r = buildRollup(db, { date: DATE, tz: TZ, now: NOW });
  assert.equal(r.commitCount, 1);
});

test('D8: per-device pulse — a dead device stays visible next to a healthy one', () => {
  const db = openDb(':memory:');
  insertEvents(db, [hb('mbp', T(9)), hb('mbp', T(19.9)), hb('mini', T(8))], NOW);
  const r = buildRollup(db, { date: DATE, tz: TZ, now: NOW });
  assert.equal(r.pulse.devices.length, 2);
  const mini = r.pulse.devices.find((d) => d.deviceId === 'mini');
  assert.equal(mini.beats, 1); // mini went quiet at hour 8 — visible, not masked by mbp
});

test('quiet day: fresh heartbeat, zero commits', () => {
  const db = openDb(':memory:');
  insertEvents(db, [hb('mbp', T(19.9))], NOW);
  const r = buildRollup(db, { date: DATE, tz: TZ, now: NOW });
  assert.equal(r.status, 'quiet');
  assert.equal(r.sensorDegraded, false);
});

test('offline: last heartbeat arrived (ts_hub) > 15 min ago', () => {
  const db = openDb(':memory:');
  insertEvents(db, [hb('mbp', T(10))], NOW - 16 * 60_000); // ts_hub = 16 min before now
  const r = buildRollup(db, { date: DATE, tz: TZ, now: NOW });
  assert.equal(r.status, 'offline');
});

test('D8: liveness uses ts_hub, NOT the device clock', () => {
  const db = openDb(':memory:');
  // Device clock is skewed FUTURE (ts_device ≈ now) but the hub last RECEIVED 20 min ago.
  insertEvents(db, [hb('mbp', NOW - 60_000)], NOW - 20 * 60_000);
  const r = buildRollup(db, { date: DATE, tz: TZ, now: NOW });
  assert.equal(r.status, 'offline'); // skewed ts_device must not fake liveness
});

test('past date never claims offline', () => {
  const db = openDb(':memory:');
  insertEvents(db, [hb('mbp', T(10))], T(10)); // heartbeats that day, silent since
  const nextWeek = NOW + 7 * 24 * 3600_000;
  const r = buildRollup(db, { date: DATE, tz: TZ, now: nextWeek });
  assert.equal(r.status, 'quiet'); // no commits that day; NOT offline
});

test('D8: sensorDegraded when the latest heartbeat reports failed repos', () => {
  const db = openDb(':memory:');
  insertEvents(db, [hb('mbp', T(19.9), { reposFailed: 1, reposOk: 0 })], NOW);
  const r = buildRollup(db, { date: DATE, tz: TZ, now: NOW });
  assert.equal(r.status, 'quiet');
  assert.equal(r.sensorDegraded, true); // not lying "quiet day" while git scan is broken
});

test('D4 regression: a 1100-heartbeat day aggregates exactly (no 1000-row truncation)', () => {
  const db = openDb(':memory:');
  const beats = [];
  for (let i = 0; i < 1100; i += 1) beats.push(hb(i % 2 ? 'mbp' : 'mini', DAY_START + 60_000 + i * 60_000));
  insertEvents(db, beats, NOW);
  const r = buildRollup(db, { date: DATE, tz: TZ, now: NOW });
  assert.equal(r.pulse.beats, 1100);
  assert.equal(r.pulse.last, DAY_START + 60_000 + 1099 * 60_000);
});

test('empty day: quiet in the past, no pulse', () => {
  const db = openDb(':memory:');
  insertEvents(db, [hb('mbp', NOW - 60_000)], NOW); // alive NOW, but nothing on the queried past day
  const r = buildRollup(db, { date: '2026-06-01', tz: TZ, now: NOW });
  assert.equal(r.status, 'quiet');
  assert.equal(r.pulse.beats, 0);
  assert.equal(r.pulse.first, null);
});

test('D5: a commit authored yesterday but flushed today lands on YESTERDAY', () => {
  const db = openDb(':memory:');
  const yesterday = '2026-07-01';
  const [yStart] = localDayRange(yesterday, TZ);
  // author_ts = yesterday 23:00, but the hub received it NOW (today) — late flush.
  insertEvents(db, [commit('mbp', 'repo', 'late', yStart + 23 * 3600_000)], NOW);
  const today = buildRollup(db, { date: DATE, tz: TZ, now: NOW });
  const yday = buildRollup(db, { date: yesterday, tz: TZ, now: NOW });
  assert.equal(today.commitCount, 0);
  assert.equal(yday.commitCount, 1); // on-read recompute puts it on its true day
});
