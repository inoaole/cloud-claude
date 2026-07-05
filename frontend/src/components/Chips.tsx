import styles from './Chips.module.css';

/** Shared horizontal-scroll quick-pick chip row (Agent starters / Shell commands / recents). */
export function Chips({ items, onPick, mono }: { items: string[]; onPick: (v: string) => void; mono?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.chips}>
      {items.map((c) => (
        <button
          key={c}
          type="button"
          className={`${styles.chip} ${mono ? styles.mono : ''}`}
          onMouseDown={(e) => e.preventDefault()} // keep the composer focused
          onClick={() => onPick(c)}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
