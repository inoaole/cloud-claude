import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadProjects, weekStart, modeFor, summarizePerson, teamSummary, filterPrs, mapMessage,
  getProject, listItem,
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

test('github 가 비어 있는 팀원은 터지지 않고 null — "PR 없음" 으로 위장하지 않는다', () => {
  assert.equal(filterPrs([{ repo: 'o/r_web', pr: pr({}) }], undefined, start), null);
  assert.equal(filterPrs([{ repo: 'o/r_web', pr: pr({}) }], '', start), null);
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

// ── 조립 ──────────────────────────────────────────────────────────────────────

const NOW = kst('2026-10-07T09:00:00');
const project = {
  id: 'mabc', name: 'Unikey', penaltyBotDir: '/pb',
  discordChannels: [{ id: '1', name: 'a' }, { id: '2', name: 'b' }],
};
const cfg = {
  repos: ['o/r_web'], plan_until: '2026-10-05',
  people: [
    { name: '종현', github: 'inoaole', rest: ['2026-10-20', '2026-10-28'] },
    { name: '서윤', github: 'banunas', rest: ['2026-10-13', '2026-10-28'] },
  ],
};
const ledger = { weeks: { '2026-09-28': { 종현: { status: 'pass', reason: 'x' }, 서윤: { status: 'fail', reason: 'y' } } } };
const enoent = () => Promise.reject(Object.assign(new Error('nope'), { code: 'ENOENT' }));
const files = (map) => (f) => (f in map ? Promise.resolve(map[f]) : enoent());
const okFiles = files({ '/pb/config.json': JSON.stringify(cfg), '/pb/ledger.json': JSON.stringify(ledger) });
const env = { GITHUB_TOKEN: 'g', DISCORD_BOT_TOKEN: 'd' };
const res = (body, status = 200) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });
const ghPull = pr({ number: 30, updated_at: '2026-10-06T10:00:00+09:00' });
const msg = (id, ts) => ({ id, author: { username: 'u' }, content: 'hi', timestamp: ts, attachments: [] });
function router(over = {}) {
  return (url) => {
    for (const [frag, fn] of Object.entries(over)) if (url.includes(frag)) return fn(url);
    if (url.includes('api.github.com')) return res([ghPull]);
    if (url.includes('/channels/1/')) return res([msg('m2', '2026-10-07T00:00:00.000000+00:00')]);
    if (url.includes('/channels/2/')) return res([msg('m1', '2026-10-06T00:00:00.000000+00:00')]);
    throw new Error(`unexpected ${url}`);
  };
}
const run = (over = {}) => getProject(over.project ?? project, {
  fetchFn: over.fetchFn ?? router(), readFn: over.readFn ?? okFiles, env: over.env ?? env, now: NOW, onError: () => {},
});

test('정상: 팀 요약, 사람별 모드·PR·이력, 채널별 메시지', async () => {
  const d = await run();
  assert.equal(d.weekStart, '2026-10-05');
  assert.equal(d.team.state, 'ok');
  assert.deepEqual(d.team.summary, { onTrack: 1, judged: 2 });
  const [jh, sy] = d.team.people;
  assert.equal(jh.mode, 'dev');
  assert.equal(jh.onTrack, true);
  assert.deepEqual(jh.prs.map((p) => p.label), ['web#30']);
  assert.deepEqual(sy.prs, []); // 정말로 PR 이 없다
  assert.equal(sy.onTrack, false);
  assert.deepEqual([d.ledger.state, d.github.state, d.discord.state], ['ok', 'ok', 'ok']);
  assert.deepEqual(d.discord.channels.map((c) => c.messages[0].id), ['m2', 'm1']);
  assert.deepEqual(listItem(d), { id: 'mabc', name: 'Unikey', state: 'ok', summary: { onTrack: 1, judged: 2 }, lastMessageAt: '2026-10-07T00:00:00.000000+00:00' });
});

test('GitHub 실패(레포 하나 404 포함)는 error + prs null — "PR 없음" 으로 위장하지 않는다', async () => {
  const d = await run({ fetchFn: router({ 'api.github.com': () => res({ message: 'Not Found' }, 404) }) });
  assert.equal(d.github.state, 'error');
  assert.equal(d.team.state, 'ok');
  assert.ok(d.team.people.every((p) => p.prs === null));
  const t = await run({ fetchFn: router({ 'api.github.com': () => Promise.reject(new Error('timeout')) }) });
  assert.equal(t.github.state, 'error');
});

