# Projects 탭 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Growth 탭을 Projects 탭으로 바꾸고, mabc(Unikey) 팀의 사람별 진도(주간 판정 + 이번 주 PR)와 지정 Discord 채널 메시지를 한 화면에 보여준다.

**Architecture:** 허브가 요청이 올 때 직접 모은다. penalty-bot의 `config.json`/`ledger.json`은 같은 서버 디스크에서 읽고, GitHub·Discord는 REST로 호출한다. 결과는 프로젝트별로 60초 메모리 캐시한다. 순수 로직은 `hub/src/projects.js` 한 파일에 두고 `fetchFn`/`readFn`을 주입받아 HTTP 없이 테스트한다(`market.js` 패턴). 프론트는 목록과 상세 화면 두 개를 `Projects.tsx` 한 파일에 둔다.

**Tech Stack:** Node 20(내장 `fetch`, `node:test`), Express 4, React 18 + react-router, vitest + Testing Library. 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-10-07-projects-tab-design.md`

## Global Constraints

- 새 npm 의존성 금지. 외부 호출은 Node 20 내장 `fetch` + `AbortSignal.timeout(8000)`.
- 섹션 상태는 정확히 `ok | error | unconfigured` 세 값.
- `prs: null`(확인 불가)과 `prs: []`(PR 없음)를 절대 합치지 않는다.
- 이번 주는 pass/fail을 표시하지 않는다. on track은 가장 늦은 판정 주 기준이고 pass·exempt·hold면 true, fail이면 false, 기록 없으면 null.
- 주는 KST 월 00:00 ~ 일 23:59:59.
- 두 엔드포인트 모두 `requireAuth` 뒤. 응답에 토큰이나 외부 에러 본문을 넣지 않는다.
- Discord `content`는 React 텍스트 노드로만 렌더링한다(`dangerouslySetInnerHTML` 금지).
- 크롬 색은 모노크롬 + Action Blue뿐(DESIGN.md). off track도 색 없이 텍스트로만 표시.
- `projects.json`은 기존 `.gitignore`의 `*.json` 규칙으로 이미 무시된다. `projects.example.json`은 `!*.example.json`으로 커밋된다.

## Review Focus

1. `config.json`에 `github`가 비어 있는 팀원 → PR 필터가 터지지 않고 그 사람만 `[]`. (Task 1 테스트)
2. 첨부·임베드만 있어서 `content`가 빈 Discord 메시지 → 빈 카드가 아니라 `📎 n` 칩이 보인다. (Task 1 `mapMessage` + Task 4 렌더 테스트)
3. ledger에 아직 한 주도 없는 새 팀원 → `onTrack: null`이고 분모에서 빠진다. (Task 1 테스트)
4. `projects.json`의 채널 ID가 숫자가 아님(`../x` 등) → URL에 끼워지기 전에 로드 단계에서 거부한다. (Task 1 테스트)
5. 레포 하나가 404/403 → GitHub 섹션 전체가 `error`, 모든 사람 `prs: null`. 일부 레포만 보여주고 "PR 없음"이라 말하지 않는다. (Task 2 테스트)

---

## 파일 구조

| 파일 | 작업 | 역할 |
|---|---|---|
| `hub/src/projects.js` | 생성 | 순수 함수 + 소스 조립 `getProject`, 목록 요약 `listItem` |
| `hub/src/projects.test.js` | 생성 | node:test |
| `hub/src/config.js` | 수정 | `projectsFile` |
| `hub/src/server.js` | 수정 | 라우트 2개 + 캐시 |
| `projects.example.json` | 생성 | 설정 예시 |
| `frontend/src/lib/api.ts` | 수정 | 타입 + `getProjects`, `getProject` |
| `frontend/src/screens/Projects.tsx` | 생성 | `ProjectList`, `ProjectDetail` |
| `frontend/src/screens/Projects.module.css` | 생성 | 스타일 |
| `frontend/src/screens/Projects.test.tsx` | 생성 | vitest |
| `frontend/src/lib/tabs.tsx`, `components/icons.tsx`, `App.tsx` | 수정 | Growth → Projects |
| `frontend/src/screens/Growth.tsx` | 삭제 | |
| `frontend/src/styles/tokens.css` | 수정 | 쓰는 곳 없는 `--growth-p*`, `--heat-*` 삭제 |
| `frontend/e2e/smoke.spec.ts` | 수정 | `/growth` → `/projects` |
| `DESIGN.md` | 수정 | 탭 바 줄, RISK 1·2 보류 표시 |

---

### Task 1: 허브 순수 로직

**Files:**
- Create: `hub/src/projects.js`
- Test: `hub/src/projects.test.js`

**Interfaces:**
- Consumes: `kstParts(nowMs) -> {date: 'YYYY-MM-DD', minutes}` from `hub/src/market.js`
- Produces:
  - `loadProjects(file: string) -> Promise<Project[]>` (ENOENT → `[]`, 형식 오류 → throw)
  - `weekStart(nowMs: number) -> 'YYYY-MM-DD'` (KST 이번 주 월요일)
  - `modeFor(person, monday: string, planUntil: string) -> 'plan'|'exempt'|'dev'`
  - `summarizePerson(weeks: object, name: string) -> {history: {week,status,reason}[], onTrack: boolean|null}`
  - `teamSummary(people: {onTrack}[]) -> {onTrack: number, judged: number} | null`
  - `filterPrs(pulls: {repo, pr}[], login: string|undefined, startMs: number) -> {label,title,url,state}[]`
  - `mapMessage(m) -> {id, author, content, ts, attachments}`

- [ ] **Step 1: 실패하는 테스트 작성** — `hub/src/projects.test.js`

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `cd hub && node --test src/projects.test.js`
Expected: FAIL — `Cannot find module './projects.js'`

- [ ] **Step 3: 최소 구현** — `hub/src/projects.js`

```js
// GET /api/projects + GET /api/projects/:id — what each team project looks like right now.
//
// Facts come from where they already live: penalty-bot's config.json / ledger.json on this same
// server, GitHub for this week's PRs, Discord for recent messages. Nothing is copied here.
// Every source reports ok | error | unconfigured on its own: a failed fetch must never render
// as "no activity", and a missing ledger must never render as "everyone passed".
import { readFile } from 'node:fs/promises';
import { kstParts } from './market.js';

