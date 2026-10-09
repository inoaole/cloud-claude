import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseClaudeJson, childEnv, validateReview, validateTldr, runBrief, runClaude, MAX_REVIEWS } from './brief.js';

test('parseClaudeJson: 코드펜스·잡설 섞여도, 깨지면 null', () => {
  assert.deepEqual(parseClaudeJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseClaudeJson('결과입니다: {"a":{"b":2}} 끝'), { a: { b: 2 } });
  assert.equal(parseClaudeJson('모르겠어요'), null);
  assert.equal(parseClaudeJson('{"a":'), null);
});

test('childEnv: 허용 목록만 — GitHub·Discord·허브 비밀은 빠진다', () => {
  const e = childEnv({ PATH: '/bin', HOME: '/h', LANG: 'ko', CLAUDE_CODE_OAUTH_TOKEN: 'o', GITHUB_TOKEN: 'g', DISCORD_BOT_TOKEN: 'd', HUB_PIN: '1', SESSION_SECRET: 's' });
  assert.deepEqual(e, { PATH: '/bin', HOME: '/h', LANG: 'ko', CLAUDE_CODE_OAUTH_TOKEN: 'o' });
});

test('validateReview: 모르는 verdict 거부, 모르는 신호 버림', () => {
  assert.equal(validateReview({ verdict: 'bad', signals: [], question: '' }), null);
  assert.equal(validateReview(null), null);
  assert.deepEqual(
    validateReview({ verdict: 'check', signals: [{ kind: 'chunk', ok: false, detail: 'x' }, { kind: 'vibes', ok: true, detail: 'y' }], question: 'q?' }),
    { verdict: 'check', signals: [{ kind: 'chunk', ok: false, detail: 'x' }], question: 'q?' },
  );
});

test('validateTldr: 종류 검증, 날짜당 5줄, count 는 우리가 센 값', () => {
  const items = Array.from({ length: 7 }, (_, i) => ({ kind: '결정', text: `t${i}` }));
  const out = validateTldr({ days: [{ day: '2026-10-09', items: [...items, { kind: '잡담', text: 'z' }] }] }, new Map([['2026-10-09', 47]]));
  assert.equal(out[0].items.length, 5);
  assert.equal(out[0].count, 47);
  assert.equal(validateTldr({ nope: 1 }, new Map()), null);
});

// ── runBrief ──────────────────────────────────────────────────────────────────

const NOW = Date.parse('2026-10-09T09:00:00+09:00');
const pr = (n) => ({ label: `web#${n}`, title: 't', url: `u${n}`, state: 'open', repo: 'o/r_web', number: n });
const detail = (prs = [pr(12)]) => ({
  plan: { state: 'ok', current: { id: '0.0.3', goal: '한 줄 관통', features: [{ name: 'IA 슬라이스', owner: '찬웅', status: 'pr' }] } },
  team: { people: [{ name: '찬웅', prs }] },
});
const res = (body, status = 200) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body), text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)) });
const fetchFn = (url) => {
  if (url.includes('/commits')) return res([{ commit: { message: 'feat: x\n\nbody' } }]);
  if (url.startsWith('https://api/pulls/')) return res('diff --git a/x b/x\n+y\n'); // meta.url → diff
  const m = url.match(/api\.github\.com\/repos\/.+\/pulls\/(\d+)$/);
  if (m) return res({ number: Number(m[1]), title: 't', body: '', additions: 1840, deletions: 0, head: { sha: `sha${m[1]}` }, url: `https://api/pulls/${m[1]}` });
  if (url.includes('discord.com')) return res([
    { id: '30', author: { username: '찬웅' }, content: '계약은 contracts 로', timestamp: '2026-10-09T01:00:00+00:00', attachments: [] },
    { id: '20', author: { username: '서윤' }, content: '어제 얘기', timestamp: '2026-10-08T01:00:00+00:00', attachments: [] },
    { id: '10', author: { username: '서윤' }, content: '그저께', timestamp: '2026-10-06T01:00:00+00:00', attachments: [] },
  ]);
  throw new Error(`unexpected ${url}`);
};
const REVIEW = JSON.stringify({ verdict: 'suspect', signals: [{ kind: 'chunk', ok: false, detail: '1,840줄 한 커밋' }], question: '왜 평탄 배열?' });
const TLDR = JSON.stringify({ days: [{ day: '2026-10-09', items: [{ kind: '결정', text: '계약은 contracts' }] }, { day: '2026-10-08', items: [{ kind: '공지', text: '어제' }] }] });
function claude(answers) {
  const calls = [];
  return { calls, fn: async (prompt, input) => { calls.push({ prompt, input }); return answers(prompt, input); } };
}
const both = (prompt) => (prompt.includes('코드 리뷰어') ? REVIEW : TLDR);
const deps = (over = {}) => ({ fetchFn, env: { GITHUB_TOKEN: 'g', DISCORD_BOT_TOKEN: 'd' }, now: NOW, log: () => {}, prev: {}, channels: [{ id: '1', name: 'general' }], ...over });

test('새 PR 은 계획 맥락과 함께 판정하고 sha 로 저장', async () => {
  const c = claude(both);
  const out = await runBrief(detail(), deps({ claudeFn: c.fn }));
  const key = 'o/r_web#12@sha12';
  assert.equal(out.reviews[key].verdict, 'suspect');
  assert.equal(out.reviews[key].author, '찬웅');
  const input = JSON.parse(c.calls.find((x) => x.prompt.includes('코드 리뷰어')).input);
  assert.deepEqual(input.plan, { version: '0.0.3', goal: '한 줄 관통', features: ['IA 슬라이스 (찬웅)'], authorFeatures: ['IA 슬라이스'] });
  assert.deepEqual(input.pr.commits, ['feat: x']);
  assert.equal(out.generatedAt, new Date(NOW).toISOString());
});

