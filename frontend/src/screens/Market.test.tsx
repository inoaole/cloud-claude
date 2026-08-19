import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Market } from './Market';
import { getMarketLatest, type Briefing, type MarketLatest } from '../lib/api';

vi.mock('../lib/api', () => ({ getMarketLatest: vi.fn() }));
const mockLatest = vi.mocked(getMarketLatest);

const briefing: Briefing = {
  run_id: '2026-08-18T21:30:00Z',
  date: '2026-08-18',
  status: 'ok',
  dropped: [],
  script_ko: [
    { heading: '거시', text: '어제 미국 시장은 위험 회피 쪽으로 기울었습니다.' },
    { heading: '섹터', text: '전력과 원전 쪽 이야기가 다시 올라오고 있습니다.' },
  ],
  watchlist_checks: [
    { ticker: 'ZENC', price: 9.4, rule: 'stop 7.5', action: '전량 컷', triggered: false },
  ],
  candidates: [
    {
      ticker: 'ACME', incumbent: 'OMNI', dimension: 'contract_wins', period: '2026Q2',
      growth_gap_pp: 666.2, dilution_yoy_pct: 6.6, price_at_surface: 271.22,
      thesis: '1위에게서 계약을 가져오는 중',
      evidence: [
        { claim: '장기계약 체결', url: 'https://example.com/a', published_at: '2026-07-14' },
        { claim: '계약 확장', url: 'https://example.com/b', published_at: '2026-07-20' },
      ],
    },
  ],
  outcomes: null,
  failure_reason: null,
  audio: null,
};

const ready = (over: Partial<Briefing> = {}): MarketLatest => ({
  state: 'ready',
  briefing: { ...briefing, ...over },
});