test('Discord 채널 하나만 실패하면 그 채널만 error, 전부 실패하면 섹션 error', async () => {
  const one = await run({ fetchFn: router({ '/channels/2/': () => res({}, 403) }) });
  assert.equal(one.discord.state, 'ok');
  assert.deepEqual(one.discord.channels.map((c) => c.state), ['ok', 'error']);
  assert.deepEqual(one.discord.channels[1].messages, []);
  const all = await run({ fetchFn: router({ 'discord.com': () => res({}, 429) }) });
  assert.equal(all.discord.state, 'error');
  assert.equal(listItem(all).lastMessageAt, null);
});

test('ledger 없음은 정상(전원 null), 깨진 ledger 는 error', async () => {
  const none = await run({ readFn: files({ '/pb/config.json': JSON.stringify(cfg) }) });
  assert.equal(none.ledger.state, 'ok');
  assert.ok(none.team.people.every((p) => p.onTrack === null));
  assert.equal(none.team.summary, null);
  const bad = await run({ readFn: files({ '/pb/config.json': JSON.stringify(cfg), '/pb/ledger.json': '{nope' }) });
  assert.equal(bad.ledger.state, 'error');
});

test('penalty-bot config 를 못 읽으면 team error, 사람 없음', async () => {
  const d = await run({ readFn: enoent });
  assert.equal(d.team.state, 'error');
  assert.deepEqual(d.team.people, []);
});

test('토큰이 없으면 unconfigured 이고 외부 호출을 하지 않는다', async () => {
  let calls = 0;
  const d = await run({ env: {}, fetchFn: () => { calls += 1; return res([]); } });
  assert.equal(calls, 0);
  assert.equal(d.github.state, 'unconfigured');
  assert.equal(d.discord.state, 'unconfigured');
  assert.ok(d.team.people.every((p) => p.prs === null));
});

test('소스가 하나도 없는 프로젝트(SWYP)는 전부 unconfigured', async () => {
  const d = await run({ project: { id: 'swyp', name: 'SWYP 7기' } });
  assert.deepEqual([d.team.state, d.ledger.state, d.github.state, d.discord.state],
    ['unconfigured', 'unconfigured', 'unconfigured', 'unconfigured']);
  assert.deepEqual(listItem(d), { id: 'swyp', name: 'SWYP 7기', state: 'unconfigured', summary: null, lastMessageAt: null });
});

// ── 최종 리뷰 수정 ────────────────────────────────────────────────────────────

test('mapMessage: 임베드도 첨부로 센다 (봇 메시지가 빈 카드가 되지 않게)', () => {
  assert.equal(mapMessage({ id: '3', author: { username: 'b' }, content: '', timestamp: 'T', embeds: [{}] }).attachments, 1);
});

test('listItem 은 섹션 상태를 실어 보낸다: 오류·미연결이 "판정 없음" 으로 위장하지 않는다', async () => {
  assert.equal(listItem(await run()).state, 'ok');
  assert.equal(listItem(await run({ readFn: enoent })).state, 'error');
  const badLedger = await run({ readFn: files({ '/pb/config.json': JSON.stringify(cfg), '/pb/ledger.json': '{nope' }) });
  assert.equal(listItem(badLedger).state, 'error');
  assert.equal(listItem(await run({ project: { id: 'swyp', name: 'S' } })).state, 'unconfigured');
});

test('config.json 모양이 틀려도 throw 하지 않고 team error', async () => {
  for (const body of ['null', '{"people": 5}', '{"people": [], "repos": "x"}']) {
    const d = await run({ readFn: files({ '/pb/config.json': body }) });
    assert.equal(d.team.state, 'error', body);
  }
});

test('github 가 빈 문자열인 팀원은 github null, prs null', async () => {
  const c = { ...cfg, people: [{ name: '새', github: '' }] };
  const d = await run({ readFn: files({ '/pb/config.json': JSON.stringify(c) }) });
  assert.equal(d.team.people[0].github, null);
  assert.equal(d.team.people[0].prs, null);
});
