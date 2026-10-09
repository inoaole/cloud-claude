import type { Milestone, Phase } from '../lib/api';
import styles from './Projects.module.css';

const W = 330;
const L = 8;
const R = 322;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** One inline SVG: phase bands, a today line, version diamonds. No chart library — six bands and six diamonds. */
export function ProjectTimeline({ phases, milestones, today }: { phases: Phase[]; milestones: Milestone[]; today: string }) {
  const days = [...phases.flatMap((p) => [t(p.start), t(p.end)]), ...milestones.map((m) => t(m.due))];
  const start = Math.min(...days);
  const end = Math.max(...days);
  // Clamp so "today" before the plan or after launch still sits on the strip, not off-canvas.
  const x = (d: string) => L + ((Math.min(Math.max(t(d), start), end) - start) / Math.max(end - start, 1)) * (R - L);
  const tx = x(today);
  return (
    <svg viewBox={`0 0 ${W} 74`} className={styles.timeline} role="img" aria-label={`일정 타임라인, 오늘 ${today}`}>
      {phases.map((p) => (
        <g key={p.name + p.start}>
          <rect x={x(p.start)} y={22} width={Math.max(x(p.end) - x(p.start), 2)} height={8} rx={2} className={p.rest ? styles.tlRest : styles.tlPhase} />
          <text x={(x(p.start) + x(p.end)) / 2} y={16} className={styles.tlLabel}>{p.name}</text>
        </g>
      ))}
      <line x1={tx} x2={tx} y1={6} y2={44} className={styles.tlToday} />
      <text x={Math.min(tx + 2, R - 14)} y={7} className={styles.tlTodayLabel}>오늘</text>
      {milestones.map((m) => {
        const mx = x(m.due);
        const cls = m.done ? styles.msDone : m.due < today ? styles.msLate : styles.msTodo;
        return (
          <g key={m.id}>
            <path d={`M${mx} 46 l4 4 -4 4 -4 -4z`} className={cls} />
            <text x={mx} y={66} className={styles.tlLabel}>{m.id}</text>
          </g>
        );
      })}
    </svg>
  );
}