const ID_RE = /^[a-z0-9-]{1,32}$/;
const CHANNEL_RE = /^\d{1,20}$/;
// A week someone was excused or the judge itself failed is not that person falling behind.
const ON_TRACK = new Set(['pass', 'exempt', 'hold']);
const DAY = 864e5;

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** projects.json → array. Missing file = no projects; a malformed one throws (caller logs). */
export async function loadProjects(file) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error('projects.json must be an array');
  for (const p of list) {
    if (!ID_RE.test(p?.id ?? '')) throw new Error(`bad project id: ${JSON.stringify(p?.id)}`);
    // Channel ids are interpolated into a Discord URL — digits only.
    for (const ch of p.discordChannels ?? []) {
      if (!CHANNEL_RE.test(ch?.id ?? '')) throw new Error(`bad channel id: ${JSON.stringify(ch?.id)}`);
    }
  }
  return list;
}

/** This week's Monday (KST) as YYYY-MM-DD. Same week definition as penalty-bot. */
export function weekStart(nowMs) {
  const { date } = kstParts(nowMs);
  const back = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -back);
}

/** Port of penalty-bot mode_for. ISO dates compare correctly as strings. */
export function modeFor(person, monday, planUntil) {
  if (monday < planUntil) return 'plan';
  const [restStart, restEnd] = person.rest ?? [];
  if (restStart && restEnd && restStart <= addDays(monday, 6) && restEnd >= monday) return 'exempt';
  return 'dev';
}

/** Last 4 judged weeks (oldest first) + on-track from the latest one. No record → null. */
export function summarizePerson(weeks, name) {
  const mine = Object.keys(weeks).sort().filter((w) => weeks[w]?.[name]);
  const history = mine.slice(-4).map((week) => ({
    week, status: weeks[week][name].status, reason: weeks[week][name].reason ?? '',
  }));
  const last = history.at(-1);
  return { history, onTrack: last ? ON_TRACK.has(last.status) : null };
}

export function teamSummary(people) {
  const judged = people.filter((p) => p.onTrack !== null);
  return judged.length ? { onTrack: judged.filter((p) => p.onTrack).length, judged: judged.length } : null;
}

/** This person's PRs touched since Monday 00:00 KST (penalty-bot's lenient rule). */
export function filterPrs(pulls, login, startMs) {
  if (!login) return [];
  const me = login.toLowerCase();
  return pulls
    .filter(({ pr }) => pr.user?.login?.toLowerCase() === me && Date.parse(pr.updated_at) >= startMs)
    .map(({ repo, pr }) => ({
      label: `${repo.split('_').at(-1)}#${pr.number}`,
      title: pr.title,
      url: pr.html_url,
      state: pr.merged_at ? 'merged' : pr.state,
    }));
}

