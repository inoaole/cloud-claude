// Hub config, loaded from environment (.env). Never hardcode secrets.
import 'dotenv/config';
import path from 'node:path';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

// Single source of truth for the app version (avoid hardcoding it in multiple files).
const pkg = JSON.parse(readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

// Parse a TTL like "7d", "12h", "30m", "45s" (or a bare number of ms) to milliseconds.
function parseTtl(v, fallbackMs) {
  if (v == null) return fallbackMs;
  const m = String(v).trim().match(/^(\d+)\s*(ms|s|m|h|d)?$/);
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  const unit = { ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] || 'ms'];
  return n * unit;
}

export const config = {
  version: pkg.version,
  port: Number(process.env.HUB_PORT || 8080),
  tz: process.env.TZ || 'Asia/Seoul',
  logLevel: process.env.LOG_LEVEL || 'info',
  // Session signing secret — required in production; dev fallback is intentionally obvious.
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-change-me',
  // PIN to unlock the app from the phone.
  pin: process.env.HUB_PIN || '',
  // Session lifetime (SESSION_TTL like "7d"); default 7 days.
  sessionTtlMs: parseTtl(process.env.SESSION_TTL, 7 * 864e5),
  // Device registry (gitignored). Copy devices.example.json -> devices.json.
  devicesFile: process.env.DEVICES_FILE || path.join(repoRoot, 'devices.json'),
  // Hub-plane SQLite timeline (Sprint 5). Runtime data, gitignored; overridable for tests/deploy.
  dbFile: process.env.DB_FILE || path.join(repoRoot, 'data', 'timeline.db'),
  // Terminal relay (Sprint 3). The hub-only SSH key for classic-SSH (Mac) targets, and
  // the tmux path on macOS targets (non-login ssh lacks Homebrew's PATH). Fixed session
  // name = no injection surface. WS token TTL is short + single-use.
  hubKeyPath: process.env.HUB_SSH_KEY || path.join(os.homedir(), '.ssh', 'id_cloud_claude'),
  macTmuxPath: process.env.MAC_TMUX_PATH || '/opt/homebrew/bin/tmux',
  ptySession: process.env.PTY_SESSION || 'phone',
  // The built React SPA (frontend/dist). Overridable so an atomic deploy can point at
  // a swapped-in directory. Falls back to the in-repo build path.
  paths: {
    repoRoot,
    pwaDir: process.env.PWA_DIR || path.join(repoRoot, 'frontend', 'dist'),
    // Briefing mp3s. NOT frontend/dist — a PWA rebuild wipes dist, and dist is served
    // publicly while these narrate real positions and stop levels.
    // In production set BRIEFING_DIR=/var/lib/briefing/audio: the generator runs under a
    // systemd sandbox with ProtectHome=yes, so anything under /home is unwritable to it.
    // The hub reads that directory via the briefingshare group. The repo-local default
    // below is for dev only.
    briefingDir: process.env.BRIEFING_DIR || path.join(repoRoot, 'data', 'briefings'),
  },
};

if (config.sessionSecret === 'dev-insecure-change-me') {
  console.warn('[config] SESSION_SECRET is the dev fallback — set a real value in .env before deploy.');
}
if (!config.pin) {
  console.warn('[config] HUB_PIN is not set — /auth will reject every PIN until you set one in .env.');
}
