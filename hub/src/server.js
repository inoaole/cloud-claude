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

const app = express();
app.disable('x-powered-by');
app.use(cookieParser());
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

// ── Terminal relay (Device plane) ─────────────────────────────────────────────
// A short-lived, single-use WS token is minted here (authenticated, same-origin cookie)
// and then presented on the WS query string. WS cookies are CSRF-hijackable, so the token
// — not the cookie — authorizes the socket, alongside an Origin check (codex hardening).
app.post('/pty/token', requireAuth, (req, res) => {
  const { token, ttl } = issueWsToken(req.sid);
  audit('pty_token_issued');
  res.json({ token, ttl });
});

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
    // /pty = live terminal (Terminal mode); /run = command-block shell (Chat mode).
    if (url.pathname !== '/pty' && url.pathname !== '/run') {
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

server.listen(config.port, () => {
  console.log(`[hub] listening on :${config.port} (tz=${config.tz}, log=${config.logLevel})`);
  console.log(`[hub] front with:  sudo tailscale serve --bg ${config.port}`);
});
