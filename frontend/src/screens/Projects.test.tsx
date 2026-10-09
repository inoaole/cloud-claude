import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { ProjectChat, ProjectDetail, ProjectList, ProjectPrs } from './Projects';
import { ProjectTimeline } from './ProjectTimeline';
import { getProject, getProjects, type ProjectDetailData, type ProjectListItem } from '../lib/api';
import { TABS } from '../lib/tabs';

vi.mock('../lib/api', () => ({ getProjects: vi.fn(), getProject: vi.fn() }));
const mockList = vi.mocked(getProjects);
const mockDetail = vi.mocked(getProject);

const renderAt = (path: string, el: JSX.Element, route = '/projects/:id') => render(
  <MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} /></Routes></MemoryRouter>,
);

const detail = (over: Partial<ProjectDetailData> = {}): ProjectDetailData => ({
  id: 'mabc', name: 'Unikey', weekStart: '2026-10-05',
  team: { state: 'ok', summary: { onTrack: 2, judged: 3 }, people: [
    { name: '종현', github: 'inoaole', mode: 'dev', onTrack: true, history: [{ week: '2026-09-28', status: 'pass', reason: 'ok' }],
      prs: [{ label: 'web#30', title: 't', url: 'https://x/30', state: 'merged' }] },
    { name: '서윤', github: 'banunas', mode: 'dev', onTrack: false, history: [{ week: '2026-09-28', status: 'fail', reason: 'r' }], prs: [] },
    { name: '찬웅', github: null, mode: 'dev', onTrack: true, history: [], prs: null },
  ] },
  ledger: { state: 'ok' }, github: { state: 'ok' },
  discord: { state: 'ok', channels: [{ id: '1', name: 'general', state: 'ok', messages: [
    { id: 'm1', author: '찬웅', content: '<b>x</b>', ts: '2026-10-09T00:00:00+00:00', attachments: 0 },
  ] }] },
  plan: { state: 'ok', today: '2026-10-09',
    phases: [{ name: 'W1', start: '2026-10-10', end: '2026-10-12' }, { name: '휴식', start: '2026-10-20', end: '2026-10-28', rest: true }],
    milestones: [{ id: '0.0.2', due: '2026-10-09', done: true }, { id: '0.0.3', due: '2026-10-12', done: false }],
    current: { id: '0.0.3', due: '2026-10-12', goal: '한 줄 관통', daysLeft: 3, features: [
      { name: '인증', owner: '종현', status: 'done', pr: null },
      { name: '기획 CRUD', owner: '종현', status: 'pr', pr: 'api#4' },
      { name: 'IA 슬라이스', owner: '찬웅', status: 'todo', pr: null },
      { name: 'PRD 슬라이스', owner: '서윤', status: 'unlinked', pr: null },
      { name: '배포', owner: '종현', status: null, pr: null },
    ] } },
  health: { level: 'risk', why: '0.0.3까지 3일, PRD 슬라이스 진행 안 보임' },
  exceptions: [
    { kind: 'stalled', who: '서윤', text: '이번 주 PR 없음 · 할 일: PRD 슬라이스' },
    { kind: 'review', label: 'web#12', verdict: 'suspect', url: 'https://x/12', question: '왜 평탄 배열?', text: '찬웅 · 1,840줄 한 커밋' },
  ],
  brief: { state: 'ok', generatedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
    tldr: [{ day: '2026-10-09', count: 47, items: [{ kind: '결정', text: '계약은 contracts/*.json' }, { kind: '막힘', text: '찬웅 — OpenAI 키 없음' }] }],
    reviews: [
      { key: 'k12', label: 'web#12', author: '찬웅', title: 'feat(ia): 트리', url: 'https://x/12', verdict: 'suspect', question: '왜 평탄 배열?',
        signals: [{ kind: 'plan', ok: true, detail: '0.0.3 IA 슬라이스와 일치' }, { kind: 'chunk', ok: false, detail: '1,840줄 한 커밋' }] },
      { key: 'k30', label: 'web#30', author: '종현', title: 'feat(auth)', url: 'https://x/30', verdict: 'ok', question: '', signals: [] },
    ], pending: [] },
  ...over,
});

