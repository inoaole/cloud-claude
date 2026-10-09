import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Group } from '../components/Group';
import { Cell } from '../components/Cell';
import { Segmented } from '../components/Segmented';
import { Stub } from '../components/Stub';
import { IconProjects } from '../components/icons';
import {
  getProject, getProjects,
  type Brief, type FeatureStatus, type HealthLevel, type JudgeStatus, type Person, type PlanData,
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
const FILLED: Record<Exclude<FeatureStatus, null>, number> = { unlinked: 0, todo: 0, pr: 2, done: 3 };
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

function Steps({ status }: { status: FeatureStatus }) {
  const filled = status === null ? 0 : FILLED[status];
  return (
    <span className={`${styles.steps} ${status === 'done' ? styles.stepsDone : ''}`} aria-hidden>
      {[0, 1, 2].map((i) => <i key={i} className={i < filled ? styles.on : ''} />)}
    </span>
  );
}

function Plan({ plan }: { plan: PlanData }) {
  if (plan.state !== 'ok') return <Group header="일정"><p className={styles.section}>{SECTION_TEXT[plan.state]}</p></Group>;
  const cur = plan.current;
  const done = cur ? cur.features.filter((f) => f.status === 'done').length : 0;
  return (
    <>
      <Group header="일정">
        <div className={styles.tl}><ProjectTimeline phases={plan.phases} milestones={plan.milestones} today={plan.today} /></div>
      </Group>
      {cur ? (
        <Group header={`${cur.id} · ${mmdd(cur.due)} · ${cur.goal} · ${done}/${cur.features.length}`}>
          {cur.features.map((f) => (
            <Cell
              key={f.name}
              leading={<span className={styles.who}>{f.owner}</span>}
              title={f.name}
              value={
                <span className={styles.fstate}>
                  <Steps status={f.status} />
                  <span className={f.status === 'todo' || f.status === 'unlinked' ? styles.strong : f.pr ? 'mono' : ''}>
                    {f.status === null ? '확인 불가' : f.status === 'pr' && f.pr ? f.pr : FEATURE[f.status]}
                  </span>
                </span>
              }
            />
          ))}
        </Group>
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
  const head = brief.state === 'ok' ? `팀 대화 · ${ago(brief.generatedAt)}` : '팀 대화';
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

      <Plan plan={d.plan} />

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
