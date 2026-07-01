// cloud-claude hub — single Node process.
// Sprint 0: serve the PWA shell + /healthz.
// Sprint 1: PIN auth (POST /auth, POST /logout, GET /auth/me) + requireAuth middleware.
// Later: GET /devices, POST /ingest, GET /rollup, POST /note, WS /pty (all behind requireAuth).
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { config } from './config.js';
import {
  COOKIE, pinMatches, lockoutSeconds, recordFailure, resetFailures,
  createSession, sessionValid, revokeSession, signSid, unsignSid,
} from './auth.js';
import { loadDevices, readTailnetStatus, probeAll } from './devices.js';

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

app.listen(config.port, () => {
  console.log(`[hub] listening on :${config.port} (tz=${config.tz}, log=${config.logLevel})`);
  console.log(`[hub] front with:  sudo tailscale serve --bg ${config.port}`);
});
