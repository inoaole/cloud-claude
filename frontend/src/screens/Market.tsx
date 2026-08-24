import { useCallback, useEffect, useState } from 'react';
import { Group } from '../components/Group';
import { Cell } from '../components/Cell';
import { getMarketLatest, type Briefing, type MarketLatest, type WatchlistCheck } from '../lib/api';
import styles from './Market.module.css';

/* Market — the morning briefing, read (Phase 1b).

   Reading order is NOT the JSON order. Anything that can require action today
   goes first: a triggered stop-loss, then the status, then the narration. The
   screen's whole reason to exist is that `ok` / `degraded` / `failed` must not
   look alike — the gate went to real trouble to keep them apart in data, and a
   uniform grey card would flatten that back out. */

/** Three distinctions the UI is not allowed to collapse:
     - triggered === null WITH a rule  is "we could not check", never "not triggered"
     - triggered === null WITHOUT a rule is "there is nothing to check" — a
       `watching` entry has no rule, so the gate reports null for it too. The
       first real briefing narrated those as "가격을 확인하지 못했습니다" for
       seven positions whose prices were right there, which is a lie in the one
       direction this screen exists to prevent.
     - status === 'failed' is "the generator broke", never "a quiet morning" */
function triggerLabel(w: WatchlistCheck): string {
  if (w.triggered === true) return '도달';
  if (w.triggered === false) return '미도달';
  return w.rule == null ? '관찰 중' : '확인하지 못함';
}

function money(n: number | null | undefined): string {
  return n == null ? '—' : `$${n.toFixed(2)}`;
}

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
}

/** The gate ships ratios (0.0155); percent is a presentation choice made here.
    null renders as — because "we could not price it" is not 0%. */
function pct(rate: number | null | undefined): string {
  return rate == null ? '—' : `${signed(rate * 100)}%`;
}

/** Red on a loss, plain on a gain. Reuses the existing --danger token rather
    than introducing a green one: a losing position is the thing worth spotting
    from across the room, and this file's rule is no new color tokens. */
function lossy(rate: number | null | undefined) {
  return rate != null && rate < 0 ? styles.bad : undefined;
}

const DIMENSION_KO: Record<string, string> = {
  revenue_growth_yoy: '매출 성장률',
  contract_wins: '계약 수주',
  backlog_growth: '수주잔고',
  market_share: '점유율',
};

/** `growth_gap_pp` is ALWAYS a revenue comparison, whatever the dimension says.
    For `revenue_growth_yoy` that number is the claim itself. For the other three
    the gate measures a different axis entirely, so it is context — and a
    challenger taking contracts is routinely the slower-growing company, which is
    the shape of the trade, not a mark against it. Labelling both the same way
    made a −35.1%p reference figure read as the reason the pick was made.
    Mirrors `schema.GAP_IS_THE_CLAIM` on the runner side. */
const GAP_IS_THE_CLAIM = new Set(['revenue_growth_yoy']);

/** 2026-08-18 → 8월 18일. Parsed at noon UTC so the day cannot slip a date. */
function headerFor(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'UTC', month: 'long', day: 'numeric' }).format(d);
}

/** 06:30 out of an ISO string, without pulling the phone's tz into it —
    the deadline is a KST fact and the offset is already in the string. */
function hhmmOf(iso: string | undefined): string {
  const m = iso?.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : '06:30';
}

function StatusBadge({ status }: { status: Briefing['status'] }) {
  return <span className={`${styles.badge} ${styles[status]}`}>{status}</span>;
}

function Triggered({ checks }: { checks: WatchlistCheck[] }) {
  const hit = checks.filter((w) => w.triggered === true);
  if (hit.length === 0) return null;
  return (
    <div className={styles.alert} data-testid="triggered">
      {hit.map((w, i) => (
        <div key={`${w.ticker}-${w.rule}-${i}`} className={styles.alertRow}>
          <span className={styles.alertHead}>⚠ {w.ticker} {money(w.price)} · {w.rule}</span>
          {w.action && <span className={styles.alertAction}>{w.action}</span>}
        </div>
      ))}
    </div>
  );
}

