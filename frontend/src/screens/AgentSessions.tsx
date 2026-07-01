import { useCallback, useEffect, useState } from 'react';
import { createAgentSession, killAgentSession, listAgentSessions, type AgentSession } from '../lib/api';
import styles from './AgentSessions.module.css';

const relAge = (ms: number): string => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};

/** Agent session picker for a device: list + New + Kill (design D3). Opening one → onOpen(id). */
export function AgentSessions({ device, onOpen }: { device: string; onOpen: (id: string) => void }) {
  const [sessions, setSessions] = useState<AgentSession[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    listAgentSessions(device).then(setSessions).catch(() => setSessions([]));
  }, [device]);

  useEffect(() => refresh(), [refresh]);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try { onOpen((await createAgentSession(device)).id); }
    catch { setBusy(false); }
  };

  const kill = async (id: string) => {
    setSessions((prev) => prev?.filter((s) => s.id !== id) ?? null); // optimistic
    try { await killAgentSession(id); } finally { refresh(); }
  };

  return (
    <div className={styles.wrap}>
      <h2 className={styles.header}>Agent sessions</h2>
      <div className={styles.card}>
        {sessions?.map((s) => (
          <div key={s.id} className={styles.row}>
            <button type="button" className={styles.open} onClick={() => onOpen(s.id)}>
              <span className={`${styles.dot} ${styles[s.status] ?? styles.idle}`} />
              <span className={styles.title}>{s.title}</span>
              <span className={styles.age}>~{relAge(s.createdAt)}</span>
            </button>
            <button type="button" className={styles.kill} onClick={() => kill(s.id)} aria-label={`Kill ${s.title}`}>Kill</button>
          </div>
        ))}
        <button type="button" className={styles.new} onClick={create} disabled={busy}>+ New session</button>
      </div>
      {sessions?.length === 0 && <p className={styles.empty}>No sessions yet — start one to chat with claude on {device}.</p>}
    </div>
  );
}
