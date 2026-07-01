import type { ReactNode } from 'react';
import { IconChevron } from './icons';
import styles from './Cell.module.css';

interface CellProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Trailing value shown before the chevron (e.g. a status). */
  value?: ReactNode;
  /** Show the disclosure chevron (default true when onClick given). */
  disclosure?: boolean;
  onClick?: () => void;
}

/** iOS HIG grouped-list row. One component owns the trailing-edge chevron so
    disclosure is consistent everywhere (design-review). Render inside <Group>. */
export function Cell({ title, subtitle, value, disclosure, onClick }: CellProps) {
  const showChevron = disclosure ?? Boolean(onClick);
  const interactive = Boolean(onClick);
  return (
    <div
      className={`${styles.cell} ${interactive ? styles.interactive : ''}`}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); } : undefined}
    >
      <div className={styles.text}>
        <div className={styles.title}>{title}</div>
        {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
      </div>
      {value != null && <div className={styles.value}>{value}</div>}
      {showChevron && <IconChevron className={styles.chevron} />}
    </div>
  );
}
