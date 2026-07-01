# Commit Log — 2026-07-01 · Sprint 2 (feature/v0.4.0/machines-probe)

- `feat(sprint-2): GET /devices probe + Machines tab`
  Device plane, screen 1: the Machines tab shows the 4-device allowlist with honest
  reachability, probed from the hub (the always-on tailnet vantage point).

  **Hub `hub/src/devices.js`:** `loadDevices` (devices.json; missing → [] not a crash),
  `readTailnetStatus` (`tailscale status --json`, null if unavailable → graceful degrade),
  `findPeer` (match a device by MagicDNS name or tailnet IP), `tcpProbe` (net.connect to
  SSH:22 → open/refused/timeout/error, never rejects), `probeDevice` (pure classifier, TCP
  injectable for tests) and `probeAll`. Probe = tailscale hint (is the peer online) + TCP
  truth (is SSH actually reachable), so offline **reasons are distinguished**: `disabled`
  (config) · `asleep` (peer offline) · `not-on-tailnet` (ACL/not joined) · `ssh-closed`
  (Remote Login off) · `firewall` (port blocked). Hub row = online (self).

  **Route:** `GET /devices` behind `requireAuth` → `{ devices: [...], tailnet }`, 500-safe
  with an audit log on failure.

  **Frontend:** `screens/Machines.tsx` replaces the stub — loading ("Checking devices…") /
  error (+Retry) / ready (grouped list) / honest-quiet empty. Each row = a `Cell` with a
  leading status dot (online = filled Action Blue, offline = hollow muted, disabled =
  dashed/dimmed — monochrome + one accent), the distinguished reason as subtitle, a "Hub"
  tag on the hub, and a "Recheck" action. `Cell` gained a reusable `leading` slot.
  `lib/api.ts` gained `getDevices()` + `Device` type.

  **Tests:** hub `node --test` (9: findPeer, every offline reason, hub self, probeAll) +
  Vitest (3: online-count/reasons render, error→retry recovery, empty state) — 24 total green.
  Build clean.

  **Verified on the hub (real probe):** MacBook Pro ●online, Ubuntu hub ●online (Hub),
  Mac mini/Desktop ○disabled, `tailnet:true`. `/devices` is 401 without a session, 200 with.
  Deployed to the hub (frontend/dist atomic swap + backend, v0.3.0 live). Distinguished
  offline reasons are unit-covered (both enabled devices are currently online).

- `fix(sprint-2): isolate per-device probe errors in probeAll (code-review)`
  code-review [suggestion]: wrap each device's probe in try/catch so one throwing probe
  degrades to a single `probe-error` row instead of 500-ing the whole Machines tab. +1
  node:test (10 hub tests). Redeployed devices.js; reprobe unchanged. (No blocking/important
  findings — tcpProbe socket handling, findPeer, allowlist-only probing, and the Machines
  effect cleanup all verified clean.)