export function mapMessage(m) {
  return {
    id: m.id,
    author: m.author?.global_name ?? m.author?.username ?? '?',
    content: m.content ?? '',
    ts: m.timestamp,
    attachments: m.attachments?.length ?? 0,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd hub && node --test src/projects.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add hub/src/projects.js hub/src/projects.test.js
git commit -m "feat(projects): 팀 진도 판정 순수 로직 (penalty-bot 규칙 이식)"
```

---

### Task 2: 소스 조립 `getProject` / `listItem`

**Files:**
- Modify: `hub/src/projects.js` (끝에 추가)
- Test: `hub/src/projects.test.js` (끝에 추가)

**Interfaces:**
- Consumes: Task 1의 모든 함수
- Produces:
  - `getProject(project, {fetchFn, readFn, env, now, onError}) -> Promise<ProjectDetail>` — 절대 throw하지 않는다(소스별 실패는 상태로 담는다)
    - `readFn(path) -> Promise<string>`, ENOENT는 `err.code === 'ENOENT'`
    - `onError(source: 'team'|'ledger'|'github'|'discord', err)` — 로깅용
    - 반환 모양은 스펙 4장 `GET /api/projects/:id`
  - `listItem(detail) -> {id, name, summary, lastMessageAt}`

- [ ] **Step 1: 실패하는 테스트 추가** — `hub/src/projects.test.js` 끝에

```js
// ── 조립 ──────────────────────────────────────────────────────────────────────
import { getProject, listItem } from './projects.js';

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
  assert.deepEqual(listItem(d), { id: 'mabc', name: 'Unikey', summary: { onTrack: 1, judged: 2 }, lastMessageAt: '2026-10-07T00:00:00.000000+00:00' });
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
  assert.deepEqual(listItem(d), { id: 'swyp', name: 'SWYP 7기', summary: null, lastMessageAt: null });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd hub && node --test src/projects.test.js`
Expected: FAIL — `getProject` is not exported

- [ ] **Step 3: 구현** — `hub/src/projects.js` 맨 위 import에 `import path from 'node:path';` 추가하고, 파일 끝에 추가

```js
const TIMEOUT_MS = 8000;
const UA = 'cloud-claude-hub';

async function getJson(fetchFn, url, headers) {
  const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw Object.assign(new Error(`http ${res.status}`), { status: res.status });
  return res.json();
}

async function fetchPulls(fetchFn, token, repos, startMs) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': UA };
  const out = [];
  for (const repo of repos) {
    for (let page = 1; ; page += 1) {
      const batch = await getJson(fetchFn,
        `https://api.github.com/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`, headers);
      out.push(...batch.map((pr) => ({ repo, pr })));
      if (batch.length < 100 || Date.parse(batch.at(-1).updated_at) < startMs) break;
    }
  }
  return out;
}

async function teamSections(project, ctx, monday, startMs) {
  const unconfigured = {
    team: { state: 'unconfigured', summary: null, people: [] },
    ledger: { state: 'unconfigured' },
    github: { state: 'unconfigured' },
  };
  if (!project.penaltyBotDir) return unconfigured;
  const dir = project.penaltyBotDir;

  let cfg;
  try {
    cfg = JSON.parse(await ctx.readFn(path.join(dir, 'config.json')));
  } catch (e) {
    ctx.onError('team', e);
    return { ...unconfigured, team: { state: 'error', summary: null, people: [] } };
  }

  // No ledger yet = the judge has never run. That is normal, not an error.
  let weeks = {};
  let ledger = { state: 'ok' };
  try {
    weeks = JSON.parse(await ctx.readFn(path.join(dir, 'ledger.json'))).weeks ?? {};
  } catch (e) {
    if (e.code !== 'ENOENT') { ledger = { state: 'error' }; ctx.onError('ledger', e); }
  }

  // null = could not check. Never collapse it into [] ("no PRs").
  let pulls = null;
  let github = { state: 'unconfigured' };
  if (ctx.env.GITHUB_TOKEN) {
    try {
      pulls = await fetchPulls(ctx.fetchFn, ctx.env.GITHUB_TOKEN, cfg.repos ?? [], startMs);
      github = { state: 'ok' };
    } catch (e) {
      github = { state: 'error' };
      ctx.onError('github', e);
    }
  }

  const people = (cfg.people ?? []).map((p) => ({
    name: p.name,
    github: p.github ?? null,
    mode: modeFor(p, monday, cfg.plan_until ?? ''),
    ...summarizePerson(weeks, p.name),
    prs: pulls && filterPrs(pulls, p.github, startMs),
  }));
  return { team: { state: 'ok', summary: teamSummary(people), people }, ledger, github };
}

async function discordSection(project, ctx) {
  const chans = project.discordChannels ?? [];
  const token = ctx.env.DISCORD_BOT_TOKEN;
  if (!chans.length || !token) return { state: 'unconfigured', channels: [] };
  const headers = { Authorization: `Bot ${token}`, 'User-Agent': UA };
  const channels = await Promise.all(chans.map(async (ch) => {
    try {
      const msgs = await getJson(ctx.fetchFn, `https://discord.com/api/v10/channels/${ch.id}/messages?limit=50`, headers);
      return { id: ch.id, name: ch.name, state: 'ok', messages: msgs.map(mapMessage) };
    } catch (e) {
      ctx.onError('discord', e);
      return { id: ch.id, name: ch.name, state: 'error', messages: [] };
    }
  }));
  return { state: channels.some((c) => c.state === 'ok') ? 'ok' : 'error', channels };
}

/** Assemble one project. Never throws — every failure is a section state. */
export async function getProject(project, {
  fetchFn = fetch, readFn = (f) => readFile(f, 'utf8'), env = process.env, now = Date.now(), onError = () => {},
} = {}) {
  const ctx = { fetchFn, readFn, env, onError };
  const monday = weekStart(now);
  const startMs = Date.parse(`${monday}T00:00:00+09:00`);
  const [teamPart, discord] = await Promise.all([teamSections(project, ctx, monday, startMs), discordSection(project, ctx)]);
  return { id: project.id, name: project.name, weekStart: monday, ...teamPart, discord };
}

/** Row for the Projects list. Discord timestamps share one ISO format, so string max works. */
export function listItem(d) {
  const ts = d.discord.channels.flatMap((c) => c.messages.map((m) => m.ts)).sort().at(-1) ?? null;
  return { id: d.id, name: d.name, summary: d.team.summary, lastMessageAt: ts };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd hub && node --test src/projects.test.js && npm test`
Expected: PASS (projects 15 tests + 기존 전체 그대로 통과)

- [ ] **Step 5: 커밋**

```bash
git add hub/src/projects.js hub/src/projects.test.js
git commit -m "feat(projects): penalty-bot·GitHub·Discord 를 섹션별 상태로 조립"
```

---

### Task 3: 허브 라우트 + 설정 예시

**Files:**
- Modify: `hub/src/config.js` (`config` 객체, `devicesFile` 바로 아래)
- Modify: `hub/src/server.js` (import 블록, Market 섹션의 `/api/market/latest` 라우트 바로 다음)
- Create: `projects.example.json`

**Interfaces:**
- Consumes: `loadProjects`, `getProject`, `listItem` (Task 1·2), `requireAuth`, `audit` (server.js 기존)
- Produces: `GET /api/projects -> ListItem[]`, `GET /api/projects/:id -> ProjectDetail | 404 {error:'not_found'}`

- [ ] **Step 1: config** — `hub/src/config.js`의 `devicesFile` 줄 아래에 추가

```js
  // Projects tab (2026-10-07). Gitignored like devices.json; see projects.example.json.
  projectsFile: process.env.PROJECTS_FILE || path.join(repoRoot, 'projects.json'),
```

- [ ] **Step 2: 라우트** — `hub/src/server.js`

import 블록 끝(`import { handleSaveNote, getNote } from './notes.js';` 다음)에:

```js
import { loadProjects, getProject, listItem } from './projects.js';
```

`app.get('/api/market/latest', ...)` 라우트 블록이 끝난 바로 다음에:

```js
// ── Projects ─────────────────────────────────────────────────────────────────
// Read per request so editing projects.json needs no restart. A malformed file empties
// only this tab; it must not take the hub down.
async function readProjects() {
  try {
    return await loadProjects(config.projectsFile);
  } catch (err) {
    audit('projects_config_error', { msg: String(err?.message || err) });
    return [];
  }
}

// ponytail: per-process 60s cache, errors included so an outage isn't hammered on every tap.
const projectCache = new Map(); // id -> { at, body }
async function projectDetail(p) {
  const hit = projectCache.get(p.id);
  if (hit && Date.now() - hit.at < 60_000) return hit.body;
  const body = await getProject(p, {
    // Status/code only — external error bodies can echo tokens or internal URLs.
    onError: (source, e) => audit('projects_source_error', { project: p.id, source, status: e?.status ?? e?.code ?? e?.name }),
  });
  projectCache.set(p.id, { at: Date.now(), body });
  return body;
}

app.get('/api/projects', requireAuth, async (_req, res) => {
  try {
    const list = await readProjects();
    res.json((await Promise.all(list.map(projectDetail))).map(listItem));
  } catch (err) {
    audit('projects_read_error', { msg: String(err?.message || err) });
    res.status(500).json({ error: 'read_failed' });
  }
});

app.get('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const p = (await readProjects()).find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'not_found' });
    res.json(await projectDetail(p));
  } catch (err) {
    audit('projects_read_error', { msg: String(err?.message || err) });
    res.status(500).json({ error: 'read_failed' });
  }
});
```

- [ ] **Step 3: 예시 설정** — `projects.example.json`

```json
[
  {
    "id": "mabc",
    "name": "Unikey",
    "penaltyBotDir": "/home/ubuntu/penalty-bot",
    "discordChannels": [
      { "id": "1482547310591348769", "name": "벌금bot" }
    ]
  },
  { "id": "swyp", "name": "SWYP 7기" }
]
```

- [ ] **Step 4: 확인** — 허브를 임시 포트로 띄워 인증 게이트와 라우트 등록 확인

Run:
```bash
cd hub && npm test && (HUB_PORT=18787 PROJECTS_FILE=../projects.example.json node src/server.js & echo $! > /tmp/cc-hub.pid; sleep 2; curl -s -o /dev/null -w '%{http_code}\n' localhost:18787/api/projects; curl -s -o /dev/null -w '%{http_code}\n' localhost:18787/api/projects/mabc; kill $(cat /tmp/cc-hub.pid))
```
Expected: 테스트 전부 PASS, 두 curl 모두 `401` (SPA fallback의 200이 아님 = 라우트가 fallback보다 먼저 등록됨)

- [ ] **Step 5: 커밋**

```bash
git add hub/src/config.js hub/src/server.js projects.example.json
git commit -m "feat(hub): /api/projects 목록·상세 엔드포인트 (60초 캐시)"
```

---

### Task 4: 프론트 Projects 화면

**Files:**
- Modify: `frontend/src/lib/api.ts` (파일 끝에 추가)
- Create: `frontend/src/screens/Projects.tsx`, `frontend/src/screens/Projects.module.css`
- Test: `frontend/src/screens/Projects.test.tsx`

**Interfaces:**
- Consumes: `GET /api/projects`, `GET /api/projects/:id` (Task 3), `apiFetch`, `ApiError`, `readJson` (api.ts 기존), `Group`, `Cell`, `Segmented`, `Stub`
- Produces: `export function ProjectList()`, `export function ProjectDetail()` (Task 5가 라우트에 연결), `export function IconProjects` (빈 상태와 Task 5 탭에서 사용. `IconGrowth` 삭제는 Task 5)

- [ ] **Step 1: 아이콘** — `frontend/src/components/icons.tsx`의 `IconGrowth` 아래에 추가

```tsx
/** Projects — a folder. */
export function IconProjects(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />
    </svg>
  );
}
```

- [ ] **Step 2: API 타입·함수** — `frontend/src/lib/api.ts` 끝에

```ts
// ── Projects (2026-10-07) ───────────────────────────────────────────────────