function Scoreboard({ o }: { o: NonNullable<Briefing['outcomes']> }) {
  const parts = [`지난 20거래일 ${o.n}개 중 ${o.positive}개 플러스`];
  if (o.median_pct != null) parts.push(`중앙값 ${signed(o.median_pct)}%`);
  if (o.best) parts.push(`최고 ${o.best.ticker} ${signed(o.best.return_pct)}%`);
  if (o.worst) parts.push(`최저 ${o.worst.ticker} ${signed(o.worst.return_pct)}%`);
  // Never omitted: a hit rate that quietly drops unpriceable rows is inflated.
  if (o.unresolved > 0) parts.push(`${o.unresolved}개 확인 못함`);
  return <p className={styles.scoreboard} data-testid="scoreboard">{parts.join(' · ')}</p>;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; latest: MarketLatest };

export function Market() {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [openEvidence, setOpenEvidence] = useState<string | null>(null);
  const [showDropped, setShowDropped] = useState(false);

  const load = useCallback(() => {
    let alive = true;
    setState({ phase: 'loading' });
    getMarketLatest()
      .then((latest) => { if (alive) setState({ phase: 'ready', latest }); })
      .catch(() => { if (alive) setState({ phase: 'error' }); });
    return () => { alive = false; };
  }, []);

  useEffect(() => load(), [load]);

  // A morning screen opened at 06:29 should not stay empty until a manual reload.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  if (state.phase === 'loading') {
    return <div className={styles.screen}><p className={styles.hint}>브리핑을 불러오는 중…</p></div>;
  }

  if (state.phase === 'error') {
    return (
      <div className={styles.screen}>
        <div className={styles.center}>
          <p className={styles.hint}>허브에 연결하지 못했습니다.</p>
          <button type="button" className={styles.retry} onClick={load}>다시 시도</button>
        </div>
      </div>
    );
  }

  const { latest } = state;

  // pending and missing must not read alike: one is "not yet", the other is
  // "the machine never reported", and only the hub can tell them apart.
  if (latest.state !== 'ready' || !latest.briefing) {
    const at = hhmmOf(latest.expected_at);
    return (
      <div className={styles.screen}>
        <div className={styles.center}>
          {latest.state === 'pending' ? (
            <>
              <p className={styles.hint}>오늘 브리핑은 아직 오지 않음</p>
              <p className={styles.sub}>{at}에 도착합니다.</p>
            </>
          ) : (
            <>
              <p className={`${styles.hint} ${styles.bad}`}>오늘 브리핑이 생성되지 않음</p>
              <p className={styles.sub}>{at}이 지났는데 아무것도 도착하지 않았습니다. 로그를 확인하세요.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const b = latest.briefing;

  return (
    <div className={styles.screen}>
      <div className={styles.scroll}>
        <div className={styles.head}>
          <h1 className={styles.date}>{headerFor(b.date)}</h1>
          <StatusBadge status={b.status} />
        </div>

        {b.status === 'degraded' && b.dropped.length > 0 && (
          <p className={styles.degradedNote}>
            후보 {b.dropped.length}건을 검증하지 못해 제외했습니다.
          </p>
        )}

        {/* A failed run is never rendered as an empty briefing. */}
        {b.status === 'failed' && (
          <div className={styles.failure}>
            <p className={styles.failureHead}>생성기가 실패했습니다 — 조용한 아침이 아닙니다.</p>
            <p className={styles.failureReason}>
              {b.failure_reason || '이유가 기록되지 않았습니다. journalctl -u market-briefing 을 확인하세요.'}
            </p>
          </div>
        )}

        <Triggered checks={b.watchlist_checks} />

        {b.script_ko.map((s, i) => (
          <section key={`${s.heading}-${i}`} className={styles.section}>
            <h2 className={styles.heading}>{s.heading}</h2>
            <p className={styles.prose}>{s.text}</p>
          </section>
        ))}

        {b.candidates.length > 0 && (
          <Group header="신규 후보">
            {b.candidates.map((c) => (
              <div key={c.ticker} className={styles.candidate}>
                <div className={styles.candHead}>
                  <span className={styles.ticker}>{c.ticker} ← {c.incumbent}</span>
                  <span className={styles.dim}>{DIMENSION_KO[c.dimension] ?? c.dimension}</span>
                </div>
                <p className={styles.nums}>
                  {GAP_IS_THE_CLAIM.has(c.dimension)
                    ? <>매출 성장률 갭 {signed(c.growth_gap_pp)}%p</>
                    : <><span className={styles.ref}>참고</span> 매출 성장률 갭 {signed(c.growth_gap_pp)}%p</>}
                  {' · '}희석 {signed(c.dilution_yoy_pct)}% · {money(c.price_at_surface)}
                </p>
                <p className={styles.thesis}>“{c.thesis}”</p>
                <button
                  type="button"
                  className={styles.disclosure}
                  onClick={() => setOpenEvidence((t) => (t === c.ticker ? null : c.ticker))}
                >
                  근거 {c.evidence.length}건 {openEvidence === c.ticker ? '⌄' : '›'}
                </button>
                {openEvidence === c.ticker && (
                  <ul className={styles.evidence}>
                    {c.evidence.map((e) => (
                      <li key={e.url}>
                        {/* The source must be reachable. A narrative claim nobody can
                            check is the exact thing this system exists to avoid. */}
                        <a href={e.url} target="_blank" rel="noopener noreferrer">{e.claim}</a>
                        <span className={styles.pubDate}>{e.published_at}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </Group>
        )}

        {b.watchlist_checks.length > 0 && (
          <Group header="워치리스트">
            {b.watchlist_checks.map((w, i) => (
              <Cell
                key={`${w.ticker}-${w.rule}-${i}`}
                title={<>{w.ticker} <span className={styles.mono}>{money(w.price)}</span></>}
                subtitle={
                  <>
                    <div className={styles.mono}>{w.rule ?? w.note ?? '규칙 없음'}</div>
                    {/* Two lines the Toss app cannot show: what the position cost
                        you, and what it cost the briefing that proposed it. Held
                        rows only — a `watching` entry has neither. */}
                    {w.position && (
                      <div className={styles.mono} data-testid={`position-${w.ticker}`}>
                        {w.position.quantity}주 · 평단 {money(w.position.avg_cost)} ·{' '}
                        <span className={lossy(w.position.pnl_rate)}>{pct(w.position.pnl_rate)}</span>
                      </div>
                    )}
                    {w.origin && (
                      <div className={styles.mono} data-testid={`origin-${w.ticker}`}>
                        {w.origin.surfaced_date ? `${headerFor(w.origin.surfaced_date)} 제안 ` : '제안 '}
                        {money(w.origin.price_at_surface)} 이후{' '}
                        <span className={lossy(w.origin.return_since_surface)}>
                          {pct(w.origin.return_since_surface)}
                        </span>
                      </div>
                    )}
                  </>
                }
                value={
                  <span className={w.triggered == null && w.rule != null ? styles.unknown : undefined}>
                    {triggerLabel(w)}
                  </span>
                }
              />
            ))}
          </Group>
        )}

        {b.dropped.length > 0 && (
          <>
            <button type="button" className={styles.disclosure} onClick={() => setShowDropped((v) => !v)}>
              검증 실패 {b.dropped.length}건 {showDropped ? '⌄' : '›'}
            </button>
            {showDropped && (
              <Group>
                {b.dropped.map((d, i) => (
                  <Cell key={`${d.ticker}-${i}`} title={d.ticker} value={<span className={styles.mono}>{d.reason}</span>} />
                ))}
              </Group>
            )}
          </>
        )}

        {b.outcomes && <Scoreboard o={b.outcomes} />}
      </div>
    </div>
  );
}
