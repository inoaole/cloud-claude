// Hub config, loaded from environment (.env). Never hardcode secrets.
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

export const config = {
  port: Number(process.env.HUB_PORT || 8080),
  tz: process.env.TZ || 'Asia/Seoul',
  logLevel: process.env.LOG_LEVEL || 'info',
  // Session signing secret — required in production; dev fallback is intentionally obvious.
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-change-me',
  // Device registry (gitignored). Copy devices.example.json -> devices.json.
  devicesFile: process.env.DEVICES_FILE || path.join(repoRoot, 'devices.json'),
  paths: { repoRoot, pwaDir: path.join(repoRoot, 'pwa') },
};

if (config.sessionSecret === 'dev-insecure-change-me') {
  console.warn('[config] SESSION_SECRET is the dev fallback — set a real value in .env before deploy.');
}
