import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Terminal as Xterm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getPtyToken } from '../lib/api';
import styles from './Terminal.module.css';

type Conn = 'connecting' | 'connected' | 'closed' | 'error';

const STATUS_LABEL: Record<Conn, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  closed: 'Disconnected',
  error: "Couldn't connect",
};

/** Full-screen terminal: phone ⟷ hub ⟷ ssh ⟷ tmux. Client→server = JSON control frames;
    server→client = raw pty bytes. Rendered outside AppShell (no tab bar) for max height. */
export function Terminal() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const label = (useLocation().state as { label?: string } | null)?.label ?? id;
  const mountRef = useRef<HTMLDivElement>(null);
  const [conn, setConn] = useState<Conn>('connecting');

  useEffect(() => {
    if (!mountRef.current) return;
    let disposed = false;
    const term = new Xterm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
      theme: { background: '#000000', foreground: '#e6e6e6', cursor: '#0a84ff' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(mountRef.current);
    fit.fit();

    let ws: WebSocket | null = null;

    const sendResize = () => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };
    const onResize = () => { try { fit.fit(); sendResize(); } catch { /* not attached yet */ } };
    window.addEventListener('resize', onResize);

    (async () => {
      let token: string;
      try {
        token = await getPtyToken();
      } catch {
        if (!disposed) setConn('error');
        return;
      }
      if (disposed) return;

      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${scheme}://${window.location.host}/pty?device=${encodeURIComponent(id)}&token=${token}`);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => { setConn('connected'); sendResize(); term.focus(); };
      ws.onmessage = (ev) => {
        term.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data as ArrayBuffer));
      };
      ws.onclose = () => { if (!disposed) setConn((c) => (c === 'error' ? c : 'closed')); };
      ws.onerror = () => { if (!disposed) setConn('error'); };

      term.onData((data) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stdin', data }));
      });
    })();

    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      try { ws?.close(); } catch { /* noop */ }
      term.dispose();
    };
  }, [id]);

  return (
    <div className={styles.screen}>
      <header className={styles.bar}>
        <button type="button" className={styles.back} onClick={() => navigate('/machines')} aria-label="Back">‹ Machines</button>
        <span className={styles.title}>{label}</span>
        <span className={`${styles.status} ${styles[conn]}`}>{STATUS_LABEL[conn]}</span>
      </header>
      <div className={styles.term} ref={mountRef} />
    </div>
  );
}
