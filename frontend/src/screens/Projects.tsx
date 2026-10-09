import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Group } from '../components/Group';
import { Cell } from '../components/Cell';
import { Segmented } from '../components/Segmented';
import { Stub } from '../components/Stub';
import { IconProjects } from '../components/icons';
import {
  getProject, getProjects,
  type Brief, type FeatureStatus, type HealthLevel, type JudgeStatus, type Person, type PlanData, type PlanFeature,
  type ProjectDetailData, type ProjectException, type ProjectListItem, type SourceState, type TeamSummary, type TldrDay, type Verdict,
} from '../lib/api';
import { ProjectTimeline } from './ProjectTimeline';
import styles from './Projects.module.css';

const ICON: Record<JudgeStatus, string> = { pass: '✅', fail: '❌', hold: '⚠️', exempt: '⏸' };
const MODE: Record<Person['mode'], string> = { plan: 'plan', dev: 'dev', exempt: 'rest' };
// error and unconfigured must never read alike (DESIGN.md state language).
export const SECTION_TEXT: Record<Exclude<SourceState, 'ok'>, string> = {
  unconfigured: '연결된 소스 없음',
  error: '불러오지 못함',
};
// A stopped runner must not read as a quiet day (spec §4).
export const BRIEF_TEXT: Record<Exclude<SourceState, 'ok'>, string> = {
  unconfigured: '요약 준비 전',
  error: '요약이 갱신되지 않음',
};
const LEVEL: Record<HealthLevel, string> = { on: 'On track', risk: 'At risk', off: 'Off track', unknown: '판정 불가' };
const FEATURE: Record<Exclude<FeatureStatus, null>, string> = { done: '머지', pr: 'PR 열림', todo: '시작 안 함', unlinked: '이슈 없음' };
const VERDICT: Record<Verdict, string> = { ok: '괜찮음', check: '확인 필요', suspect: '딸깍 의심' };

const summaryText = (s: TeamSummary | null) => (s ? `${s.onTrack}/${s.judged} on track` : '판정 없음');
const dday = (n: number) => (n < 0 ? `D+${-n}` : n === 0 ? 'D-day' : `D-${n}`);
const mmdd = (d: string) => d.slice(5).replace('-', '/');

/** Always `~`: a cached snapshot or an LLM summary never gets to claim precision. */
export function ago(ts: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - Date.parse(ts)) / 60_000));
  if (m < 60) return `~${m}분 전`;
  const h = Math.round(m / 60);
  return h < 24 ? `~${h}시간 전` : `~${Math.round(h / 24)}일 전`;
}

const clock = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

export function useLoad<T>(fn: () => Promise<T>) {
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

export function useProject() {
  const { id = '' } = useParams();
  const fetchOne = useCallback(() => getProject(id), [id]);
  return { id, ...useLoad<ProjectDetailData>(fetchOne) };
}

export function Failed({ retry }: { retry: () => void }) {
  return (
    <div className={styles.center}>
      <p className={styles.hint}>Couldn't reach the hub.</p>
      <button type="button" className={styles.retry} onClick={retry}>Retry</button>
    </div>
  );
}

function HealthDot({ level }: { level: HealthLevel }) {
  return <span className={`${styles.dot} ${styles[level]}`} aria-label={LEVEL[level]} />;
}

export function VerdictBadge({ v }: { v: Verdict }) {
  return <span className={`${styles.badge} ${v === 'suspect' ? styles.sus : ''}`}>~{VERDICT[v]}</span>;
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
          leading={<HealthDot level={p.state === 'ok' ? p.health.level : 'unknown'} />}
          title={p.name}
          subtitle={p.state !== 'ok' ? SECTION_TEXT[p.state] : (
            <>
              {LEVEL[p.health.level]}
              {p.currentId && p.daysLeft !== null && <> · <span className="mono">{p.currentId}</span> {dday(p.daysLeft)}</>}
              {p.exceptionCount > 0 && <> · 확인 필요 {p.exceptionCount}</>}
            </>
          )}
          onClick={() => navigate(`/projects/${p.id}`)}
        />
      ))}
    </Group>
  );
}

