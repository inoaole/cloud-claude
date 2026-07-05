import { defineConfig, devices } from '@playwright/test';

// Smoke runs against the real hub serving the built dist (frontend/dist). It exercises
// only the unauthenticated surface (unlock screen + SPA route gate + SW-served build),
// so it needs no PIN/secret. The authed flow is covered by Vitest + manual iPhone verify.
const PORT = process.env.HUB_PORT || '8080';
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: BASE,
    ...devices['iPhone 15 Pro'],
  },
  webServer: {
    command: `npm run build && HUB_PORT=${PORT} node ../hub/src/server.js`,
    url: `${BASE}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
