import type { ReactNode } from 'react';
import styles from './Group.module.css';

/** iOS HIG grouped-list section: optional header + a rounded, hairline-divided card. */
export function Group({ header, children }: { header?: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      {header && <h2 className={styles.header}>{header}</h2>}
      <div className={styles.card}>{children}</div>
    </section>
  );
}
