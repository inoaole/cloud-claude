# Commit Log — 2026-07-02 · hub durability (feature/v0.6.1/hub-systemd)

- `ops(hub): run the hub as a systemd service (auto-restart + boot survival)`
  The hub was a fragile manual `setsid nohup node …` — any crash or reboot left it down
  (tailscale serve → 502), which bit repeatedly during v0.6. Added `deploy/cloud-claude-hub.service`
  (Type=simple, User=ubuntu, WorkingDirectory=repo root so dotenv finds .env, Restart=always,
  After=tailscaled) + `deploy/README.md`. Installed + enabled on the hub. VERIFIED: killing the node
  process → systemd respawns it in ~4s (NRestarts=1), healthz recovers; `enable` = survives reboot.
  Deploys are now `sudo systemctl restart cloud-claude-hub` instead of the pkill/nohup dance.
