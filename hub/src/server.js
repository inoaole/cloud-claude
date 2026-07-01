// cloud-claude hub — single Node process.
// Sprint 0: serve the PWA shell + /healthz.
// Later sprints add: PIN auth, GET /devices, POST /ingest, GET /rollup, POST /note, WS /pty.
import express from 'express';
import path from 'node:path';
import { config } from './config.js';

const app = express();
app.disable('x-powered-by');

// Health check (used by deploy/canary later).
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'cloud-claude-hub', version: config.version });
});

// Static PWA shell (served over HTTPS by `tailscale serve` in front of this port).
app.use(
  express.static(config.paths.pwaDir, {
    extensions: ['html'],
    setHeaders(res, filePath) {
      // Never cache the service worker or the shell HTML aggressively.
      if (filePath.endsWith('sw.js') || filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

// SPA fallback — every non-file route renders the shell.
app.get('*', (_req, res) => {
  res.sendFile(path.join(config.paths.pwaDir, 'index.html'));
});

app.listen(config.port, () => {
  console.log(`[hub] listening on :${config.port} (tz=${config.tz}, log=${config.logLevel})`);
  console.log(`[hub] front with:  tailscale serve --bg ${config.port}`);
});