const item = (over: Partial<ProjectListItem> = {}): ProjectListItem => ({
  id: 'mabc', name: 'Unikey', state: 'ok', summary: null, lastMessageAt: null,
  health: { level: 'risk', why: 'w' }, currentId: '0.0.3', daysLeft: 3, exceptionCount: 2, ...over,
});

describe('ProjectList', () => {
  beforeEach(() => mockList.mockReset());

  it('건강 · 현재 버전 D-day · 확인 필요 수', async () => {
    mockList.mockResolvedValue([item(), item({ id: 'swyp', name: 'SWYP 7기', state: 'unconfigured', currentId: null, daysLeft: null, exceptionCount: 0, health: { level: 'unknown', why: '' } })]);
    render(<MemoryRouter><ProjectList /></MemoryRouter>);
    expect(await screen.findByText(/At risk/)).toBeInTheDocument();
    expect(screen.getByText(/D-3/)).toBeInTheDocument();
    expect(screen.getByText(/확인 필요 2/)).toBeInTheDocument();
    expect(screen.getByText('연결된 소스 없음')).toBeInTheDocument();
  });

  it('프로젝트가 없으면 빈 상태', async () => {
    mockList.mockResolvedValue([]);
    render(<MemoryRouter><ProjectList /></MemoryRouter>);
    expect(await screen.findByText('프로젝트 없음')).toBeInTheDocument();
  });
});

describe('ProjectDetail', () => {
  beforeEach(() => mockDetail.mockReset());

  it('판정 한 줄이 맨 위에', async () => {
    mockDetail.mockResolvedValue(detail());
    renderAt('/projects/mabc', <ProjectDetail />);
    expect(await screen.findByText('At risk')).toBeInTheDocument();
    expect(screen.getByText('0.0.3까지 3일, PRD 슬라이스 진행 안 보임')).toBeInTheDocument();
  });

  it('체크리스트: 다섯 상태가 서로 다른 문구', async () => {
    mockDetail.mockResolvedValue(detail());
    renderAt('/projects/mabc', <ProjectDetail />);
    expect(await screen.findByText('머지')).toBeInTheDocument();
    expect(screen.getByText('api#4')).toBeInTheDocument();
    expect(screen.getByText('시작 안 함')).toBeInTheDocument();
    expect(screen.getByText('이슈 없음')).toBeInTheDocument();
    expect(screen.getByText('확인 불가')).toBeInTheDocument();
  });

  it('확인 필요: 예외만, 의심 PR 에는 물어볼 것', async () => {
    mockDetail.mockResolvedValue(detail());
    renderAt('/projects/mabc', <ProjectDetail />);
    expect(await screen.findByText('이번 주 PR 없음 · 할 일: PRD 슬라이스')).toBeInTheDocument();
    expect(screen.getAllByText('~딸깍 의심').length).toBeGreaterThan(0);
    expect(screen.getByText('왜 평탄 배열?')).toBeInTheDocument();
  });

  it('예외가 없으면 확인 필요 섹션이 없다', async () => {
    mockDetail.mockResolvedValue(detail({ exceptions: [] }));
    renderAt('/projects/mabc', <ProjectDetail />);
    await screen.findByText('At risk');
    expect(screen.queryByText(/확인 필요/)).not.toBeInTheDocument();
  });

  it('대화 요약은 텍스트, 생성 시각은 ~', async () => {
    mockDetail.mockResolvedValue(detail());
    renderAt('/projects/mabc', <ProjectDetail />);
    expect(await screen.findByText('계약은 contracts/*.json')).toBeInTheDocument();
    expect(screen.getByText(/팀 대화 · 10\/09 · ~40분 전/)).toBeInTheDocument();
  });

  it('일정·요약이 없거나 깨지면 그렇게 말한다', async () => {
    mockDetail.mockResolvedValue(detail({ plan: { state: 'unconfigured' }, brief: { state: 'error', generatedAt: null }, health: { level: 'unknown', why: '일정이 연결되지 않음' } }));
    renderAt('/projects/mabc', <ProjectDetail />);
    expect(await screen.findByText('판정 불가')).toBeInTheDocument();
    expect(screen.getByText('연결된 소스 없음')).toBeInTheDocument();
    expect(screen.getByText('요약이 갱신되지 않음')).toBeInTheDocument();
  });

  it('지난 판정은 접힌 곳에 그대로 — PR 확인 불가와 GitHub 아이디 없음 구분 유지', async () => {
    mockDetail.mockResolvedValue(detail());
    renderAt('/projects/mabc', <ProjectDetail />);
    await screen.findByText('At risk');
    expect(screen.getByText(/지난 판정 · 2\/3 on track/)).toBeInTheDocument();
    expect(screen.getByText('이번 주 PR 없음')).toBeInTheDocument();
    expect(screen.getByText('GitHub 아이디 없음')).toBeInTheDocument();
  });
});