// What a leader should see first in "남음": can't-tell, then not started, then waiting on review.
const RANK: Record<string, number> = { null: 0, todo: 1, unlinked: 1, pr: 2 };
const leftText = (f: PlanFeature) => (f.status === 'pr' && f.pr ? `${f.pr} PR` : `${f.name} ${f.status === null ? '확인 불가' : FEATURE[f.status]}`);

function Plan({ plan, people }: { plan: PlanData; people: string[] }) {
  if (plan.state !== 'ok') return <Group header="일정"><p className={styles.section}>{SECTION_TEXT[plan.state]}</p></Group>;
  const cur = plan.current;
  const merged = cur ? cur.features.filter((f) => f.status === 'done') : [];
  // Issues are commit-sized, so one row per issue is a todo list, not a PM view: one row per owner.
  const owners = cur ? [...new Set(cur.features.map((f) => f.owner || '담당 없음'))] : [];
  const idle = people.filter((p) => !owners.includes(p));
  return (
    <>
      <Group header="일정">
        <div className={styles.tl}><ProjectTimeline phases={plan.phases} milestones={plan.milestones} today={plan.today} /></div>
      </Group>
      {cur ? (
        <>
          <Group header={`${cur.id} · ${mmdd(cur.due)} · ${cur.goal} · ${merged.length}/${cur.features.length}`}>
            {owners.map((o) => {
              const mine = cur.features.filter((f) => (f.owner || '담당 없음') === o);
              const done = mine.filter((f) => f.status === 'done').length;
              const left = mine.filter((f) => f.status !== 'done').sort((a, b) => RANK[String(a.status)] - RANK[String(b.status)]);
              return (
                <Cell
                  key={o}
                  leading={<span className={styles.who}>{o}</span>}
                  title={<progress className={styles.bar} value={done} max={mine.length} aria-label={`${o} ${done}/${mine.length}`} />}
                  subtitle={left.length
                    ? `남음 ${left.slice(0, 3).map(leftText).join(' · ')}${left.length > 3 ? ` 외 ${left.length - 3}개` : ''}`
                    : '모두 머지'}
                  value={<span className="mono">{done}/{mine.length}</span>}
                />
              );
            })}
            {idle.map((p) => (
              <Cell key={p} leading={<span className={styles.who}>{p}</span>} title={<span className={styles.quiet}>이 버전 담당 없음</span>} />
            ))}
          </Group>
          {merged.length > 0 && (
            <details className={styles.past}>
              <summary>머지된 {merged.length}개</summary>
              <Group>{merged.map((f, i) => <Cell key={i} leading={<span className={styles.who}>{f.owner}</span>} title={f.name} />)}</Group>
            </details>
          )}
        </>
      ) : <Group header="이번 버전"><p className={styles.section}>모든 버전 완료</p></Group>}
    </>
  );
}

function ExceptionRow({ e, id }: { e: ProjectException; id: string }) {
  if (e.kind === 'review') {
    return (
      <div className={styles.ex}>
        <div className={styles.exHead}><Link to={`/projects/${id}/prs`} className="mono">{e.label}</Link><VerdictBadge v={e.verdict} /></div>
        <div className={styles.exBody}>{e.text}</div>
        {e.question && <div className={styles.ask}><span>물어볼 것</span><p className={styles.q}>{e.question}</p></div>}
      </div>
    );
  }
  return (
    <div className={styles.ex}>
      <div className={styles.exHead}><span>{e.who}</span></div>
      <div className={styles.exBody}>{e.text}</div>
    </div>
  );
}

export function TldrLines({ day }: { day: TldrDay }) {
  return (
    <>
      {day.items.map((it, i) => (
        <div key={i} className={styles.ln}><span className={styles.k}>{it.kind}</span><span>{it.text}</span></div>
      ))}
    </>
  );
}

function TalkCard({ brief, id, raw }: { brief: Brief; id: string; raw: number }) {
  const navigate = useNavigate();
  const day = brief.state === 'ok' ? brief.tldr[0]?.day : undefined;
  const head = brief.state === 'ok' ? `팀 대화 · ${day ? `${mmdd(day)} · ` : ''}${ago(brief.generatedAt)}` : '팀 대화';
  return (
    <Group header={head}>
      {brief.state !== 'ok' && <p className={`${styles.section} ${brief.state === 'error' ? styles.warn : ''}`}>{BRIEF_TEXT[brief.state]}</p>}
      {brief.state === 'ok' && (brief.tldr[0] ? <TldrLines day={brief.tldr[0]} /> : <p className={styles.section}>요약할 대화 없음</p>)}
      <Cell title={<span className={styles.link}>원문 {raw}개</span>} onClick={() => navigate(`/projects/${id}/chat`)} />
    </Group>
  );
}

