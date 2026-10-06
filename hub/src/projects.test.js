import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadProjects, weekStart, modeFor, summarizePerson, teamSummary, filterPrs, mapMessage,
} from './projects.js';

const kst = (iso) => Date.parse(`${iso}+09:00`);

// ── 주 ────────────────────────────────────────────────────────────────────────

test('weekStart: 일 23:59 KST 까지는 같은 주, 월 00:00 KST 부터 새 주', () => {
  assert.equal(weekStart(kst('2026-10-11T23:59:59')), '2026-10-05');
  assert.equal(weekStart(kst('2026-10-12T00:00:00')), '2026-10-12');
  assert.equal(weekStart(kst('2026-10-07T09:00:00')), '2026-10-05'); // 수요일
});

// ── 모드: penalty-bot selftest 표를 그대로 ─────────────────────────────────────

test('modeFor 는 penalty-bot mode_for 와 같은 표를 낸다', () => {
  const sy = { name: '서윤', rest: ['2026-10-13', '2026-10-28'] };
  const jh = { name: '종현', rest: ['2026-10-20', '2026-10-28'] };
  const table = {
    '2026-09-28': ['plan', 'plan'], '2026-10-05': ['dev', 'dev'],
    '2026-10-12': ['exempt', 'dev'], '2026-10-19': ['exempt', 'exempt'],
    '2026-10-26': ['exempt', 'exempt'], '2026-11-02': ['dev', 'dev'],
  };
  for (const [mon, want] of Object.entries(table)) {
    assert.deepEqual([modeFor(sy, mon, '2026-10-05'), modeFor(jh, mon, '2026-10-05')], want, mon);
  }
  assert.equal(modeFor({ name: 'x' }, '2026-11-02', '2026-10-05'), 'dev'); // rest 없음
});

// ── on track ──────────────────────────────────────────────────────────────────

const weeks = {
  '2026-09-21': { 종현: { status: 'fail', reason: 'a' } },
  '2026-09-28': { 종현: { status: 'pass', reason: 'b' }, 서윤: { status: 'fail', reason: 'c' } },
  '2026-10-05': { 종현: { status: 'exempt' }, 서윤: { status: 'hold', reason: 'd' } },
};

test('summarizePerson: 가장 늦은 주로 판정하고 이력은 오래된 순 최대 4주', () => {
  const jh = summarizePerson(weeks, '종현');
  assert.equal(jh.onTrack, true); // exempt
  assert.deepEqual(jh.history.map((h) => h.week), ['2026-09-21', '2026-09-28', '2026-10-05']);
  assert.equal(jh.history[2].reason, ''); // exempt 에는 reason 이 없다
  assert.equal(summarizePerson(weeks, '서윤').onTrack, true); // hold
  assert.equal(summarizePerson({ '2026-10-05': { a: { status: 'fail' } } }, 'a').onTrack, false);
  const many = Object.fromEntries(['01', '02', '03', '04', '05'].map((d) => [`2026-10-${d}`, { a: { status: 'pass' } }]));
  assert.equal(summarizePerson(many, 'a').history.length, 4);
});

test('ledger 에 없는 새 팀원은 null 이고 팀 분모에서 빠진다', () => {
  const nw = summarizePerson(weeks, '찬웅');
  assert.deepEqual(nw, { history: [], onTrack: null });
  assert.deepEqual(teamSummary([{ onTrack: true }, { onTrack: false }, { onTrack: null }]), { onTrack: 1, judged: 2 });
  assert.equal(teamSummary([{ onTrack: null }]), null);
});

// ── PR ────────────────────────────────────────────────────────────────────────

const start = kst('2026-10-05T00:00:00');
const pr = (over) => ({
  number: 1, title: 't', html_url: 'u', state: 'open', merged_at: null,
  user: { login: 'inoaole' }, updated_at: '2026-10-05T00:00:00+09:00', ...over,
});

test('filterPrs: 작성자 대소문자 무시, 주 경계, merged 판정, 라벨', () => {
  const pulls = [
    { repo: 'uni-keyyy/uni-keyyy_web', pr: pr({ number: 30, user: { login: 'InoAole' }, merged_at: '2026-10-06T00:00:00Z', state: 'closed' }) },
    { repo: 'uni-keyyy/uni-keyyy_api', pr: pr({ number: 2, updated_at: '2026-10-04T23:59:59+09:00' }) }, // 지난주
    { repo: 'uni-keyyy/uni-keyyy_api', pr: pr({ number: 3, user: { login: 'banunas' } }) }, // 남의 PR
    { repo: 'uni-keyyy/uni-keyyy_api', pr: pr({ number: 4 }) }, // 월 00:00 정각
  ];
  assert.deepEqual(filterPrs(pulls, 'inoaole', start), [
    { label: 'web#30', title: 't', url: 'u', state: 'merged' },
    { label: 'api#4', title: 't', url: 'u', state: 'open' },
  ]);
});

test('github 가 비어 있는 팀원은 터지지 않고 빈 목록', () => {
  assert.deepEqual(filterPrs([{ repo: 'o/r_web', pr: pr({}) }], undefined, start), []);
});

// ── Discord ───────────────────────────────────────────────────────────────────

test('mapMessage: global_name 우선, 빈 content 와 첨부 수', () => {
  assert.deepEqual(
    mapMessage({ id: '1', author: { username: 'u', global_name: '찬웅' }, content: '', timestamp: 'T', attachments: [{}, {}] }),
    { id: '1', author: '찬웅', content: '', ts: 'T', attachments: 2 },
  );
  assert.equal(mapMessage({ id: '2', author: { username: 'u', global_name: null }, timestamp: 'T' }).author, 'u');
});

// ── 설정 로드 ─────────────────────────────────────────────────────────────────

test('loadProjects: 없으면 [], 잘못된 id·채널 id 는 거부', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cc-proj-'));
  const f = path.join(dir, 'projects.json');
  try {
    assert.deepEqual(await loadProjects(f), []);
    writeFileSync(f, JSON.stringify([{ id: 'mabc', name: 'U', discordChannels: [{ id: '123', name: 'g' }] }, { id: 'swyp', name: 'S' }]));
    assert.equal((await loadProjects(f)).length, 2);
    writeFileSync(f, JSON.stringify([{ id: '../x', name: 'U' }]));
    await assert.rejects(loadProjects(f), /bad project id/);
    writeFileSync(f, JSON.stringify([{ id: 'mabc', name: 'U', discordChannels: [{ id: '../x', name: 'g' }] }]));
    await assert.rejects(loadProjects(f), /bad channel id/);
    writeFileSync(f, '{}');
    await assert.rejects(loadProjects(f), /array/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
