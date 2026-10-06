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
  if (discord.state === 'unconfigured') {
    return <Group header="Discord"><p className={styles.section}>{SECTION_TEXT.unconfigured}</p></Group>;
  }
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
        {d.team.state !== 'ok' && (
          <p className={`${styles.section} ${d.team.state === 'error' ? styles.warn : ''}`}>{SECTION_TEXT[d.team.state]}</p>
        )}
        {d.ledger.state === 'error' && <p className={`${styles.section} ${styles.warn}`}>판정 기록을 읽지 못함</p>}
        {d.team.people.map((p) => <PersonRow key={p.name} p={p} github={d.github.state} />)}
      </Group>

      <Discord discord={d.discord} />
    </>
  );
}