/** Every source says which of the three it is. `error` and `unconfigured` must never
    render alike, and neither may look like "nothing happened". */
export type SourceState = 'ok' | 'error' | 'unconfigured';
export type JudgeStatus = 'pass' | 'fail' | 'hold' | 'exempt';
export interface TeamSummary { onTrack: number; judged: number }
export interface ProjectPr { label: string; title: string; url: string; state: 'open' | 'closed' | 'merged' }
export interface Person {
  name: string;
  github: string | null;
  mode: 'plan' | 'dev' | 'exempt';
  /** null = never judged. Not the same as false. */
  onTrack: boolean | null;
  history: { week: string; status: JudgeStatus; reason: string }[];
  /** null = could not check (GitHub error/unconfigured). [] = genuinely no PRs. */
  prs: ProjectPr[] | null;
}
export interface DiscordMessage { id: string; author: string; content: string; ts: string; attachments: number }
export interface DiscordChannel { id: string; name: string; state: SourceState; messages: DiscordMessage[] }
export interface ProjectDetailData {
  id: string;
  name: string;
  weekStart: string;
  team: { state: SourceState; summary: TeamSummary | null; people: Person[] };
  ledger: { state: SourceState };
  github: { state: SourceState };
  discord: { state: SourceState; channels: DiscordChannel[] };
}
export interface ProjectListItem { id: string; name: string; summary: TeamSummary | null; lastMessageAt: string | null }

