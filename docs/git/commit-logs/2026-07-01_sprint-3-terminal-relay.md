# Commit Log — 2026-07-01 · Sprint 3 (feature/v0.5.0/terminal-relay)

- `feat(sprint-3): WS /pty terminal relay + xterm console`
  Device plane core: from the phone, open a real terminal on an allowlisted device.
  Path = phone ⟷ hub WS `/pty` ⟷ node-pty ⟷ ssh ⟷ tmux. The infra spike proved this
  chain; this lands it in the app.

  **Auth (codex hardening):** WS cookies are CSRF-hijackable, so the socket is authorized by
  a **short-lived (30s), single-use token** minted at `POST /pty/token` (behind `requireAuth`)
  and presented on the WS query string, PLUS an **Origin check** (same host as the page).
  Device must be in the **devices.json allowlist** + enabled. Rejections are audited and
  return proper HTTP codes (403 bad-origin / 401 bad-token / 404 bad-device).

  **Relay (`hub/src/pty.js` + server.js):** `buildCommand` returns `(file, args)` — **never a
  shell** — for the hub (local tmux), a Linux peer (Tailscale SSH), or a Mac (classic ssh with
  the hub key + absolute tmux path, since non-login ssh lacks Homebrew's PATH). Fixed tmux
  session name (`phone`) via `new -A -s phone` → re-attach, no injection surface. `app.listen`
  became `http.createServer` + `WebSocketServer({noServer:true})` handling `/pty` upgrades.
  Bridge: client→server = JSON control frames (`stdin`/`resize`, resize clamped); server→client
  = raw pty bytes; `onExit`→close; `close`→`term.kill()`; token sweep on an interval.
  (Sprint 4 adds grace-on-disconnect, backpressure, OSC-52 strip, resource caps.)

  **Frontend:** `screens/Terminal.tsx` — full-screen (rendered outside AppShell for max
  height), xterm + FitAddon, `POST /pty/token` → `wss://…/pty?device&token`, resize on window
  resize, connection status (connecting/connected/closed/error), back to Machines. Online
  Machines rows are now tap-to-open; offline/disabled rows are inert. `lib/api.getPtyToken()`.
  Router: `/machines/:id` = Terminal (no tab bar); everything else = AppShell + tabs.

  **Tests:** hub `node --test` +7 (pty token single-use/expiry, buildCommand hub/mac/linux
  shapes, originAllowed) = 17 hub. Frontend 15 Vitest (Machines test now router-wrapped).
  WS reject paths verified locally (403/401/404). Build clean.

  **Verified end-to-end on the hub (real tailnet):** headless WS client → `device=hub`
  (local tmux) AND `device=macbook-pro` (hub → ssh → Mac → tmux) both ran `echo <marker>`
  and streamed the output back. node-pty + ws compiled on the hub; deployed, v0.4.0 live.
  Remaining: interactive iPhone confirmation (tap MacBook Pro → type in the terminal).
