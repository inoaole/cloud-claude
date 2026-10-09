import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhases, versionsFromMilestones, daysBetween, featureStatus, currentVersion, exceptionsOf, healthOf } from './plan.js';

const sched = {
  phases: [{ name: 'W1', start: '2026-10-10', end: '2026-10-12' }, { name: '휴식', start: '2026-10-20', end: '2026-10-28', rest: true }],
  versions: [
    { id: '0.1.0', due: '2026-11-08', goal: 'MVP', features: [{ name: '기능정의서', owner: '찬웅', issues: [] }] },
    { id: '0.0.3', due: '2026-10-12', goal: '한 줄 관통', features: [
      { name: '기획 CRUD', owner: '종현', issues: ['o/r_api#4'] },
      { name: 'PRD 슬라이스', owner: '서윤' },
    ] },
  ],
};

test('parsePhases: 기간만 읽는다, 형식 오류는 throw', () => {
  assert.deepEqual(parsePhases(sched), sched.phases);
  assert.deepEqual(parsePhases({ phases: [] }), []);
  assert.throws(() => parsePhases({ phases: [{ name: 'W1', start: 'x', end: '2026-10-12' }] }), /phase/);
  assert.throws(() => parsePhases(null), /schedule/);
});

test('daysBetween: 날짜 문자열 차이', () => {
  assert.equal(daysBetween('2026-10-09', '2026-10-12'), 3);
  assert.equal(daysBetween('2026-10-14', '2026-10-12'), -2);
});

const issue = (number, state, extra = {}) => ({ number, state, ...extra });
const pull = (number, body) => ({ number, state: 'open', body, pull_request: {} });

test('featureStatus: 다섯 상태', () => {
  const items = new Map([['o/r_api', [issue(4, 'open'), issue(5, 'closed'), issue(6, 'open'), pull(9, 'Closes #6')]]]);
  const f = (issues) => featureStatus({ issues }, items);
  assert.deepEqual(f([]), { status: 'unlinked', pr: null });
  assert.deepEqual(f(['o/r_api#5']), { status: 'done', pr: null });
  assert.deepEqual(f(['o/r_api#6']), { status: 'pr', pr: 'api#9' });
  assert.deepEqual(f(['o/r_api#4']), { status: 'todo', pr: null });
  assert.deepEqual(f(['o/r_api#5', 'o/r_api#4']), { status: 'todo', pr: null }); // 하나라도 열려 있으면 미완
  assert.deepEqual(featureStatus({ issues: ['o/r_api#4'] }, new Map([['o/r_api', null]])), { status: null, pr: null }); // GitHub 실패
  assert.deepEqual(f(['o/r_api#77']), { status: null, pr: null }); // 없는 이슈 번호 = 확인 불가
});

test('featureStatus: #6 언급이 #60 에 걸리지 않는다', () => {
  const items = new Map([['o/r_api', [issue(6, 'open'), pull(9, 'Closes #60')]]]);
  assert.equal(featureStatus({ issues: ['o/r_api#6'] }, items).status, 'todo');
});

const ver = (id, due, statuses) => ({ id, due, goal: '', features: statuses.map((status, i) => ({ name: `f${i}`, owner: 'x', status })) });

test('currentVersion: 밀린 버전 우선, 그다음 가장 이른 미완, 전부 끝이면 null', () => {
  const vs = [ver('0.0.2', '2026-10-09', ['done']), ver('0.0.3', '2026-10-12', ['todo']), ver('0.0.4', '2026-11-01', ['todo'])];
  assert.equal(currentVersion(vs, '2026-10-10').id, '0.0.3');
  assert.equal(currentVersion([ver('0.0.2', '2026-10-09', ['pr']), ...vs.slice(1)], '2026-10-10').id, '0.0.2');
  assert.equal(currentVersion([ver('0.0.2', '2026-10-09', ['done'])], '2026-10-10'), null);
  // 이슈가 아직 없는 버전은 끝난 게 아니다 — "모든 버전 완료"로 위장하지 않는다
  assert.equal(currentVersion([ver('0.0.2', '2026-10-09', ['done']), ver('0.0.3', '2026-10-12', [])], '2026-10-10').id, '0.0.3');
});

const person = (name, over = {}) => ({ name, mode: 'dev', onTrack: true, history: [], prs: [], ...over });

test('exceptionsOf: 멈춘 오너, 실패한 사람, 확인 필요 PR — 정상은 없음', () => {
  const current = { features: [
    { name: 'PRD 슬라이스', owner: '서윤', status: 'todo' },
    { name: 'IA 슬라이스', owner: '찬웅', status: 'todo' },
    { name: '인증', owner: '종현', status: 'done' },
    { name: '오타 담당', owner: '서윤ㅇ', status: 'unlinked' },
  ] };
  const people = [
    person('서윤'),
    person('찬웅', { prs: [{ label: 'web#1' }] }), // PR 있음 → 멈춘 게 아님
    person('종현', { onTrack: false, history: [{ reason: '지난주 PR 없음' }] }),
  ];
  const reviews = [
    { label: 'web#12', author: '찬웅', url: 'u', verdict: 'suspect', question: 'q?', signals: [{ kind: 'chunk', ok: false, detail: '1,840줄 한 커밋' }, { kind: 'plan', ok: true, detail: '일치' }] },
    { label: 'web#13', author: '찬웅', url: 'u', verdict: 'ok', question: '', signals: [] },
  ];
  const ex = exceptionsOf({ current, people, reviews });
  assert.deepEqual(ex.map((e) => [e.kind, e.who ?? e.label]), [['stalled', '서윤'], ['failed', '종현'], ['review', 'web#12']]);
  assert.equal(ex[0].text, '이번 주 PR 없음 · 할 일: PRD 슬라이스');
  assert.equal(ex[1].text, '지난 판정 실패 · 지난주 PR 없음');
  assert.equal(ex[2].text, '찬웅 · 1,840줄 한 커밋');
});