test('같은 sha 는 다시 판정하지 않는다 (호출 0)', async () => {
  const prev = { reviews: { 'o/r_web#12@sha12': { label: 'web#12', verdict: 'ok', signals: [], question: '' } }, tldrKey: '2026-10-09:30', tldr: [{ day: '2026-10-09', count: 2, items: [] }] };
  const c = claude(both);
  const out = await runBrief(detail(), deps({ claudeFn: c.fn, prev }));
  assert.equal(c.calls.length, 0);
  assert.equal(out.reviews['o/r_web#12@sha12'].verdict, 'ok');
  assert.deepEqual(out.tldr, prev.tldr);
});

test('판정이 깨지면 같은 PR 의 이전 판정 유지, 전부 실패면 generatedAt 유지', async () => {
  const prev = { generatedAt: 'old', reviews: { 'o/r_web#12@oldsha': { label: 'web#12', verdict: 'check', signals: [], question: '' } } };
  const logs = [];
  const out = await runBrief(detail(), deps({ claudeFn: claude(() => '모르겠음').fn, prev, log: (m) => logs.push(m) }));
  assert.equal(out.reviews['o/r_web#12@oldsha'].verdict, 'check');
  assert.equal(out.generatedAt, 'old');
  assert.ok(logs.length >= 1);
});

test('PR 판정은 실행당 MAX_REVIEWS 개까지', async () => {
  const c = claude(both);
  const out = await runBrief(detail(Array.from({ length: MAX_REVIEWS + 5 }, (_, i) => pr(i + 1))), deps({ claudeFn: c.fn }));
  assert.equal(out.pending.length, 5); // 판정 못 한 PR 은 사라지지 않고 대기로 남는다
  assert.equal(c.calls.filter((x) => x.prompt.includes('코드 리뷰어')).length, MAX_REVIEWS);
});

test('대화 요약: 오늘·어제 메시지만, 날짜별 count, 메시지 없으면 호출 없이 []', async () => {
  const c = claude(both);
  const out = await runBrief(detail([]), deps({ claudeFn: c.fn }));
  const input = JSON.parse(c.calls[0].input);
  assert.deepEqual(input.map((m) => m.day), ['2026-10-08', '2026-10-09']); // 그저께 제외, 오래된 순
  assert.deepEqual(out.tldr.map((d) => [d.day, d.count]), [['2026-10-09', 1], ['2026-10-08', 1]]);
  assert.equal(out.tldrKey, '2026-10-09:30');
  const none = claude(both);
  const empty = await runBrief(detail([]), deps({ claudeFn: none.fn, channels: [] }));
  assert.deepEqual([none.calls.length, empty.tldr], [0, []]);
});

test('GitHub·Discord 가 다 죽으면 이전 요약·판정·시각 유지 — 조용한 날로 위장하지 않는다', async () => {
  const prev = { generatedAt: 'old', tldrKey: '2026-10-09:30', tldr: [{ day: '2026-10-09', count: 3, items: [] }],
    reviews: { 'o/r_web#12@sha12': { label: 'web#12', author: '찬웅', verdict: 'suspect', signals: [], question: '' } } };
  const down = (url) => (url.includes('discord.com') ? res({}, 503) : fetchFn(url));
  const c = claude(both);
  const out = await runBrief(detail(null), deps({ claudeFn: c.fn, prev, fetchFn: down }));
  assert.equal(c.calls.length, 0);
  assert.equal(out.generatedAt, 'old');
  assert.deepEqual(out.tldr, prev.tldr);
  assert.equal(out.tldrKey, prev.tldrKey);
  assert.equal(out.reviews['o/r_web#12@sha12'].verdict, 'suspect');
});

test('대화 요약 캐시는 날짜가 바뀌면 다시 만든다', async () => {
  const prev = { tldrKey: '2026-10-08:30', tldr: [{ day: '2026-10-07', count: 1, items: [] }] };
  const c = claude(both);
  const out = await runBrief(detail([]), deps({ claudeFn: c.fn, prev }));
  assert.equal(c.calls.length, 1);
  assert.equal(out.tldr[0].day, '2026-10-09');
});

function fakeChild({ code = 0, stdout = '', stdinError = false } = {}) {
  const calls = [];
  const spawnFn = (cmd, args) => {
    calls.push(args);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    child.stdin = new EventEmitter();
    child.stdin.end = () => setImmediate(() => {
      if (stdinError) child.stdin.emit('error', Object.assign(new Error('EPIPE'), { code: 'EPIPE' }));
      if (stdout) child.stdout.emit('data', stdout);
      child.emit('close', code);
    });
    return child;
  };
  return { calls, spawnFn };
}

test('runClaude: 사용자 설정·MCP 를 불러오지 않는다', async () => {
  const f = fakeChild({ stdout: '{"a":1}' });
  assert.equal(await runClaude('p', 'i', f.spawnFn), '{"a":1}');
  assert.ok(f.calls[0].includes('--strict-mcp-config'));
  const i = f.calls[0].indexOf('--setting-sources');
  assert.equal(f.calls[0][i + 1], '');
});

test('runClaude: stdin EPIPE 는 거부로 끝나고 프로세스를 죽이지 않는다', async () => {
  const f = fakeChild({ code: 1, stdinError: true });
  await assert.rejects(runClaude('p', 'i', f.spawnFn), /exit 1/);
});
