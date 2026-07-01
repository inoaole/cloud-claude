import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createAgentSession, getPtyToken } from '../lib/api';
import { Composer } from '../components/Composer';
import { Chips } from '../components/Chips';
import type { Conn } from './DeviceConsole';
import styles from './AgentChat.module.css';

// ── Turn-group model (design-review D5 + codex #1) ────────────────────────────
// Each user prompt = a Turn: the prompt + ordered blocks (assistant text / tool chips) +
// a status + a work summary. A turn's events target the LAST turn (the active one).
type ToolStatus = 'running' | 'done' | 'failed';
type Block =
  | { kind: 'assistant'; text: string; streaming: boolean }
  | { kind: 'tool'; id: string; name: string; input: Record<string, unknown>; status: ToolStatus; output: string; expanded: boolean };
interface Turn {
  id: string; prompt: string; blocks: Block[];
  status: 'running' | 'done' | 'stopped' | 'failed';
  startedAt: number; endedAt?: number; ms?: number | null; errorText?: string;
}

type Action =
  | { type: 'START'; id: string; prompt: string; now: number }
  | { type: 'DELTA'; text: string }
  | { type: 'ASSISTANT'; text: string }
  | { type: 'TOOL_USE'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'TOOL_RESULT'; id: string; ok: boolean; output: string }
  | { type: 'CLOSE'; ok: boolean; ms: number | null; now: number; text?: string | null }
  | { type: 'STOP' }
  | { type: 'TOGGLE'; turnId: string; toolId: string };

const closeStreaming = (blocks: Block[]): Block[] =>
  blocks.map((b) => (b.kind === 'assistant' && b.streaming ? { ...b, streaming: false } : b));

function reducer(turns: Turn[], a: Action): Turn[] {
  const lastIdx = turns.length - 1;
  const upd = (fn: (t: Turn) => Turn) => turns.map((t, i) => (i === lastIdx ? fn(t) : t));
  switch (a.type) {
    case 'START':
      return [...turns, { id: a.id, prompt: a.prompt, blocks: [], status: 'running', startedAt: a.now }];
    case 'DELTA':
      return upd((t) => {
        const last = t.blocks[t.blocks.length - 1];
        if (last?.kind === 'assistant' && last.streaming) {
          return { ...t, blocks: [...t.blocks.slice(0, -1), { ...last, text: last.text + a.text }] };
        }
        return { ...t, blocks: [...t.blocks, { kind: 'assistant', text: a.text, streaming: true }] };
      });
    case 'ASSISTANT':
      return upd((t) => {
        const last = t.blocks[t.blocks.length - 1];
        if (last?.kind === 'assistant' && last.streaming) {
          return { ...t, blocks: [...t.blocks.slice(0, -1), { ...last, text: a.text, streaming: false }] };
        }
        return a.text ? { ...t, blocks: [...t.blocks, { kind: 'assistant', text: a.text, streaming: false }] } : t;
      });
    case 'TOOL_USE':
      return upd((t) => ({
        ...t,
        blocks: [...closeStreaming(t.blocks), { kind: 'tool', id: a.id, name: a.name, input: a.input, status: 'running', output: '', expanded: false }],
      }));
    case 'TOOL_RESULT':
      return upd((t) => ({
        ...t,
        blocks: t.blocks.map((b) => (b.kind === 'tool' && b.id === a.id ? { ...b, status: a.ok ? 'done' : 'failed', output: a.output } : b)),
      }));
    case 'CLOSE':
      return upd((t) => ({
        ...t,
        status: t.status === 'stopped' ? 'stopped' : (a.ok ? 'done' : 'failed'),
        ms: a.ms, endedAt: a.now, blocks: closeStreaming(t.blocks),
        errorText: a.ok ? undefined : (a.text || 'The turn failed. If this device just started, claude may need re-authentication.'),
      }));
    case 'STOP':
      return upd((t) => (t.status === 'running' ? { ...t, status: 'stopped' } : t));
    case 'TOGGLE':
      return turns.map((t) => (t.id !== a.turnId ? t : {
        ...t, blocks: t.blocks.map((b) => (b.kind === 'tool' && b.id === a.toolId ? { ...b, expanded: !b.expanded } : b)),
      }));
    default:
      return turns;
  }
}

// ── Tool presentation ─────────────────────────────────────────────────────────
const EDIT = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const READ = /^(Read|Glob|Grep|LS)$/;
function toolCategory(name: string): 'edit' | 'run' | 'read' | 'other' {
  if (EDIT.test(name)) return 'edit';
  if (name === 'Bash') return 'run';
  if (READ.test(name)) return 'read';
  return 'other';
}
function toolTarget(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash') return String(input.command ?? '');
  const path = input.file_path ?? input.path ?? input.pattern;
  if (typeof path === 'string') return path.split('/').pop() || path;
  const first = Object.values(input)[0];
  return typeof first === 'string' ? first : '';
}
function summarize(blocks: Block[]) {
  let edited = 0, ran = 0, read = 0, failed = 0;
  for (const b of blocks) {
    if (b.kind !== 'tool') continue;
    if (b.status === 'failed') failed += 1;
    const cat = toolCategory(b.name);
    if (cat === 'edit') edited += 1; else if (cat === 'run') ran += 1; else if (cat === 'read') read += 1;
  }
  const parts = [];
  if (edited) parts.push(`Edited ${edited}`);
  if (ran) parts.push(`Ran ${ran}`);
  if (read) parts.push(`Read ${read}`);
  if (failed) parts.push(`Failed ${failed}`);
  return parts.join(' · ');
}

