import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Segmented } from '../components/Segmented';
import { AgentChat } from './AgentChat';
import { AgentSessions } from './AgentSessions';
import { CommandChat } from './CommandChat';
import { Terminal } from './Terminal';
import styles from './DeviceConsole.module.css';

export type Conn = 'connecting' | 'connected' | 'closed' | 'error';
type Mode = 'agent' | 'chat' | 'terminal';

const STATUS: Record<Conn, string> = {
  connecting: 'Connecting…', connected: 'Connected', closed: 'Disconnected', error: "Couldn't connect",
};

/** Machines detail: pick a mode (DESIGN.md segmented control) and drive the device.
    Chat = command blocks (/run); Terminal = raw live pty (/pty). Full-screen (no tab bar). */
export function DeviceConsole() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const label = (useLocation().state as { label?: string } | null)?.label ?? id;
  const screenRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('agent');
  const [conn, setConn] = useState<Conn>('connecting');
  const [agentSessionId, setAgentSessionId] = useState<string | null>(null);

  // Reset status when switching modes (each mode opens its own connection).
  useEffect(() => setConn('connecting'), [mode]);

  // Pin the screen to the visual viewport so the composer sits above the iOS keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    const apply = () => { if (vv && screenRef.current) screenRef.current.style.setProperty('--vvh', `${vv.height}px`); };
    vv?.addEventListener('resize', apply);
    vv?.addEventListener('scroll', apply);
    apply();
    return () => { vv?.removeEventListener('resize', apply); vv?.removeEventListener('scroll', apply); };
  }, []);

  return (
    <div className={styles.screen} ref={screenRef}>
      <header className={styles.bar}>
        <button
          type="button"
          className={styles.back}
          aria-label="Back"
          onClick={() => { if (mode === 'agent' && agentSessionId) setAgentSessionId(null); else navigate('/machines'); }}
        >‹</button>
        <div className={styles.mid}>
          <span className={styles.title}>{label}</span>
          <span className={`${styles.status} ${styles[conn]}`}>{STATUS[conn]}</span>
        </div>
        <Segmented
          options={[{ value: 'agent', label: 'Agent' }, { value: 'chat', label: 'Shell' }, { value: 'terminal', label: 'Terminal' }]}
          value={mode}
          onChange={(m) => setMode(m as Mode)}
        />
      </header>

      <div className={styles.body}>
        {mode === 'agent' && (agentSessionId
          ? <AgentChat key={`agent-${agentSessionId}`} id={id} sessionId={agentSessionId} label={label} onStatus={setConn} />
          : <AgentSessions device={id} onOpen={setAgentSessionId} />)}
        {mode === 'chat' && <CommandChat key={`chat-${id}`} id={id} label={label} onStatus={setConn} />}
        {mode === 'terminal' && <Terminal key={`term-${id}`} id={id} onStatus={setConn} />}
      </div>
    </div>
  );
}
