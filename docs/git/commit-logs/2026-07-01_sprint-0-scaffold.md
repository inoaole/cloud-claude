# Commit Log — 2026-07-01 · Sprint 0 (feature/v0.1.0/hub-scaffold)

- `feat(sprint-0): scaffold hub + PWA shell + shared/env/devices`
  Single Node hub (`hub/`, express): `/healthz`, static PWA serving, SPA fallback. PWA shell
  (`pwa/`) in the DESIGN.md "Personal OS App Language" (dark, tab bar Today·Timeline·Growth·
  Machines·Settings) + manifest + service worker (shell cache) + sw registration. `shared/schema.js`
  event-schema stub (Hub plane). `.env.example` (HUB_PORT·TZ·SESSION_SECRET·LOG_LEVEL·DEVICES_FILE)
  and `devices.example.json` (4-device allowlist reflecting the real tailnet). `scripts/serve-https.sh`
  fronts the hub with tailnet-only `tailscale serve`. Verified locally: healthz + shell + manifest +
  sw + SPA fallback all serve.
- `fix(sprint-0): code-review — SW network-first for HTML, version from package.json, sudo in serve script`
  Review (project code-review skill): SW cache-first on the HTML shell would serve a stale UI after
  deploys → navigations now network-first, static assets cache-first. `/healthz` version now reads
  `hub/package.json` (single source, no hardcode). `scripts/serve-https.sh` uses `sudo tailscale serve`
  (needs root on the hub). Verified locally.

Sprint 0 Exit MET: deployed to the hub, `tailscale serve` live at
https://<hub>.<tailnet>.ts.net/, PWA shell installs on the phone home screen over HTTPS.

- `chore(release): bump to 0.2.0 (sprint-0 merged to develop)`
  PR #1 merged to `develop` (merge commit). VERSION 0.1.0 -> 0.2.0 and hub/package.json to match
  (so `/healthz` reports the release version). Sprint 0 closed.