test('exceptionsOf: 휴식 중이거나 PR 확인 불가(null)면 stalled 아님, current 없어도 동작', () => {
  const current = { features: [{ name: 'a', owner: '서윤', status: 'todo' }, { name: 'b', owner: '찬웅', status: 'todo' }] };
  const people = [person('서윤', { mode: 'exempt' }), person('찬웅', { prs: null })];
  assert.deepEqual(exceptionsOf({ current, people, reviews: [] }), []);
  assert.deepEqual(exceptionsOf({ current: null, people: [], reviews: [] }), []);
});

const cur = (daysLeft, statuses) => ({ id: '0.0.3', daysLeft, features: statuses.map((status, i) => ({ name: `기능${i}`, status })) });

test('healthOf: 스펙 3.3 표의 각 행', () => {
  assert.deepEqual(healthOf({ planState: 'error', current: null, exceptions: [] }), { level: 'unknown', why: '일정을 읽지 못함' });
  assert.deepEqual(healthOf({ planState: 'unconfigured', current: null, exceptions: [] }), { level: 'unknown', why: '일정이 연결되지 않음' });
  assert.equal(healthOf({ planState: 'ok', current: cur(3, ['done', null]), exceptions: [] }).level, 'unknown');
  assert.deepEqual(healthOf({ planState: 'ok', current: cur(-2, ['done', 'pr', 'todo']), exceptions: [] }), { level: 'off', why: '0.0.3 마감 2일 지남, 미완 2개' });
  assert.deepEqual(healthOf({ planState: 'ok', current: cur(3, ['done', 'todo', 'unlinked']), exceptions: [] }), { level: 'risk', why: '0.0.3까지 3일, 기능1 · 기능2 진행 안 보임' });
  assert.deepEqual(healthOf({ planState: 'ok', current: cur(10, ['todo']), exceptions: [{ kind: 'review', verdict: 'suspect' }] }), { level: 'risk', why: '확인 필요 1개' });
  assert.equal(healthOf({ planState: 'ok', current: cur(10, ['todo']), exceptions: [{ kind: 'review', verdict: 'check' }] }).level, 'on');
  assert.deepEqual(healthOf({ planState: 'ok', current: cur(10, ['done', 'pr']), exceptions: [] }), { level: 'on', why: '0.0.3까지 10일, 2개 중 1개 머지' });
  assert.deepEqual(healthOf({ planState: 'ok', current: null, exceptions: [] }), { level: 'on', why: '모든 버전 완료' });
  assert.deepEqual(healthOf({ planState: 'ok', current: cur(2, []), exceptions: [] }), { level: 'risk', why: '0.0.3에 이슈 없음' });
  assert.deepEqual(healthOf({ planState: 'ok', current: cur(-1, []), exceptions: [] }), { level: 'off', why: '0.0.3에 이슈 없음' });
});

test('versionsFromMilestones: 레포를 가로질러 같은 버전을 합치고, 마감 없는 마일스톤은 뺀다', () => {
  const ms = (number, title, due_on, description = '') => ({ number, title, due_on, description });
  const iss = (number, title, login, over = {}) => ({ number, title, state: 'open', user: { login }, assignees: [], ...over });
  const vs = versionsFromMilestones([
    { repo: 'o/r_api', milestones: [ms(1, '0.0.1', '2026-10-09T12:00:00Z', '스캐폴딩 · 회원가입 · 로그인. 첫 기능 묶음.'), ms(3, '1.0.0 — 정식 릴리스', null)],
      issues: { 1: [iss(2, '인증 스키마', 'inoaole')] } },
    { repo: 'o/r_web', milestones: [ms(1, '0.0.1', '2026-10-09T12:00:00Z'), ms(2, '0.1.0 — MVP', '2026-11-08T12:00:00Z')],
      issues: { 1: [iss(31, 'rewrites', 'inoaole', { assignees: [{ login: 'banunas' }] })], 2: [] } },
  ], { inoaole: '종현', banunas: '서윤' });
  assert.deepEqual(vs.map((v) => [v.id, v.due, v.goal]), [['0.0.1', '2026-10-09', '스캐폴딩 · 회원가입 · 로그인'], ['0.1.0', '2026-11-08', 'MVP']]);
  assert.deepEqual(vs[0].features, [
    { name: '인증 스키마', owner: '종현', issues: ['o/r_api#2'] },
    { name: 'rewrites', owner: '서윤', issues: ['o/r_web#31'] }, // assignee 가 작성자보다 우선
  ]);
  assert.deepEqual(vs[1].features, []);
});
