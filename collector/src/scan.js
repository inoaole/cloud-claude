// Session scan (v1b) — observe claude / codex / tmux processes via poll-diff.
// A session is EMITTED once, when it ENDS (its pid vanished since the last run) — clean
// single event per session, deterministic id, no live-updating (plan D-D).
//
//   run N:   ps ──▶ matches ──▶ new pids → track in state.sessions
//   run N+1: ps ──▶ matches ──▶ tracked pid missing → emit session_observed(started..lastSeen)
//
// Spike-hardened (2026-07-04, live probe on the MacBook Pro):
//  1. Match the EXECUTABLE basename (`ps -o comm=` = argv[0] path, args excluded) — a substring
//     match on the command line drags in "Claude Helper" (the desktop app's 7 helpers) and the
//     `disclaimer` wrapper whose ARGS contain the claude path.
//  2. Exclude codex `app-server` (the Codex app's resident daemon is not a work session) —
//     the one case where we must look at args.
//  3. `lstart` parsed under LC_ALL=C with whitespace normalized; macOS executable paths can
//     contain spaces, so comm (last field, spaces ok) and lstart are fetched per-pid.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { SCHEMA_VERSION, sessionEventId } from '../../shared/schema.js';

const execFileAsync = promisify(execFile);
const OPTS = { timeout: 15_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } };
const TOOLS = new Set(['claude', 'codex', 'tmux']);
// If a stored session's pid reappears with a start time off by more than this, the pid was
// REUSED by a new process — treat the old session as ended.
const START_TOLERANCE_MS = 60_000;

/** `ps -axo pid=,comm=` → [{pid, tool}] for matching executables only. */
export async function listCandidates(exec = execFileAsync) {
  const { stdout } = await exec('ps', ['-axo', 'pid=,comm='], OPTS);
  const out = [];
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const tool = path.basename(m[2].trim());
    if (TOOLS.has(tool)) out.push({ pid: Number(m[1]), tool });
  }
  return out;
}

/** Start time (epoch ms) of a pid via lstart, or null if it vanished mid-scan. */
export async function startedMs(pid, exec = execFileAsync) {
  try {
    const { stdout } = await exec('ps', ['-o', 'lstart=', '-p', String(pid)], OPTS);
    const s = stdout.trim().replace(/\s+/g, ' '); // "Sat Jul 4 14:09:33 2026"
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

/** True when a codex pid is the resident app-server daemon (not a work session). */
export async function isCodexDaemon(pid, exec = execFileAsync) {
  try {
    const { stdout } = await exec('ps', ['-o', 'args=', '-p', String(pid)], OPTS);
    return /\bapp-server\b/.test(stdout);
  } catch {
    return false;
  }
}

/** cwd BASENAME of a pid via lsof (never the full path — privacy), or null.
    lsof exits 1 even when it produced output (some fds unlistable) — recover err.stdout. */
export async function cwdBasename(pid, exec = execFileAsync) {
  let stdout = '';
  try {
    ({ stdout } = await exec('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], OPTS));
  } catch (err) {
    stdout = typeof err?.stdout === 'string' ? err.stdout : '';
  }
  const line = stdout.split('\n').find((l) => l.startsWith('n'));
  if (!line) return null;
  const cwd = line.slice(1);
  // The home dir means "no particular project" — and its basename is the USERNAME, which is
  // noise in the UI and mild identity leakage in the timeline. Report null instead.
  if (cwd === os.homedir()) return null;
  return path.basename(cwd);
}

/** Observe the machine's current tool sessions: [{key, pid, tool, started, cwd}]. */
export async function observeSessions(exec = execFileAsync) {
  const candidates = await listCandidates(exec);
  const seen = [];
  for (const c of candidates) {
    if (c.tool === 'codex' && (await isCodexDaemon(c.pid, exec))) continue;
    const started = await startedMs(c.pid, exec);
    if (started == null) continue; // vanished between ps calls — next run settles it
    seen.push({ key: `${c.tool}:${c.pid}`, pid: c.pid, tool: c.tool, started, cwd: await cwdBasename(c.pid, exec) });
  }
  // tmux runs as a client + a server (and one machine has one fixed session by design) —
  // collapse all tmux pids into the single longest-lived one.
  const tmux = seen.filter((s) => s.tool === 'tmux');
  if (tmux.length > 1) {
    const keep = tmux.reduce((a, b) => (a.started <= b.started ? a : b));
    return seen.filter((s) => s.tool !== 'tmux' || s === keep);
  }
  return seen;
}

/**
 * Diff current observations against tracked state. Returns { events, nextSessions }.
 * `prev` shape (state.json): { "<tool>:<pid>": {pid, tool, started, cwd, lastSeen} }.
 */
export function diffSessions(prev, observed, deviceId, now) {
  const events = [];
  const next = {};

  const current = new Map(observed.map((s) => [s.key, s]));
  for (const [key, old] of Object.entries(prev)) {
    const cur = current.get(key);
    if (cur && Math.abs(cur.started - old.started) <= START_TOLERANCE_MS) {
      // still alive — keep tracking (first-seen started/cwd win; started jitter ignored)
      next[key] = { ...old, lastSeen: now };
      current.delete(key);
    } else {
      // gone (or pid reused by a NEW process) → the session ENDED. ended = when we last saw
      // it alive — the honest observation bound, not a guess at the true exit moment.
      events.push(endedEvent(old, deviceId));
      // a reused pid falls through as a fresh observation below
    }
  }
  for (const s of current.values()) {
    next[s.key] = { pid: s.pid, tool: s.tool, started: s.started, cwd: s.cwd, lastSeen: now };
  }
  return { events, nextSessions: next };
}

function endedEvent(t, deviceId) {
  const ended = Math.max(t.lastSeen, t.started);
  return {
    event_id: sessionEventId(deviceId, t.tool, t.pid, t.started),
    device_id: deviceId,
    kind: 'session_observed',
    ts_device: t.started, // a session belongs to the day the work began
    schema_version: SCHEMA_VERSION,
    payload: { tool: t.tool, pid: t.pid, cwd: t.cwd ?? null, started: t.started, ended },
  };
}
