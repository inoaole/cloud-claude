import { useCallback, useEffect, useRef, useState } from 'react';
import { getPtyToken } from '../lib/api';
import { Composer } from '../components/Composer';
import { Chips } from '../components/Chips';
import type { Conn } from './DeviceConsole';
import styles from './CommandChat.module.css';

interface Block {
  id: string;
  cmd: string;
  out: string;
  status: 'running' | 'done';
  exit?: number;
  started: number;
  ended?: number;
}

const PRESETS = ['ls -la', 'git status', 'pwd', 'tmux ls', 'df -h'];
const RECENTS_KEY = 'cc:chat:recents';
// Strip ANSI/CSI so output renders as clean text (most tools skip color off a tty anyway).
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
const rid = () => Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, '') || 'x';

function loadRecents(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
    return Array.isArray(v) ? v.slice(0, 6) : [];
  } catch { return []; }
}

/** Chat mode body — command-block console over /run. Each command = one block + exit code. */
export function CommandChat({ id, label, onStatus }: { id: string; label: string; onStatus: (c: Conn) => void }) {
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [input, setInput] = useState('');
  const [recents, setRecents] = useState<string[]>(loadRecents);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    (async () => {
      let token: string;
      try { token = await getPtyToken(); } catch { if (!disposed) onStatus('error'); return; }
      if (disposed) return;
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${scheme}://${window.location.host}/run?device=${encodeURIComponent(id)}&token=${token}`);
      wsRef.current = ws;
      ws.onopen = () => { onStatus('connected'); setReady(true); };
      ws.onmessage = (ev) => {
        let m: { type: string; id: string; data?: string; exit?: number };
        try { m = JSON.parse(ev.data); } catch { return; }
        setBlocks((prev) => prev.map((b) => {
          if (b.id !== m.id) return b;
          if (m.type === 'out') return { ...b, out: b.out + stripAnsi(m.data ?? '') };
          if (m.type === 'done') return { ...b, status: 'done', exit: m.exit, ended: Date.now() };
          return b;
        }));
      };
      ws.onclose = () => { if (!disposed) { setReady(false); onStatus('closed'); } };
      ws.onerror = () => { if (!disposed) onStatus('error'); };
    })();
    return () => { disposed = true; try { wsRef.current?.close(); } catch { /* noop */ } };
  }, [id, onStatus]);

  // Keep the transcript pinned to the newest output.
  useEffect(() => { scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight }); }, [blocks]);

  const run = useCallback((cmd: string) => {
    const trimmed = cmd.trim();
    const ws = wsRef.current;
    if (!trimmed || ws?.readyState !== WebSocket.OPEN) return;
    const bid = rid();
    setBlocks((prev) => [...prev, { id: bid, cmd: trimmed, out: '', status: 'running', started: Date.now() }]);
    ws.send(JSON.stringify({ type: 'run', id: bid, cmd: trimmed }));
    setRecents((prev) => {
      const next = [trimmed, ...prev.filter((c) => c !== trimmed)].slice(0, 6);
      try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const chips = [...recents, ...PRESETS.filter((p) => !recents.includes(p))];

  return (
    <div className={styles.chat}>
      <div className={styles.transcript} ref={scrollRef}>
        {blocks.length === 0 && (
          <p className={styles.empty}>Connected to {label}. Type a command to run it on this machine.</p>
        )}
        {blocks.map((b) => (
          <div key={b.id} className={styles.block}>
            <button type="button" className={styles.cmd} onClick={() => { setInput(b.cmd); inputRef.current?.focus(); }}>
              <span className={styles.prompt}>$</span> {b.cmd}
            </button>
            {b.out && <pre className={styles.out}>{b.out.replace(/\n$/, '')}</pre>}
            <div className={styles.meta}>
              {b.status === 'running'
                ? <span className={styles.running}>running…</span>
                : (
                  <>
                    <span className={b.exit ? styles.fail : styles.ok}>{b.exit ? `✗ ${b.exit}` : '✓'}</span>
                    {b.ended && <span className={styles.dur}>~{((b.ended - b.started) / 1000).toFixed(1)}s</span>}
                  </>
                )}
            </div>
          </div>
        ))}
      </div>

      <Chips items={chips} onPick={run} mono />

      <Composer
        value={input} onChange={setInput}
        onSubmit={() => { run(input); setInput(''); }}
        ready={ready} placeholder={ready ? 'Type a command…' : 'Connecting…'}
        ariaLabel="Command" sendLabel="Run" inputRef={inputRef}
      />
    </div>
  );
}