const rid = () => Math.random().toString(36).slice(2, 10);
const STARTERS = ['explain this repo', 'run the tests', 'what changed recently?', 'fix the failing test'];

/** Agent mode body — chat with claude on the device, over /agent. */
export function AgentChat({ id, label, onStatus }: { id: string; label: string; onStatus: (c: Conn) => void }) {
  const [turns, dispatch] = useReducer(reducer, []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const connectRef = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let sessionId: string | null = null;

    const connect = async () => {
      onStatus('connecting'); setReady(false);
      try {
        if (!sessionId) sessionId = (await createAgentSession(id)).id;
        const token = await getPtyToken();
        if (disposed) return;
        const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${scheme}://${window.location.host}/agent?device=${encodeURIComponent(id)}&session=${sessionId}&token=${token}`);
        wsRef.current = ws;
        ws.onopen = () => { onStatus('connected'); setReady(true); };
        ws.onmessage = (ev) => {
          let m: { type: string; [k: string]: unknown };
          try { m = JSON.parse(ev.data); } catch { return; }
          switch (m.type) {
            case 'assistant_delta': dispatch({ type: 'DELTA', text: String(m.text ?? '') }); break;
            case 'assistant': dispatch({ type: 'ASSISTANT', text: String(m.text ?? '') }); break;
            case 'tool_use': dispatch({ type: 'TOOL_USE', id: String(m.id), name: String(m.name), input: (m.input as Record<string, unknown>) ?? {} }); break;
            case 'tool_result': dispatch({ type: 'TOOL_RESULT', id: String(m.id), ok: Boolean(m.ok), output: String(m.output ?? '') }); break;
            case 'result': dispatch({ type: 'CLOSE', ok: Boolean(m.ok), ms: (m.ms as number) ?? null, text: m.ok ? null : String(m.text ?? ''), now: Date.now() }); setBusy(false); break;
            case 'exit': setBusy(false); break;
            case 'error': onStatus('error'); break;
            default: break;
          }
        };
        ws.onclose = () => { if (!disposed) { setReady(false); setBusy(false); onStatus('closed'); } };
        ws.onerror = () => { if (!disposed) onStatus('error'); };
      } catch {
        if (!disposed) onStatus('error');
      }
    };
    connectRef.current = () => { void connect(); };
    void connect();
    return () => { disposed = true; try { wsRef.current?.close(); } catch { /* noop */ } };
  }, [id, onStatus]);

  useEffect(() => { scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight }); }, [turns]);

  const send = useCallback((text: string) => {
    const t = text.trim();
    const ws = wsRef.current;
    if (!t || busy || ws?.readyState !== WebSocket.OPEN) return;
    dispatch({ type: 'START', id: rid(), prompt: t, now: Date.now() });
    setBusy(true);
    ws.send(JSON.stringify({ type: 'user', text: t }));
  }, [busy]);

  const onSend = () => { send(input); setInput(''); };
  const stop = () => { wsRef.current?.send(JSON.stringify({ type: 'stop' })); dispatch({ type: 'STOP' }); setBusy(false); };

  return (
    <div className={styles.chat}>
      <div className={styles.transcript} ref={scrollRef}>
        {turns.length === 0 && (
          <p className={styles.empty}>Chatting with claude on {label}. Ask it to explain, edit, run, or fix — you'll see every tool it uses.</p>
        )}
        {turns.map((t) => (
          <section key={t.id} className={styles.turn}>
            <header className={styles.prompt}><span className={styles.you}>You</span> {t.prompt}</header>
            <div className={styles.blocks}>
              {t.blocks.map((b, i) => b.kind === 'assistant'
                ? <p key={i} className={styles.assistant}>{b.text}{b.streaming && <span className={styles.caret} />}</p>
                : (
                  <div key={b.id} className={`${styles.tool} ${styles[`t_${toolCategory(b.name)}`]}`}>
                    <button type="button" className={styles.toolHead} onClick={() => dispatch({ type: 'TOGGLE', turnId: t.id, toolId: b.id })}>
                      <span className={styles.toolState}>{b.status === 'running' ? '⋯' : b.status === 'failed' ? '✗' : '✓'}</span>
                      <span className={styles.toolName}>{b.name}</span>
                      <span className={styles.toolTarget}>{toolTarget(b.name, b.input)}</span>
                    </button>
                    {b.expanded && (
                      <pre className={styles.toolBody}>{`$ ${JSON.stringify(b.input)}\n\n${b.output || '(no output)'}`}</pre>
                    )}
                  </div>
                ))}
            </div>
            {t.errorText && <p className={styles.errorText}>{t.errorText}</p>}
            <footer className={styles.turnFoot}>
              {t.status === 'running' ? <span className={styles.running}>claude is working…</span> : (
                <>
                  <span className={t.status === 'failed' ? styles.fail : t.status === 'stopped' ? styles.muted : styles.ok}>
                    {t.status === 'failed' ? 'Failed' : t.status === 'stopped' ? 'Stopped' : 'Done'}
                  </span>
                  {summarize(t.blocks) && <span className={styles.summary}>{summarize(t.blocks)}</span>}
                  {t.ms != null && <span className={styles.dur}>~{(t.ms / 1000).toFixed(1)}s</span>}
                </>
              )}
            </footer>
          </section>
        ))}
      </div>

      {turns.length === 0 && ready && <Chips items={STARTERS} onPick={send} />}

      <Composer
        value={input} onChange={setInput} onSubmit={onSend}
        ready={ready} busy={busy} onStop={stop}
        placeholder={ready ? 'Message claude…' : 'Connecting…'} ariaLabel="Message"
      />
    </div>
  );
}
