import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectDetail, ProjectList } from './Projects';
import { getProject, getProjects, type ProjectDetailData } from '../lib/api';
import { TABS } from '../lib/tabs';

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
      { id: 'mabc', name: 'Unikey', state: 'ok', summary: { onTrack: 2, judged: 3 }, lastMessageAt: null },
      { id: 'swyp', name: 'SWYP 7기', state: 'ok', summary: null, lastMessageAt: null },
    ]);
    renderList();
    expect(await screen.findByText(/2\/3 on track/)).toBeInTheDocument();
    expect(screen.getByText('판정 없음')).toBeInTheDocument();
  });

  it('목록에서 오류와 미연결은 "판정 없음" 과 다른 문구', async () => {
    mockList.mockResolvedValue([
      { id: 'mabc', name: 'Unikey', state: 'error', summary: null, lastMessageAt: null },
      { id: 'swyp', name: 'SWYP 7기', state: 'unconfigured', summary: null, lastMessageAt: null },
    ]);
    renderList();
    expect(await screen.findByText('불러오지 못함')).toBeInTheDocument();
    expect(screen.getByText('연결된 소스 없음')).toBeInTheDocument();
    expect(screen.queryByText('판정 없음')).not.toBeInTheDocument();
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

  it('GitHub 아이디가 없는 사람은 "PR 확인 불가" 가 아니라 아이디 없음', async () => {
    const d = detail();
    d.team.people = [{ ...d.team.people[1], github: null, prs: null }];
    mockDetail.mockResolvedValue(d);
    renderDetail();
    expect(await screen.findByText('GitHub 아이디 없음')).toBeInTheDocument();
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

describe('tabs', () => {
  it('Growth 자리에 Projects', () => {
    expect(TABS.map((t) => t.label)).toEqual(['Today', 'Market', 'Timeline', 'Projects', 'Machines', 'Settings']);
  });
});