export async function getProjects(): Promise<ProjectListItem[]> {
  const res = await apiFetch('/api/projects');
  if (!res.ok) throw new ApiError(res.status, await readJson(res));
  return (await res.json()) as ProjectListItem[];
}

export async function getProject(id: string): Promise<ProjectDetailData> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(id)}`);
  if (!res.ok) throw new ApiError(res.status, await readJson(res));
  return (await res.json()) as ProjectDetailData;
}
```

- [ ] **Step 3: 실패하는 테스트** — `frontend/src/screens/Projects.test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectDetail, ProjectList } from './Projects';
import { getProject, getProjects, type ProjectDetailData } from '../lib/api';

vi.mock('../lib/api', () => ({ getProjects: vi.fn(), getProject: vi.fn() }));
const mockList = vi.mocked(getProjects);
const mockDetail = vi.mocked(getProject);

const renderList = () => render(<MemoryRouter><ProjectList /></MemoryRouter>);
const renderDetail = () => render(
  <MemoryRouter initialEntries={['/projects/mabc']}>
    <Routes><Route path="/projects/:id" element={<ProjectDetail />} /></Routes>
  </MemoryRouter>,
);

const detail = (over: Partial<ProjectDetailData> = {}): ProjectDetailData => ({
  id: 'mabc', name: 'Unikey', weekStart: '2026-10-05',
  team: {
    state: 'ok', summary: { onTrack: 1, judged: 2 },
    people: [
      { name: '종현', github: 'inoaole', mode: 'dev', onTrack: true,
        history: [{ week: '2026-09-28', status: 'pass', reason: 'ok' }],
        prs: [{ label: 'web#30', title: 't', url: 'https://x/30', state: 'merged' }] },
      { name: '서윤', github: 'banunas', mode: 'dev', onTrack: false,
        history: [{ week: '2026-09-28', status: 'fail', reason: '지난주 PR 없음' }], prs: [] },
      { name: '찬웅', github: null, mode: 'exempt', onTrack: null, history: [], prs: [] },
    ],
  },
  ledger: { state: 'ok' },
  github: { state: 'ok' },
  discord: {
    state: 'ok',
    channels: [
      { id: '1', name: 'general', state: 'ok', messages: [
        { id: 'm1', author: '찬웅', content: '<b>x</b>', ts: '2026-10-07T00:00:00+00:00', attachments: 0 },
        { id: 'm2', author: '서윤', content: '', ts: '2026-10-06T00:00:00+00:00', attachments: 2 },
      ] },
      { id: '2', name: '벌금bot', state: 'error', messages: [] },
    ],
  },
  ...over,
});

describe('ProjectList', () => {
  beforeEach(() => mockList.mockReset());

  it('요약을 보여주고, 판정이 없으면 "판정 없음"', async () => {
    mockList.mockResolvedValue([
      { id: 'mabc', name: 'Unikey', summary: { onTrack: 2, judged: 3 }, lastMessageAt: null },
      { id: 'swyp', name: 'SWYP 7기', summary: null, lastMessageAt: null },
    ]);
    renderList();
    expect(await screen.findByText(/2\/3 on track/)).toBeInTheDocument();
    expect(screen.getByText('판정 없음')).toBeInTheDocument();
  });

  it('프로젝트가 없으면 빈 상태', async () => {
    mockList.mockResolvedValue([]);
    renderList();
    expect(await screen.findByText('프로젝트 없음')).toBeInTheDocument();
  });
});

describe('ProjectDetail', () => {
  beforeEach(() => mockDetail.mockReset());

  it('사람별 on track, PR, 휴식, 판정 없음을 구분해 보여준다', async () => {
    mockDetail.mockResolvedValue(detail());
    renderDetail();
    expect(await screen.findByText(/1\/2 on track/)).toBeInTheDocument();
    expect(screen.getByText('web#30')).toBeInTheDocument();
    expect(screen.getByText('이번 주 PR 없음')).toBeInTheDocument();
    expect(screen.getByText('off track')).toBeInTheDocument();
    expect(screen.getByText('휴식 중')).toBeInTheDocument();
    expect(screen.getByText('판정 없음')).toBeInTheDocument();
  });

  it('prs null 은 "PR 없음" 과 다른 문구', async () => {
    const d = detail({ github: { state: 'error' } });
    d.team.people = d.team.people.map((p) => ({ ...p, prs: null }));
    mockDetail.mockResolvedValue(d);
    renderDetail();
    expect(await screen.findAllByText('PR 확인 불가')).toHaveLength(2); // 휴식 중인 찬웅은 제외
    expect(screen.queryByText('이번 주 PR 없음')).not.toBeInTheDocument();
  });

  it('섹션 error 와 unconfigured 는 서로 다른 문구', async () => {
    mockDetail.mockResolvedValue(detail({
      team: { state: 'error', summary: null, people: [] },
      discord: { state: 'unconfigured', channels: [] },
    }));
    renderDetail();
    expect(await screen.findByText('불러오지 못함')).toBeInTheDocument();
    expect(screen.getByText('연결된 소스 없음')).toBeInTheDocument();
  });

  it('메시지는 태그가 아니라 글자로, 빈 content 는 첨부 칩으로', async () => {
    mockDetail.mockResolvedValue(detail());
    renderDetail();
    expect(await screen.findByText('<b>x</b>')).toBeInTheDocument();
    expect(screen.getByText('📎 2')).toBeInTheDocument();
  });

  it('채널을 바꾸면 그 채널의 상태가 보인다', async () => {
    mockDetail.mockResolvedValue(detail());
    renderDetail();
    await userEvent.click(await screen.findByRole('tab', { name: '벌금bot' }));
    expect(screen.getByText('불러오지 못함')).toBeInTheDocument();
    expect(screen.queryByText('<b>x</b>')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: 실패 확인**

Run: `cd frontend && npx vitest run src/screens/Projects.test.tsx`
Expected: FAIL — `Failed to resolve import "./Projects"`

- [ ] **Step 5: 화면 구현** — `frontend/src/screens/Projects.tsx`

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Group } from '../components/Group';
import { Cell } from '../components/Cell';
import { Segmented } from '../components/Segmented';
import { Stub } from '../components/Stub';
import { IconProjects } from '../components/icons';
import {
  getProject, getProjects,
  type JudgeStatus, type Person, type ProjectDetailData, type ProjectListItem, type SourceState, type TeamSummary,
} from '../lib/api';
import styles from './Projects.module.css';

const ICON: Record<JudgeStatus, string> = { pass: '✅', fail: '❌', hold: '⚠️', exempt: '⏸' };
const MODE: Record<Person['mode'], string> = { plan: 'plan', dev: 'dev', exempt: 'rest' };
// error and unconfigured must never read alike (DESIGN.md state language).
const SECTION_TEXT: Record<Exclude<SourceState, 'ok'>, string> = {
  unconfigured: '연결된 소스 없음',
  error: '불러오지 못함',
};

const summaryText = (s: TeamSummary | null) => (s ? `${s.onTrack}/${s.judged} on track` : '판정 없음');

/** Always `~`: a 60s-cached snapshot never gets to claim precision. */
function ago(ts: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - Date.parse(ts)) / 60_000));
  if (m < 60) return `~${m}분 전`;
  const h = Math.round(m / 60);
  return h < 24 ? `~${h}시간 전` : `~${Math.round(h / 24)}일 전`;
}

const clock = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

function useLoad<T>(fn: () => Promise<T>) {
  const [state, setState] = useState<{ phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; data: T }>({ phase: 'loading' });
  const load = useCallback(() => {
    let alive = true;
    setState({ phase: 'loading' });
    fn()
      .then((data) => { if (alive) setState({ phase: 'ready', data }); })
      .catch(() => { if (alive) setState({ phase: 'error' }); });
    return () => { alive = false; };
  }, [fn]);
  useEffect(() => load(), [load]);
  return { state, load };
}

function Failed({ retry }: { retry: () => void }) {
  return (
    <div className={styles.center}>
      <p className={styles.hint}>Couldn't reach the hub.</p>
      <button type="button" className={styles.retry} onClick={retry}>Retry</button>
    </div>
  );
}

export function ProjectList() {
  const navigate = useNavigate();
  const { state, load } = useLoad<ProjectListItem[]>(getProjects);

  if (state.phase === 'loading') return <p className={styles.hint}>Loading…</p>;
  if (state.phase === 'error') return <Failed retry={load} />;
  if (state.data.length === 0) {
    return <Stub icon={IconProjects} title="프로젝트 없음" note="허브의 projects.json 에 프로젝트를 추가하면 여기에 보입니다." />;
  }
  return (
    <Group>
      {state.data.map((p) => (
        <Cell
          key={p.id}
          title={p.name}
          subtitle={
            <>
              {summaryText(p.summary)}
              {p.lastMessageAt && <> · 마지막 메시지 <span className={styles.est}>{ago(p.lastMessageAt)}</span></>}
            </>
          }
          onClick={() => navigate(`/projects/${p.id}`)}
        />
      ))}
    </Group>
  );
}

function prsLine(p: Person, github: SourceState) {
  if (p.mode === 'exempt') return <span className={styles.quiet}>휴식 중</span>;
  if (p.prs === null) {
    return <span className={styles.warn}>{github === 'unconfigured' ? 'GitHub 연결 안 됨' : 'PR 확인 불가'}</span>;
  }
  if (p.prs.length === 0) return <span className={styles.quiet}>이번 주 PR 없음</span>;
  return (
    <span className={styles.prs}>
      {p.prs.map((pr) => (
        <a key={pr.url} href={pr.url} target="_blank" rel="noreferrer" title={pr.title} className={styles.chip}>
          <span className="mono">{pr.label}</span> <span className={styles.prState}>{pr.state}</span>
        </a>
      ))}
    </span>
  );
}

function PersonRow({ p, github }: { p: Person; github: SourceState }) {
  return (
    <Cell
      title={<>{p.name} <span className={`mono ${styles.mode}`}>{MODE[p.mode]}</span></>}
      subtitle={prsLine(p, github)}
      value={
        <span className={styles.history}>
          {p.history.map((h) => <span key={h.week} title={`${h.week} ${h.reason}`}>{ICON[h.status]}</span>)}
          {p.onTrack === false && <span className={styles.off}>off track</span>}
          {p.onTrack === null && <span className={styles.quiet}>판정 없음</span>}
        </span>
      }
    />
  );
}

function Discord({ discord }: { discord: ProjectDetailData['discord'] }) {
  const [sel, setSel] = useState(discord.channels[0]?.id ?? '');
  if (discord.state === 'unconfigured') return <Group header="Discord"><p className={styles.section}>{SECTION_TEXT.unconfigured}</p></Group>;
  const ch = discord.channels.find((c) => c.id === sel) ?? discord.channels[0];
  return (
    <>
      {discord.channels.length > 1 && (
        <div className={styles.seg}>
          <Segmented options={discord.channels.map((c) => ({ value: c.id, label: c.name }))} value={ch.id} onChange={setSel} />
        </div>
      )}
      <Group header={discord.channels.length > 1 ? 'Discord' : `Discord · ${ch.name}`}>
        {ch.state === 'error' && <p className={`${styles.section} ${styles.warn}`}>{SECTION_TEXT.error}</p>}
        {ch.state === 'ok' && ch.messages.length === 0 && <p className={styles.section}>메시지 없음</p>}
        {ch.messages.map((m) => (
          <div key={m.id} className={styles.msg}>
            <div className={styles.msgHead}>
              <span>{m.author}</span>
              <span className={`mono ${styles.quiet}`}>{clock.format(new Date(m.ts))}</span>
            </div>
            {m.content && <p className={styles.msgBody}>{m.content}</p>}
            {m.attachments > 0 && <span className={`mono ${styles.chip}`}>📎 {m.attachments}</span>}
          </div>
        ))}
      </Group>
    </>
  );
}

export function ProjectDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const fetchOne = useCallback(() => getProject(id), [id]);
  const { state, load } = useLoad<ProjectDetailData>(fetchOne);

  if (state.phase === 'loading') return <p className={styles.hint}>Loading…</p>;
  if (state.phase === 'error') return <Failed retry={load} />;
  const d = state.data;
  return (
    <>
      <button type="button" className={styles.back} onClick={() => navigate('/projects')}>‹ Projects</button>
      <h2 className={styles.name}>{d.name}</h2>
      <p className={styles.sub}>{summaryText(d.team.summary)} · <span className="mono">이번 주 {d.weekStart.slice(5).replace('-', '/')}~</span></p>

      <Group header="팀">
        {d.team.state !== 'ok' && <p className={`${styles.section} ${d.team.state === 'error' ? styles.warn : ''}`}>{SECTION_TEXT[d.team.state]}</p>}
        {d.ledger.state === 'error' && <p className={`${styles.section} ${styles.warn}`}>판정 기록을 읽지 못함</p>}
        {d.team.people.map((p) => <PersonRow key={p.name} p={p} github={d.github.state} />)}
      </Group>

      <Discord discord={d.discord} />
    </>
  );
}
```

