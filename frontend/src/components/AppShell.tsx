import { type ReactNode, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getHealth } from '../lib/api';
import { titleForPath } from '../lib/tabs';
import { TabBar } from './TabBar';
import styles from './AppShell.module.css';

/** The viewport frame: a 100dvh grid of [header / scrollable content / tab bar].
    The CONTENT row owns scroll; the tab bar is pinned in-grid ABOVE the iOS home
    indicator via safe-area padding — this is the iPhone 16 Pro fix. */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [health, setHealth] = useState<{ ok: boolean; version?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    getHealth().then((h) => { if (alive) setHealth(h); });
    return () => { alive = false; };
  }, []);

  const chip = health
    ? health.ok ? `hub ● v${health.version ?? '?'}` : 'hub ○'
    : '—';

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.title}>{titleForPath(pathname)}</h1>
        <span className={`${styles.chip} mono`}>{chip}</span>
      </header>
      <main className={styles.content}>{children}</main>
      <TabBar />
    </div>
  );
}
