// cloud-claude hub — single Node process.
// Sprint 0: serve the PWA shell + /healthz.
// Sprint 1: PIN auth (POST /auth, POST /logout, GET /auth/me) + requireAuth middleware.
// Later: GET /devices, POST /ingest, GET /rollup, POST /note, WS /pty (all behind requireAuth).
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import pty from 'node-pty';
import { config } from './config.js';
import {
  COOKIE, pinMatches, lockoutSeconds, recordFailure, resetFailures,
  createSession, sessionValid, revokeSession, signSid, unsignSid,
} from './auth.js';
import { loadDevices, readTailnetStatus, probeAll } from './devices.js';
import { issueWsToken, consumeWsToken, sweepTokens, buildCommand, originAllowed } from './pty.js';
import { buildShellCommand, wrapCommand, matchSentinel, isValidRunId, SHELL_INIT } from './shell.js';
import {
  createSession as createAgentSession, listSessions as listAgentSessions,
  getSession as getAgentSession, removeSession as removeAgentSession, setStatus as setAgentStatus,
} from './sessions.js';
import { assertCwd, buildAgentCommand, mapEvent, wrapUserMessage } from './agent.js';
import { openDb, insertEvents, queryTimeline, insertBriefing, latestBriefing } from './db.js';
import { handleIngest } from './ingest.js';
import { handleBriefing, latestFor } from './market.js';
import { buildRollup } from './rollup.js';
import { handleSaveNote, getNote } from './notes.js';

// Live agent bridges keyed by session id: { child, ws, buf, lineBuf, graceTimer }.
const agentBridges = new Map();

// Hub-plane timeline (Sprint 5). Opened once; WAL lets /timeline read while /ingest writes.
const db = openDb(config.dbFile);

const app = express();
app.disable('x-powered-by');
app.use(cookieParser());
// /ingest carries event batches → a larger cap (device-authed, tailnet-only). Scoped parser runs
// BEFORE the global one; express.json is idempotent, so the global 4kb parser then skips /ingest.
app.use('/ingest', express.json({ limit: '64kb' }));
// A briefing carries ~6 minutes of Korean narration plus evidence — 10-30kb, well past the
// global 4kb cap. This scoped parser MUST stay above the global one or every briefing 413s.
app.use('/api/market/briefing', express.json({ limit: '256kb' }));
app.use(express.json({ limit: '4kb' }));

// Structured audit log — auth events only, never content (eng-review).
function audit(event, extra = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...extra }));
}

function setSessionCookie(res, sid) {
  res.cookie(COOKIE, signSid(sid, config.sessionSecret), {
    httpOnly: true,
    secure: true, // page is HTTPS (tailscale serve); browser honours Secure
    sameSite: 'strict',
    maxAge: config.sessionTtlMs,
    path: '/',
  });
}

export function requireAuth(req, res, next) {
  const sid = unsignSid(req.cookies?.[COOKIE], config.sessionSecret);
  if (sid && sessionValid(sid)) {
    req.sid = sid;
    return next();
  }
  return res.status(401).json({ error: 'unauthorized' });
}

// Health check (public).
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'cloud-claude-hub', version: config.version });
});

// ── Auth ────────────────────────────────────────────────────────────────────
app.post('/auth', (req, res) => {
  const locked = lockoutSeconds();
  if (locked) {
    audit('auth_locked', { retryAfter: locked });
    return res.status(429).json({ error: 'locked', retryAfter: locked });
  }
  if (!config.pin) {
    audit('auth_no_pin_configured');
    return res.status(503).json({ error: 'pin_not_configured' });
  }
  if (pinMatches(req.body?.pin, config.pin)) {
    resetFailures();
    const sid = createSession(config.sessionTtlMs);
    setSessionCookie(res, sid);
    audit('auth_ok');
    return res.json({ ok: true });
  }
  recordFailure();
  audit('auth_fail', { lockout: lockoutSeconds() });
  return res.status(401).json({ error: 'bad_pin', lockout: lockoutSeconds() });
});

app.post('/logout', (req, res) => {
  const sid = unsignSid(req.cookies?.[COOKIE], config.sessionSecret);
  if (sid) revokeSession(sid);
  res.clearCookie(COOKIE, { path: '/' });
  audit('logout');
  res.json({ ok: true });
});

app.get('/auth/me', requireAuth, (_req, res) => res.json({ ok: true }));