describe('ProjectTimeline', () => {
  const phases = [{ name: 'W1', start: '2026-10-10', end: '2026-10-12' }];
  const milestones = [{ id: '0.0.3', due: '2026-10-12', done: false }, { id: 'MVP', due: '2026-11-08', done: false }];

  it('기간·마일스톤·오늘이 그려진다', () => {
    const { container } = render(<ProjectTimeline phases={phases} milestones={milestones} today="2026-10-09" />);
    expect(screen.getByText('W1')).toBeInTheDocument();
    expect(screen.getByText('MVP')).toBeInTheDocument();
    expect(screen.getByText('오늘')).toBeInTheDocument();
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toContain('2026-10-09');
  });

  it('오늘이 범위 밖이어도 선은 SVG 안에 머문다', () => {
    const { container } = render(<ProjectTimeline phases={phases} milestones={milestones} today="2026-12-25" />);
    const x = Number(container.querySelector('line')?.getAttribute('x1'));
    expect(x).toBeGreaterThanOrEqual(8);
    expect(x).toBeLessThanOrEqual(322);
  });
});

describe('tabs', () => {
  it('Growth 자리에 Projects', () => {
    expect(TABS.map((t) => t.label)).toEqual(['Today', 'Market', 'Timeline', 'Projects', 'Machines', 'Settings']);
  });
});

describe('ProjectPrs', () => {
  beforeEach(() => mockDetail.mockReset());

  it('확인 필요 먼저: 배지 · 신호 · 물어볼 것, 괜찮음은 세그먼트 뒤', async () => {
    mockDetail.mockResolvedValue(detail());
    renderAt('/projects/mabc/prs', <ProjectPrs />, '/projects/:id/prs');
    expect(await screen.findByText('feat(ia): 트리')).toBeInTheDocument();
    expect(screen.getByText('~딸깍 의심')).toBeInTheDocument();
    expect(screen.getByText('1,840줄 한 커밋')).toBeInTheDocument();
    expect(screen.getByText('"왜 평탄 배열?"')).toBeInTheDocument();
    expect(screen.queryByText('feat(auth)')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '괜찮음 1' }));
    expect(screen.getByText('feat(auth)')).toBeInTheDocument();
  });

  it('요약이 없으면 그렇게 말한다', async () => {
    mockDetail.mockResolvedValue(detail({ brief: { state: 'unconfigured' } }));
    renderAt('/projects/mabc/prs', <ProjectPrs />, '/projects/:id/prs');
    expect(await screen.findByText('요약 준비 전')).toBeInTheDocument();
  });
});

describe('ProjectChat', () => {
  beforeEach(() => mockDetail.mockReset());

  it('요약이 기본, 원문은 세그먼트 뒤 — 원문은 태그가 아니라 글자', async () => {
    mockDetail.mockResolvedValue(detail());
    renderAt('/projects/mabc/chat', <ProjectChat />, '/projects/:id/chat');
    expect(await screen.findByText('찬웅 — OpenAI 키 없음')).toBeInTheDocument();
    expect(screen.getByText(/47개 → 2줄/)).toBeInTheDocument();
    expect(screen.queryByText('<b>x</b>')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '원문' }));
    expect(screen.getByText('<b>x</b>')).toBeInTheDocument();
  });
});

describe('ProjectPrs pending', () => {
  it('판정 못 한 PR 은 대기로 보인다', async () => {
    const d = detail();
    if (d.brief.state === 'ok') d.brief.pending = [{ label: 'web#40', author: '찬웅', url: 'https://x/40' }];
    mockDetail.mockResolvedValue(d);
    renderAt('/projects/mabc/prs', <ProjectPrs />, '/projects/:id/prs');
    expect(await screen.findByText(/판정 대기 · web#40/)).toBeInTheDocument();
  });
});