describe('Market', () => {
  beforeEach(() => mockLatest.mockReset());

  it('renders sections as readable prose', async () => {
    mockLatest.mockResolvedValue(ready());
    render(<Market />);

    expect(await screen.findByText('거시')).toBeInTheDocument();
    expect(screen.getByText(/어제 미국 시장은 위험 회피/)).toBeInTheDocument();
    expect(screen.getByText('섹터')).toBeInTheDocument();
    // An `ok` briefing does not shout its own status.
    expect(screen.queryByText('degraded')).not.toBeInTheDocument();
  });

  it('shows the dropped count and reason when degraded', async () => {
    mockLatest.mockResolvedValue(
      ready({
        status: 'degraded',
        dropped: [
          { ticker: 'FAKE', reason: 'ticker_not_found' },
          { ticker: 'VERTO', reason: 'incumbent_not_found' },
        ],
      }),
    );
    render(<Market />);

    expect(await screen.findByText('degraded')).toBeInTheDocument();
    expect(screen.getByText(/검증 실패 2건/)).toBeInTheDocument();

    await userEvent.click(screen.getByText(/검증 실패 2건/));
    expect(screen.getByText('FAKE')).toBeInTheDocument();
    expect(screen.getByText('ticker_not_found')).toBeInTheDocument();
  });

  it('says the generator failed — not "no candidates"', async () => {
    mockLatest.mockResolvedValue(
      ready({
        status: 'failed',
        candidates: [],
        script_ko: [],
        failure_reason: 'TimeoutError: claude_timeout after 600.0s',
      }),
    );
    render(<Market />);

    expect(await screen.findByText('failed')).toBeInTheDocument();
    expect(screen.getByText(/생성기가 실패했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/claude_timeout/)).toBeInTheDocument();
    // The empty-briefing reading must be impossible.
    expect(screen.queryByText(/오늘은 새로 제시할 종목이 없습니다/)).not.toBeInTheDocument();
  });

  it('a failed briefing with no reason still says something', async () => {
    mockLatest.mockResolvedValue(
      ready({ status: 'failed', candidates: [], script_ko: [], failure_reason: null }),
    );
    render(<Market />);

    expect(await screen.findByText(/생성기가 실패했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/이유가 기록되지 않았습니다/)).toBeInTheDocument();
  });

  it('shows "아직 오지 않음" before 06:30', async () => {
    mockLatest.mockResolvedValue({ state: 'pending', expected_at: '2026-08-18T06:30:00+09:00' });
    render(<Market />);

    expect(await screen.findByText(/아직 오지 않음/)).toBeInTheDocument();
    expect(screen.getByText(/06:30/)).toBeInTheDocument();
  });

  it('shows "생성되지 않음" after the deadline', async () => {
    mockLatest.mockResolvedValue({ state: 'missing', expected_at: '2026-08-18T06:30:00+09:00' });
    render(<Market />);

    expect(await screen.findByText(/생성되지 않음/)).toBeInTheDocument();
    // pending and missing must not read alike.
    expect(screen.queryByText(/아직 오지 않음/)).not.toBeInTheDocument();
  });

  it('surfaces a triggered watchlist rule at the top', async () => {
    mockLatest.mockResolvedValue(
      ready({
        watchlist_checks: [
          { ticker: 'ACME', price: 268.8, rule: null, action: null, triggered: null },
          { ticker: 'ZENC', price: 7.4, rule: 'stop 7.5', action: '전량 컷', triggered: true },
        ],
      }),
    );
    render(<Market />);

    const alert = await screen.findByTestId('triggered');
    expect(alert).toHaveTextContent('ZENC');
    expect(alert).toHaveTextContent('전량 컷');
    // Above the narration, not buried under it.
    const prose = screen.getByText(/어제 미국 시장은 위험 회피/);
    expect(alert.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders "확인하지 못함" for a null triggered', async () => {
    mockLatest.mockResolvedValue(
      ready({
        watchlist_checks: [
          {
            ticker: 'ZENC', price: null, rule: 'stop 7.5', action: '전량 컷',
            triggered: null, unresolved_reason: 'no_price',
          },
        ],
      }),
    );
    render(<Market />);

    expect(await screen.findByText('확인하지 못함')).toBeInTheDocument();
    expect(screen.queryByText('미도달')).not.toBeInTheDocument();
  });

  it('a watching entry with no rule is "관찰 중", not "확인하지 못함"', async () => {
    // Regression from the first real briefing: `watching` entries have no rule,
    // so the gate reports triggered:null for them too. Reading that as "could
    // not check" told the user seven prices were missing when they were all there.
    mockLatest.mockResolvedValue(
      ready({
        watchlist_checks: [
          { ticker: 'ACME', price: 248.43, rule: null, action: null, triggered: null, note: '가상 종목 — 테스트 픽스처' },
        ],
      }),
    );
    render(<Market />);

    expect(await screen.findByText('관찰 중')).toBeInTheDocument();
    expect(screen.queryByText('확인하지 못함')).not.toBeInTheDocument();
    expect(screen.getByText('$248.43')).toBeInTheDocument();
  });

  it('renders candidate numbers and reachable evidence links', async () => {
    mockLatest.mockResolvedValue(ready());
    render(<Market />);

    expect(await screen.findByText(/ACME/)).toBeInTheDocument();
    expect(screen.getByText(/666\.2/)).toBeInTheDocument();
    expect(screen.getByText('계약 수주')).toBeInTheDocument();   // dimension in Korean
    expect(screen.getByText('참고')).toBeInTheDocument();        // gap is off-axis here
    expect(screen.getByText(/1위에게서 계약을 가져오는 중/)).toBeInTheDocument();

    await userEvent.click(screen.getByText(/근거 2건/));
    const link = screen.getByRole('link', { name: /장기계약 체결/ });
    expect(link).toHaveAttribute('href', 'https://example.com/a');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('shows the scoreboard line including unresolved rows', async () => {
    mockLatest.mockResolvedValue(
      ready({
        outcomes: {
          n: 9, scored: 8, positive: 5, hit_rate_pct: 62.5, median_pct: 3.2,
          best: { ticker: 'ACME', return_pct: 18.0 },
          worst: { ticker: 'ABC', return_pct: -11.0 },
          unresolved: 1,
        },
      }),
    );
    render(<Market />);

    const line = await screen.findByTestId('scoreboard');
    expect(line).toHaveTextContent('9개 중 5개');
    expect(line).toHaveTextContent('3.2%');
    expect(line).toHaveTextContent('1개 확인 못함');
  });

  it('surfaces a hub error instead of an empty screen, and retries', async () => {
    mockLatest.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(ready());
    render(<Market />);

    expect(await screen.findByText(/허브에 연결하지 못했습니다/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('거시')).toBeInTheDocument();
  });
});

describe('Market — the gap label follows the dimension', () => {
  const cand = briefing.candidates[0];

  it('a revenue_growth_yoy claim shows the gap as the claim, unqualified', async () => {
    mockLatest.mockResolvedValue(
      ready({ candidates: [{ ...cand, dimension: 'revenue_growth_yoy', growth_gap_pp: 20.0 }] }),
    );
    render(<Market />);

    expect(await screen.findByText('매출 성장률')).toBeInTheDocument();
    expect(screen.getByText(/매출 성장률 갭 \+20\.0%p/)).toBeInTheDocument();
    expect(screen.queryByText('참고')).not.toBeInTheDocument();
  });

  it('a market_share claim marks the gap as reference, not the reason', async () => {
    // growth_gap_pp is ALWAYS revenue. Real case: AMD ← NVDA, market_share,
    // −35.1%p. Showing that bare read as "the pick is losing", when the gate
    // never measured share at all.
    mockLatest.mockResolvedValue(
      ready({ candidates: [{ ...cand, dimension: 'market_share', growth_gap_pp: -35.1 }] }),
    );
    render(<Market />);

    expect(await screen.findByText('점유율')).toBeInTheDocument();
    expect(screen.getByText('참고')).toBeInTheDocument();
    expect(screen.getByText(/매출 성장률 갭 -35\.1%p/)).toBeInTheDocument();
  });

  it('an unknown dimension falls back to the raw value rather than blanking', async () => {
    mockLatest.mockResolvedValue(
      ready({ candidates: [{ ...cand, dimension: 'brand_new_axis' }] }),
    );
    render(<Market />);

    expect(await screen.findByText('brand_new_axis')).toBeInTheDocument();
    expect(screen.getByText('참고')).toBeInTheDocument();
  });
});
