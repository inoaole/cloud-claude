import type { ComponentType, SVGProps } from 'react';
import styles from './Stub.module.css';

/** Honest-quiet placeholder for a screen whose content ships in a later sprint.
    NOT a bare "No items" — it names what's coming so the empty state reads as
    intentional (design-review). */
export function Stub({ icon: Icon, title, note }: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  note: string;
}) {
  return (
    <div className={styles.stub}>
      <Icon className={styles.mark} />
      <p className={styles.title}>{title}</p>
      <p className={styles.note}>{note}</p>
    </div>
  );
}