// ── Devices (Machines tab) — probe the 4-device allowlist from the hub ─────────
app.get('/devices', requireAuth, async (_req, res) => {
  try {
    const devices = await loadDevices(config.devicesFile);
    const status = await readTailnetStatus();
    const rows = await probeAll(devices, status);
    res.json({ devices: rows, tailnet: Boolean(status) });
  } catch (err) {
    audit('devices_error', { msg: String(err?.message || err) });
    res.status(500).json({ error: 'devices_failed' });
  }
});

// ── Hub plane: collector ingest → SQLite timeline (Sprint 5) ──────────────────
// POST /ingest — a device's collector pushes an event batch. Auth = per-device ingest token
// (Bearer), NOT the phone PIN. Idempotent (INSERT OR IGNORE on deterministic event_id).
app.post('/ingest', async (req, res) => {
  let devices;
  try {
    devices = await loadDevices(config.devicesFile);
  } catch (err) {
    audit('ingest_error', { msg: String(err?.message || err) });
    return res.status(500).json({ error: 'ingest_failed' });
  }
  const r = handleIngest({
    devices,
    body: req.body,
    authHeader: req.headers.authorization,
    insertFn: (events, now) => insertEvents(db, events, now),
  });
  audit(r.status === 200 ? 'ingest_ok' : 'ingest_reject', {
    deviceId: req.body?.device_id, status: r.status,
    ...(r.status === 200 ? r.body : { reason: r.body?.error }),
  });
  res.status(r.status).json(r.body);
});

// GET /timeline — read the timeline (phone, behind the PIN). Real-column filters only.
app.get('/timeline', requireAuth, (req, res) => {
  try {
    const events = queryTimeline(db, {
      device: req.query.device,
      kind: req.query.kind,
      since: req.query.since != null ? Number(req.query.since) : undefined,
      until: req.query.until != null ? Number(req.query.until) : undefined,
      limit: req.query.limit,
    });
    res.json({ events });
  } catch (err) {
    audit('timeline_error', { msg: String(err?.message || err) });
    res.status(500).json({ error: 'timeline_failed' });
  }
});

// ── Hub plane: Today rollup + reflection note (Sprint 6) ──────────────────────
// GET /rollup?date=YYYY-MM-DD&tz=<IANA> — the day's summary, derived on read. The note is
// embedded so Today renders from ONE fetch. tz falls back to the hub config only.
app.get('/rollup', requireAuth, (req, res) => {
  try {
    const date = String(req.query.date || '');
    const tz = String(req.query.tz || config.tz);
    const rollup = buildRollup(db, { date, tz, now: Date.now() });
    rollup.note = getNote(db, date);
    res.json(rollup);
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg === 'bad date' || msg === 'bad tz') return res.status(400).json({ error: msg.replace(' ', '_') });
    audit('rollup_error', { msg });
    res.status(500).json({ error: 'rollup_failed' });
  }
});

// POST /note {date, tz, text} — upsert today's one line (PIN path; /ingest still rejects notes).
app.post('/note', requireAuth, (req, res) => {
  const r = handleSaveNote(db, req.body);
  if (r.status !== 200) audit('note_reject', { reason: r.body?.error });
  res.status(r.status).json(r.body);
});

// ── Agent sessions (Device plane, v0.6) ───────────────────────────────────────
app.get('/sessions', requireAuth, (req, res) => {
  res.json({ sessions: listAgentSessions(req.query.device) });
});

app.post('/sessions', requireAuth, async (req, res) => {
  const { device: deviceId, cwd, title } = req.body || {};
  const devices = await loadDevices(config.devicesFile);
  const device = devices.find((d) => d.id === deviceId && d.enabled !== false);
  if (!device) return res.status(404).json({ error: 'unknown_device' });
  if (cwd != null) {
    try { assertCwd(cwd); } catch { return res.status(400).json({ error: 'bad_cwd' }); }
  }
  const session = createAgentSession({ deviceId, cwd, title });
  audit('session_create', { id: session.id, device: deviceId });
  res.status(201).json({ session });
});

app.delete('/sessions/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  if (!getAgentSession(id)) return res.status(404).json({ error: 'unknown_session' });
  const bridge = agentBridges.get(id);
  if (bridge) { killAgentChild(bridge); agentBridges.delete(id); }
  removeAgentSession(id);
  audit('session_kill', { id });
  res.status(204).end();
});

