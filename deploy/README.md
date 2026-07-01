# Hub deployment

The hub (Oracle Ubuntu) runs the Node server as a **systemd service** (`cloud-claude-hub`) so it
survives crashes and reboots. tailscale serve fronts it as tailnet-only HTTPS.

## Install the service (one-time)
```bash
# from the repo on the hub (~/cloud-claude):
sudo cp deploy/cloud-claude-hub.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cloud-claude-hub
```

## Native modules
The hub uses two native addons — `node-pty` (terminal relay) and `better-sqlite3` (Sprint 5
timeline). Both compile on the hub (needs `build-essential`). After a `hub/package.json` dependency
change, run `npm install` in `hub/` on the hub (node 20) so the addons rebuild before restart.

## Deploy an update
Build the frontend locally, ship `frontend/dist` (atomic swap) + changed `hub/` files, then:
```bash
sudo systemctl restart cloud-claude-hub   # supervised restart; auto-recovers if it crashes
systemctl status cloud-claude-hub --no-pager
curl -s localhost:8787/healthz
```
Logs: `journalctl -u cloud-claude-hub -f` (or `~/cloud-claude/hub.log`).

Front (once): `sudo tailscale serve --bg 8787` → `https://cloud-claude-hub.<tailnet>.ts.net/`.