- [ ] **Step 6: 스타일** — `frontend/src/screens/Projects.module.css`

```css
/* Monochrome + Action Blue only (DESIGN.md). State differences are tone and wording, never hue. */
.hint { text-align: center; color: var(--t4); font-size: 14px; padding: 48px 20px 12px; }
.center { display: flex; flex-direction: column; align-items: center; }
.retry {
  margin: 8px auto 0; padding: 10px 22px; min-height: 44px; cursor: pointer;
  border: 1px solid var(--hair); border-radius: var(--radius); background: var(--card);
  color: var(--accent); font-size: 15px;
}

.back {
  background: none; border: 0; color: var(--link); font-size: 17px;
  min-height: 44px; padding: 0; cursor: pointer;
}
.name { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 2px; }
.sub { color: var(--t4); font-size: 13px; margin: 0 0 8px; }

/* `~` estimate affordance: muted + dotted underline. */
.est { color: var(--t4); text-decoration: underline dotted; text-underline-offset: 3px; }

.mode { color: var(--t3); font-size: 12px; margin-left: 4px; }
.history { display: inline-flex; gap: 4px; align-items: center; font-size: 13px; }
.off { color: #fff; font-size: 12px; font-weight: 600; margin-left: 4px; }
.quiet { color: var(--t3); font-size: 13px; }
.warn { color: var(--t4); font-style: italic; }

.prs { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.chip {
  display: inline-block; padding: 2px 6px; border-radius: 6px; background: var(--raised);
  color: inherit; text-decoration: none; font-size: 12px;
}
.prState { color: var(--t3); }

.section { margin: 0; padding: 14px 16px; color: var(--t3); font-size: 14px; }
.seg { margin: 8px 0; }

.msg { padding: 12px 16px; border-top: 1px solid var(--hair); }
.msg:first-child { border-top: 0; }
.msgHead { display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; }
.msgBody { margin: 4px 0 0; font-size: 15px; white-space: pre-wrap; overflow-wrap: anywhere; }
```