// ── Terminal relay (Device plane) ─────────────────────────────────────────────
// A short-lived, single-use WS token is minted here (authenticated, same-origin cookie)
// and then presented on the WS query string. WS cookies are CSRF-hijackable, so the token
// — not the cookie — authorizes the socket, alongside an Origin check (codex hardening).
app.post('/pty/token', requireAuth, (req, res) => {
  const { token, ttl } = issueWsToken(req.sid);
  audit('pty_token_issued');
  res.json({ token, ttl });
});

// ── Market briefing ──────────────────────────────────────────────────────────
// POST is device-authed (bearer), like /ingest. Reads are behind the phone PIN.
app.post('/api/market/briefing', async (req, res) => {
  let devices;
  try {
    devices = await loadDevices(config.devicesFile);
  } catch (err) {
    audit('briefing_error', { msg: String(err?.message || err) });
    return res.status(500).json({ error: 'briefing_failed' });
  }
  const r = handleBriefing({
    devices,
    body: req.body,
    authHeader: req.headers.authorization,
    insertFn: (row) => insertBriefing(db, row),
  });
  audit(r.status === 200 ? 'briefing_ok' : 'briefing_reject', {
    runId: req.body?.run_id, status: r.status,
    ...(r.status === 200 ? { briefingStatus: req.body?.status } : { reason: r.body?.error }),
  });
  res.status(r.status).json(r.body);
});

// Always 200 with an explicit state (ready | pending | missing) — never 404. "Nothing yet"
// and "the generator never reported" must not render the same, and a 404 is also
// indistinguishable from a routing mistake on the client.
app.get('/api/market/latest', requireAuth, (_req, res) => {
  try {
    res.json(latestFor((date) => latestBriefing(db, date)));
  } catch (err) {
    audit('briefing_read_error', { msg: String(err?.message || err) });
    res.status(500).json({ error: 'read_failed' });
  }
});

// Audio sits behind the SAME gate as /timeline. It narrates real positions and stop levels,
// so it must never ride on the public PWA static mount. Registered before the SPA fallback.
app.use(
  '/api/market/audio',
  requireAuth,
  express.static(config.paths.briefingDir, {
    fallthrough: false,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'private, max-age=31536000');
    },
  })
);

