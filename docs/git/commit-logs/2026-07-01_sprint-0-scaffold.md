# Commit Log — 2026-07-01 · Sprint 0 (feature/v0.1.0/hub-scaffold)

- `feat(sprint-0): scaffold hub + PWA shell + shared/env/devices`
  Single Node hub (`hub/`, express): `/healthz`, static PWA serving, SPA fallback. PWA shell
  (`pwa/`) in the DESIGN.md "Personal OS App Language" (dark, tab bar Today·Timeline·Growth·
  Machines·Settings) + manifest + service worker (shell cache) + sw registration. `shared/schema.js`
  event-schema stub (Hub plane). `.env.example` (HUB_PORT·TZ·SESSION_SECRET·LOG_LEVEL·DEVICES_FILE)
  and `devices.example.json` (4-device allowlist reflecting the real tailnet). `scripts/serve-https.sh`
  fronts the hub with tailnet-only `tailscale serve`. Verified locally: healthz + shell + manifest +
  sw + SPA fallback all serve.
  Remaining for Sprint 0 Exit: deploy to the hub + `tailscale serve` + verify home-screen install on the phone.
