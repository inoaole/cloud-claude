# Commit Log — 2026-07-01 · Sprint 1 (feature/v0.2.0/pin-auth)

- `feat(sprint-1): hardened PIN auth + unlock screen`
  Hub: `hub/src/auth.js` (crypto-random session ids, HMAC-signed tamper-proof cookie,
  constant-time PIN compare, in-memory revocable sessions, 5-fail → 60s lockout). Routes
  `POST /auth`, `POST /logout`, `GET /auth/me` + `requireAuth` middleware; cookie is
  HttpOnly + Secure + SameSite=Strict; JSON audit log of auth events (no content). Config
  gains `HUB_PIN` + `SESSION_TTL` (parsed). PWA: PIN unlock screen (logo + dots + keypad,
  DESIGN.md language) gating the app shell; `/auth/me` on load skips unlock when already
  authed; lockout countdown surfaced. Verified locally with curl: wrong→401, correct→cookie,
  /auth/me 200(cookie)/401(none)/401(tampered), 5 fails→429.
  Remaining for Exit: deploy + set HUB_PIN on the hub + verify unlock on the phone.

- `chore(release): bump to 0.3.0 (sprint-1 merged to develop)`
  PR #2 merged. VERSION 0.2.0 -> 0.3.0 + hub/package.json. v0.3 next = migrate the PWA frontend
  to React (plan-eng-review first) and fix the iPhone bottom-tab-bar / home-indicator safe-area bug.