- [ ] **Step 7: 통과 확인**

Run: `cd frontend && npx vitest run src/screens/Projects.test.tsx && npm run typecheck`
Expected: PASS (7 tests), 타입 에러 없음

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/lib/api.ts frontend/src/components/icons.tsx frontend/src/screens/Projects.tsx frontend/src/screens/Projects.module.css frontend/src/screens/Projects.test.tsx
git commit -m "feat(projects): 프로젝트 목록·상세 화면 (팀 진도 + Discord)"
```

---

### Task 5: Growth 제거, Projects 탭 연결, 문서

**Files:**
- Modify: `frontend/src/lib/tabs.tsx`, `frontend/src/App.tsx`, `frontend/src/components/icons.tsx`, `frontend/src/styles/tokens.css`, `frontend/e2e/smoke.spec.ts`, `DESIGN.md`
- Delete: `frontend/src/screens/Growth.tsx`
- Test: `frontend/src/screens/Projects.test.tsx` (탭 테스트 추가)

**Interfaces:**
- Consumes: `ProjectList`, `ProjectDetail`, `IconProjects` (Task 4)
- Produces: 탭 바 `Today · Market · Timeline · Projects · Machines · Settings`

- [ ] **Step 1: 실패하는 테스트 추가** — `Projects.test.tsx` 맨 위 import에 `import { TABS } from '../lib/tabs';` 추가, 파일 끝에:

```tsx
describe('tabs', () => {
  it('Growth 자리에 Projects', () => {
    expect(TABS.map((t) => t.label)).toEqual(['Today', 'Market', 'Timeline', 'Projects', 'Machines', 'Settings']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/screens/Projects.test.tsx`
Expected: FAIL — `Growth` 가 들어 있음

- [ ] **Step 3: 탭** — `frontend/src/lib/tabs.tsx`

```tsx
import { IconMachines, IconMarket, IconProjects, IconSettings, IconTimeline, IconToday } from '../components/icons';
```
그리고 `{ path: '/growth', label: 'Growth', Icon: IconGrowth },` 를
```tsx
  { path: '/projects', label: 'Projects', Icon: IconProjects },
```
로 바꾼다.

- [ ] **Step 4: 라우트** — `frontend/src/App.tsx`
  - `import { Growth } from './screens/Growth';` → `import { ProjectDetail, ProjectList } from './screens/Projects';`
  - `<Route path="/growth" element={<Growth />} />` →
```tsx
                  <Route path="/projects" element={<ProjectList />} />
                  <Route path="/projects/:id" element={<ProjectDetail />} />
```

- [ ] **Step 5: 삭제**
  - `git rm frontend/src/screens/Growth.tsx`
  - `frontend/src/components/icons.tsx`에서 `/** Growth — rising bars. */`부터 `IconGrowth` 함수 끝까지 삭제
  - `frontend/src/styles/tokens.css`에서 `/* Growth-only palette ...` 주석과 `--growth-p1`~`--growth-p5`, `--heat-0`~`--heat-4` 줄 삭제 (둘 다 Growth 전용이고 다른 곳에서 안 씀 — `grep -rn -e '--growth-p' -e '--heat-' frontend/src` 로 0건 확인)

- [ ] **Step 6: e2e** — `frontend/e2e/smoke.spec.ts`의 `await page.goto('/growth');` → `await page.goto('/projects');`

- [ ] **Step 7: DESIGN.md** (Personal OS 섹션)
  - `- **Tab bar (root):** \`Today\` · \`Timeline\` · \`Growth\` · \`Machines\` · \`Settings\`.` →
    `- **Tab bar (root):** \`Today\` · \`Market\` · \`Timeline\` · \`Projects\` · \`Machines\` · \`Settings\`. (Growth → Projects, 2026-10-07)`
  - `**[RISK 1] Project palette**`, `**[RISK 2] Contribution heat scale**`, `**Weekly aggregate:**` 세 항목 끝에 각각 ` *(보류 — Growth 탭 제거 2026-10-07, 토큰도 삭제. 주간 집계 화면을 다시 만들 때 복원)*` 추가

- [ ] **Step 8: 전체 확인**

Run: `cd frontend && npm test && npm run typecheck && npm run build && grep -rn "Growth\|IconGrowth" src | grep -v -i "growth_\|growth gap\|revenue"; cd ../hub && npm test`
Expected: 전부 PASS, 빌드 성공, grep 출력 없음

- [ ] **Step 9: 커밋**

```bash
git add -A frontend/src frontend/e2e DESIGN.md
git commit -m "feat(ui): Growth 탭을 Projects 탭으로 교체"
```

---

### Task 6: 배포 (서버, 사용자 확인 후)

코드 변경 없음. 기존 `deploy/README.md` 절차를 따른다. 서버 쓰기는 외부 작업이라 실행 전에 사용자에게 확인받는다.

- [ ] 서버 `~/cloud-claude/projects.json` 작성 (예시 복사 후 Discord 채널 ID를 사용자가 채움)
- [ ] 서버 `~/cloud-claude/.env`에 `DISCORD_BOT_TOKEN`, `GITHUB_TOKEN` 추가 (`~/penalty-bot/.env`와 같은 값)
- [ ] `ls -l ~/penalty-bot/config.json ~/penalty-bot/ledger.json`로 `ubuntu`가 읽을 수 있는지 확인
- [ ] `frontend/dist` + `hub/` 배포 → `sudo systemctl restart cloud-claude-hub` → `curl -s localhost:8787/healthz`
- [ ] 폰에서 Projects → Unikey 확인