export function PersonRow({ p, github }: { p: Person; github: SourceState }) {
  let prs;
  if (p.mode === 'exempt') prs = <span className={styles.quiet}>휴식 중</span>;
  else if (p.prs === null) prs = <span className={styles.warn}>{!p.github ? 'GitHub 아이디 없음' : github === 'unconfigured' ? 'GitHub 연결 안 됨' : 'PR 확인 불가'}</span>;
  else if (p.prs.length === 0) prs = <span className={styles.quiet}>이번 주 PR 없음</span>;
  else prs = <span className="mono">{p.prs.map((x) => x.label).join(' · ')}</span>;
  return (
    <Cell
      title={<>{p.name} <span className={`mono ${styles.mode}`}>{MODE[p.mode]}</span></>}
      subtitle={prs}
      value={<span className={styles.history}>{p.history.map((h) => <span key={h.week} title={`${h.week} ${h.reason}`}>{ICON[h.status] ?? '?'}</span>)}</span>}
    />
  );
}

export function ProjectDetail() {
  const navigate = useNavigate();
  const { id, state, load } = useProject();

  if (state.phase === 'loading') return <p className={styles.hint}>Loading…</p>;
  if (state.phase === 'error') return <Failed retry={load} />;
  const d = state.data;
  const raw = d.discord.channels.reduce((n, c) => n + c.messages.length, 0);
  const reviews = d.brief.state === 'ok' ? d.brief.reviews.length : 0;
  return (
    <>
      <button type="button" className={styles.back} onClick={() => navigate('/projects')}>‹ Projects</button>
      <h2 className={styles.name}>{d.name}</h2>

      <div className={styles.health}>
        <HealthDot level={d.health.level} />
        <div><div className={styles.level}>{LEVEL[d.health.level]}</div><div className={styles.why}>{d.health.why}</div></div>
      </div>

      <Plan plan={d.plan} people={d.team.people.map((p) => p.name)} />

      {d.exceptions.length > 0 && (
        <Group header={`확인 필요 · ${d.exceptions.length}`}>
          {d.exceptions.map((e, i) => <ExceptionRow key={i} e={e} id={id} />)}
        </Group>
      )}

      <TalkCard brief={d.brief} id={id} raw={raw} />

      <Group>
        <Cell title="이번 주 PR 판정" value={reviews ? <span className="mono">{reviews}</span> : undefined} onClick={() => navigate(`/projects/${id}/prs`)} />
      </Group>

      <details className={styles.past}>
        <summary>지난 판정 · {summaryText(d.team.summary)}</summary>
        <Group>
          {d.team.state !== 'ok' && <p className={styles.section}>{SECTION_TEXT[d.team.state]}</p>}
          {d.team.people.map((p) => <PersonRow key={p.name} p={p} github={d.github.state} />)}
        </Group>
      </details>
    </>
  );
}

export function Discord({ discord }: { discord: ProjectDetailData['discord'] }) {
  const [sel, setSel] = useState(discord.channels[0]?.id ?? '');
  if (discord.state === 'unconfigured') return <Group><p className={styles.section}>{SECTION_TEXT.unconfigured}</p></Group>;
  const ch = discord.channels.find((c) => c.id === sel) ?? discord.channels[0];
  return (
    <>
      {discord.channels.length > 1 && (
        <div className={styles.seg}>
          <Segmented options={discord.channels.map((c) => ({ value: c.id, label: c.name }))} value={ch.id} onChange={setSel} />
        </div>
      )}
      <Group>
        {ch.state === 'error' && <p className={`${styles.section} ${styles.warn}`}>{SECTION_TEXT.error}</p>}
        {ch.state === 'ok' && ch.messages.length === 0 && <p className={styles.section}>메시지 없음</p>}
        {ch.messages.map((m) => (
          <div key={m.id} className={styles.msg}>
            <div className={styles.msgHead}><span>{m.author}</span><span className={`mono ${styles.quiet}`}>{clock.format(new Date(m.ts))}</span></div>
            {m.content && <p className={styles.msgBody}>{m.content}</p>}
            {m.attachments > 0 && <span className={`mono ${styles.chip}`}>📎 {m.attachments}</span>}
          </div>
        ))}
      </Group>
    </>
  );
}

