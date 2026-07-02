# Work Log — 2026-07-01 · Planning + Infra Spike

Big planning + de-risking day. No product code yet; everything below is design,
architecture, and a proven infrastructure spike. Design artifacts live under
`~/.gstack/projects/cloud-claude/` (not in this repo).

## What happened
- **Repo hygiene:** re-created `inoaole/cloud-claude` as a clean single-commit history
  (README + legacy Discord bot + unrelated docs kept out of git; secrets env-based).
- **Vision (`/office-hours`, Builder):** pivoted from "phone remote console" to a
  **personal OS** — phone-first, self-hosted. Soul = a daily loop; differentiator =
  **device-as-sensor** (the OS auto-captures what I do across machines → growth).
- **Two planes** (the core model): **Hub plane** (daily aggregation → Today/reflection,
  device-agnostic) + **Device plane** (pick a device → terminal over WebSocket).
- **Architecture — both planes ENG CLEARED** (`/plan-eng-review` x2 + `codex` outside
  voice x2, findings folded in):
  - Hub plane: MacBook Pro launchd poller (observation events + deterministic ids) →
    hub `/ingest` → SQLite timeline → Today PWA.
  - Device plane (Terminal mode; Agent mode = v1.5): phone ⟷ WS `/pty` ⟷ hub (single
    Node proc) ⟷ ssh over tailnet → tmux. Hardening: Origin+WS token, PIN hardening,
    OSC-52 strip, spawn-not-shell, pause-not-drop backpressure, resource caps, audit log.
- **Design (`/design-consultation`):** `DESIGN.md` "Personal OS App Language" (dark, SF
  Pro + SF Mono data chips, single Action Blue, `~` estimate affordance, honest quiet).
  IA (two planes) + 10-screen wireframes + `/design-review` (B+ → A-). Hero = A "Journal".
- **Sprints:** `docs/SPRINTS.md` rewritten around modules (M0 foundation → M1 Device plane
  → M2 Hub plane → M3 polish/QA/deploy).
- **INFRA SPIKE — proven end to end on real hardware:**
  - Hub (Oracle Ubuntu, `cloud-claude-hub` <tailnet-ip>) registered on Tailscale (inoaole).
  - Finding: macOS App Store Tailscale can't run the SSH server → **Mac targets = Remote
    Login + classic SSH over tailnet + a hub key** (Tailscale-SSH-no-keys holds for Linux only).
  - Built a mini node-pty + ws server on the hub → **phone (iOS Safari) → hub WS → ssh →
    MacBook Pro tmux → interactive terminal WORKS.** The riskiest assumption is de-risked.

## Decisions locked
- v1 test device = **MacBook Pro** (Mac mini + Desktop later; Desktop is Windows, excluded).
- v1 ships **both planes** (Device plane Terminal mode + Hub plane daily loop).
- Branch model = `main` + `develop` (this commit sets it up); VERSION `0.1.0`.

## Next
Build **Sprint 0** (hub scaffold + tailnet HTTPS + hardened PIN + PWA shell) off `develop`.
