import { useEffect, useRef } from 'react';
import { Terminal as Xterm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getPtyToken } from '../lib/api';
import type { Conn } from './DeviceConsole';
import styles from './Terminal.module.css';

/** Terminal mode body — raw live pty over /pty (tmux). Header lives in DeviceConsole. */
export function Terminal({ id, onStatus }: { id: string; onStatus: (c: Conn) => void }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    let disposed = false;
    const term = new Xterm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
      theme: { background: '#000000', foreground: '#e6e6e6', cursor: '#0066cc' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(mountRef.current);
    fit.fit();

    let ws: WebSocket | null = null;
    const sendResize = () => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    const onResize = () => { try { fit.fit(); sendResize(); } catch { /* not ready */ } };
    window.visualViewport?.addEventListener('resize', onResize);
    window.addEventListener('resize', onResize);

    (async () => {
      let token: string;
      try { token = await getPtyToken(); } catch { if (!disposed) onStatus('error'); return; }
      if (disposed) return;
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${scheme}://${window.location.host}/pty?device=${encodeURIComponent(id)}&token=${token}`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { onStatus('connected'); sendResize(); term.focus(); };
      ws.onmessage = (ev) => term.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data as ArrayBuffer));
      ws.onclose = () => { if (!disposed) onStatus('closed'); };
      ws.onerror = () => { if (!disposed) onStatus('error'); };
    })();

    return () => {
      disposed = true;
      window.visualViewport?.removeEventListener('resize', onResize);
      window.removeEventListener('resize', onResize);
      try { ws?.close(); } catch { /* noop */ }
      term.dispose();
    };
  }, [id, onStatus]);

  return <div className={styles.term} ref={mountRef} />;
}