// ── PWA shell (public — serves the unlock screen to unauthenticated users) ────
app.use(
  express.static(config.paths.pwaDir, {
    extensions: ['html'],
    setHeaders(res, filePath) {
      // Content-hashed Vite assets are immutable; the SW + HTML shell must revalidate
      // so a redeploy is picked up immediately.
      if (filePath.endsWith('sw.js') || filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })
);

app.get('*', (_req, res) => {
  res.sendFile(path.join(config.paths.pwaDir, 'index.html'));
});

// ── WS /pty relay: phone ⟷ hub ⟷ (ssh) ⟷ tmux ─────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
setInterval(() => sweepTokens(), 60_000).unref();

server.on('upgrade', async (req, socket, head) => {
  const reject = (code, event, extra) => {
    audit(event, extra);
    socket.write(`HTTP/1.1 ${code}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    // /pty = live terminal · /run = shell command blocks · /agent = claude agent (needs a session).
    if (!['/pty', '/run', '/agent'].includes(url.pathname)) {
      return reject('404 Not Found', 'ws_bad_path', { path: url.pathname });
    }
    if (!originAllowed(req.headers.origin, req.headers.host)) {
      return reject('403 Forbidden', 'ws_bad_origin', { origin: req.headers.origin || null });
    }
    const sid = consumeWsToken(url.searchParams.get('token'));
    if (!sid || !sessionValid(sid)) return reject('401 Unauthorized', 'ws_bad_token');

    const deviceId = url.searchParams.get('device');
    const devices = await loadDevices(config.devicesFile);
    const device = devices.find((d) => d.id === deviceId && d.enabled !== false);
    if (!device) return reject('404 Not Found', 'ws_bad_device', { device: deviceId });

    if (url.pathname === '/agent') {
      const session = getAgentSession(url.searchParams.get('session'));
      if (!session || session.deviceId !== deviceId) return reject('404 Not Found', 'ws_bad_session');
      return wss.handleUpgrade(req, socket, head, (ws) => bridgeAgent(ws, device, session));
    }
    const bridge = url.pathname === '/run' ? bridgeShell : bridgePty;
    wss.handleUpgrade(req, socket, head, (ws) => bridge(ws, device));
  } catch (err) {
    reject('500 Internal Server Error', 'pty_upgrade_error', { msg: String(err?.message || err) });
  }
});

// Bridge a WS to a node-pty running ssh→tmux. Client→server = JSON control frames
// ({type:'stdin'|'resize'}); server→client = raw pty bytes (binary). Sprint 4 adds grace,
// backpressure, OSC-52 strip and resource caps — here we just prove the pipe.
function bridgePty(ws, device) {
  let term;
  try {
    const { file, args } = buildCommand(device, {
      hubKeyPath: config.hubKeyPath,
      macTmuxPath: config.macTmuxPath,
      session: config.ptySession,
    });
    term = pty.spawn(file, args, {
      name: 'xterm-color', cols: 80, rows: 24, cwd: process.env.HOME, env: process.env,
    });
  } catch (err) {
    audit('pty_spawn_error', { device: device.id, msg: String(err?.message || err) });
    ws.close(1011, 'spawn failed');
    return;
  }
  const openedAt = Date.now();
  audit('pty_open', { device: device.id });

  term.onData((data) => { if (ws.readyState === ws.OPEN) ws.send(data); });
  term.onExit(({ exitCode }) => {
    audit('pty_exit', { device: device.id, exitCode });
    if (ws.readyState === ws.OPEN) ws.close(1000, 'session ended');
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'stdin' && typeof msg.data === 'string') term.write(msg.data);
    else if (msg.type === 'resize' && msg.cols > 0 && msg.rows > 0) {
      term.resize(Math.min(msg.cols, 500), Math.min(msg.rows, 300));
    }
  });
  ws.on('close', () => {
    try { term.kill(); } catch { /* already gone */ }
    audit('pty_close', { device: device.id, seconds: Math.round((Date.now() - openedAt) / 1000) });
  });
}

// Bridge a WS to a persistent login shell (Chat mode). Client→server = {type:'run', id, cmd};
// server→client = {type:'out', id, data} chunks then {type:'done', id, exit}. Output is split
// on exit sentinels so each command becomes one block. (Sprint 4: caps, stop/interrupt.)
function bridgeShell(ws, device) {
  let child;
  try {
    const { file, args } = buildShellCommand(device, { hubKeyPath: config.hubKeyPath });
    child = spawn(file, args, { env: process.env });
  } catch (err) {
    audit('run_spawn_error', { device: device.id, msg: String(err?.message || err) });
    ws.close(1011, 'spawn failed');
    return;
  }
  audit('run_open', { device: device.id });
  child.stdin.write(SHELL_INIT);

  let buf = '';
  let curId = null;
  const pump = (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const sent = matchSentinel(line);
      if (sent) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'done', id: sent.id, exit: sent.exit }));
        curId = null;
      } else if (curId && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'out', id: curId, data: `${line}\n` }));
      }
    }
  };
  child.stdout.on('data', pump);
  child.stderr.on('data', (c) => audit('run_stderr', { device: device.id, msg: c.toString('utf8').slice(0, 200) }));
  child.on('exit', () => { if (ws.readyState === ws.OPEN) ws.close(1000, 'shell ended'); });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'run' && typeof msg.cmd === 'string' && isValidRunId(msg.id)) {
      curId = msg.id;
      child.stdin.write(wrapCommand(msg.id, msg.cmd));
    }
  });
  ws.on('close', () => { try { child.kill(); } catch { /* gone */ } audit('run_close', { device: device.id }); });
}

// ── Agent bridge: phone ⟷ hub ⟷ ssh ⟷ `claude -p` stream-json ─────────────────
// Client→server: {type:'user',text} · {type:'stop'}. Server→client: mapped claude events
// ({assistant,tool_use,tool_result,result,status,...}). Keep-alive: on WS close the child lives
// ~45s (output buffered) so a reconnect re-attaches the same stream (T-B). Kill = SIGTERM the
// process group (setsid on Linux, ssh -tt SIGHUP on Mac). Backpressure = bounded disconnect buffer.
const AGENT_GRACE_MS = 45_000;

function killAgentChild(b) {
  if (!b?.child) return;
  try { process.kill(-b.child.pid, 'SIGTERM'); } catch { try { b.child.kill('SIGTERM'); } catch { /* gone */ } }
}

function deliverAgent(b, msg) {
  if (b.ws && b.ws.readyState === b.ws.OPEN) b.ws.send(msg);
  else { b.buf.push(msg); if (b.buf.length > 500) b.buf.shift(); } // bounded (codex #8)
}

function onAgentStdout(b, chunk) {
  b.lineBuf += chunk.toString('utf8');
  let nl;
  while ((nl = b.lineBuf.indexOf('\n')) >= 0) {
    const line = b.lineBuf.slice(0, nl);
    b.lineBuf = b.lineBuf.slice(nl + 1);
    if (!line.trim()) continue;
    let evt;
    try { evt = JSON.parse(line); } catch { continue; } // malformed line → skip (codex #17)
    for (const wsEvt of mapEvent(evt)) deliverAgent(b, JSON.stringify(wsEvt));
  }
  if (b.lineBuf.length > 1_000_000) b.lineBuf = b.lineBuf.slice(-4096); // huge unterminated line cap
}

function wireAgentWs(ws, b, session) {
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === 'user' && typeof m.text === 'string') {
      try { b.child.stdin.write(wrapUserMessage(m.text)); } catch { /* child gone */ }
    } else if (m.type === 'stop') {
      try { process.kill(-b.child.pid, 'SIGINT'); } catch { try { b.child.kill('SIGINT'); } catch { /* gone */ } }
      audit('agent_stop', { id: session.id });
    }
  });
  ws.on('close', () => {
    if (b.ws !== ws) return; // superseded by a reattach — ignore the old socket
    b.ws = null;
    b.graceTimer = setTimeout(() => {
      killAgentChild(b); agentBridges.delete(session.id); setAgentStatus(session.id, 'exited');
      audit('agent_grace_kill', { id: session.id });
    }, AGENT_GRACE_MS);
    audit('agent_detach', { id: session.id });
  });
}

function bridgeAgent(ws, device, session) {
  const existing = agentBridges.get(session.id);
  if (existing && existing.child && existing.child.exitCode == null) {
    // Reattach (keep-alive): cancel the grace kill, swap the socket, flush the buffer.
    clearTimeout(existing.graceTimer); existing.graceTimer = null;
    existing.ws = ws;
    ws.send(JSON.stringify({ type: 'status', state: 'reattached' }));
    for (const m of existing.buf) ws.send(m);
    existing.buf = [];
    audit('agent_reattach', { id: session.id });
    wireAgentWs(ws, existing, session);
    return;
  }
  let child;
  try {
    const { file, args } = buildAgentCommand(device, session.cwd, {
      hubKeyPath: config.hubKeyPath, permissionMode: 'acceptEdits',
    });
    child = spawn(file, args, { env: process.env, detached: true }); // own process group for group-kill
  } catch (err) {
    audit('agent_spawn_error', { id: session.id, msg: String(err?.message || err) });
    setAgentStatus(session.id, 'error');
    try { ws.send(JSON.stringify({ type: 'error', reason: 'spawn' })); } catch { /* noop */ }
    ws.close(1011, 'spawn failed');
    return;
  }
  const b = { child, ws, buf: [], lineBuf: '', graceTimer: null };
  agentBridges.set(session.id, b);
  setAgentStatus(session.id, 'running');
  audit('agent_open', { id: session.id, device: device.id });

  child.stdout.on('data', (c) => onAgentStdout(b, c));
  child.stderr.on('data', (c) => audit('agent_stderr', { id: session.id, msg: c.toString('utf8').slice(0, 200) }));
  child.on('exit', (code) => {
    setAgentStatus(session.id, 'exited');
    // b.ws is null once the socket has detached — guard before touching its statics (this
    // unguarded `b.ws.OPEN` on a null ws crashed the whole hub when a child exited post-detach).
    if (b.ws && b.ws.readyState === b.ws.OPEN) b.ws.send(JSON.stringify({ type: 'exit', code }));
    if (b.graceTimer) clearTimeout(b.graceTimer);
    agentBridges.delete(session.id);
    audit('agent_exit', { id: session.id, code });
  });

  wireAgentWs(ws, b, session);
}

server.listen(config.port, () => {
  console.log(`[hub] listening on :${config.port} (tz=${config.tz}, log=${config.logLevel})`);
  console.log(`[hub] front with:  sudo tailscale serve --bg ${config.port}`);
});