export function ProjectPrs() {
  const navigate = useNavigate();
  const { id, state, load } = useProject();
  const [tab, setTab] = useState<'flag' | 'ok'>('flag');

  if (state.phase === 'loading') return <p className={styles.hint}>Loading…</p>;
  if (state.phase === 'error') return <Failed retry={load} />;
  const b = state.data.brief;
  const back = <button type="button" className={styles.back} onClick={() => navigate(`/projects/${id}`)}>‹ {state.data.name}</button>;
  if (b.state !== 'ok') return <>{back}<h2 className={styles.name}>이번 주 PR</h2><Group><p className={styles.section}>{BRIEF_TEXT[b.state]}</p></Group></>;
  const flagged = b.reviews.filter((r) => r.verdict !== 'ok');
  const fine = b.reviews.filter((r) => r.verdict === 'ok');
  const shown = tab === 'flag' ? flagged : fine;
  return (
    <>
      {back}
      <h2 className={styles.name}>이번 주 PR</h2>
      <div className={styles.seg}>
        <Segmented options={[{ value: 'flag', label: `확인 필요 ${flagged.length}` }, { value: 'ok', label: `괜찮음 ${fine.length}` }]} value={tab} onChange={setTab} />
      </div>
      {b.pending.length > 0 && <Group><p className={styles.section}>판정 대기 · {b.pending.map((x) => x.label).join(' · ')}</p></Group>}
      {shown.length === 0 && <Group><p className={styles.section}>{tab === 'flag' ? '확인할 PR 없음' : 'PR 없음'}</p></Group>}
      {shown.map((r) => (
        <Group key={r.key} header={`${r.label} · ${r.author} · ${ago(b.generatedAt)}`}>
          <div className={styles.ex}>
            <div className={styles.exHead}><span>{r.title}</span><VerdictBadge v={r.verdict} /></div>
          </div>
          {r.signals.map((s) => (
            <div key={s.kind} className={styles.sig}>
              <span className={`${styles.mark} ${s.ok ? '' : styles.strong}`}>{s.ok ? '✓' : '!'}</span>
              <div>{s.kind}<div className={styles.sigDetail}>{s.detail}</div></div>
            </div>
          ))}
          {r.question && <div className={styles.ex}><div className={styles.ask}><span>리뷰에서 물어볼 것</span><p className={styles.q}>"{r.question}"</p></div></div>}
          <Cell title={<span className={styles.link}>GitHub에서 열기</span>} onClick={() => window.open(r.url, '_blank', 'noreferrer')} />
        </Group>
      ))}
    </>
  );
}

export function ProjectChat() {
  const navigate = useNavigate();
  const { id, state, load } = useProject();
  const [tab, setTab] = useState<'sum' | 'raw'>('sum');

  if (state.phase === 'loading') return <p className={styles.hint}>Loading…</p>;
  if (state.phase === 'error') return <Failed retry={load} />;
  const d = state.data;
  const b = d.brief;
  return (
    <>
      <button type="button" className={styles.back} onClick={() => navigate(`/projects/${id}`)}>‹ {d.name}</button>
      <h2 className={styles.name}>팀 대화</h2>
      <div className={styles.seg}>
        <Segmented options={[{ value: 'sum', label: '요약' }, { value: 'raw', label: '원문' }]} value={tab} onChange={setTab} />
      </div>
      {tab === 'raw' && <Discord discord={d.discord} />}
      {tab === 'sum' && b.state !== 'ok' && <Group><p className={styles.section}>{BRIEF_TEXT[b.state]}</p></Group>}
      {tab === 'sum' && b.state === 'ok' && b.tldr.length === 0 && <Group><p className={styles.section}>요약할 대화 없음</p></Group>}
      {tab === 'sum' && b.state === 'ok' && b.tldr.map((day) => (
        <Group key={day.day} header={`${mmdd(day.day)} · ${day.count}개 → ${day.items.length}줄 · ${ago(b.generatedAt)}`}>
          <TldrLines day={day} />
        </Group>
      ))}
    </>
  );
}
