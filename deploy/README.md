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

## Projects brief runner (PM view)

The hub never calls an LLM on a request. `hub/src/brief.js` summarises Discord and reviews this
week's PRs with `claude -p`, writing `data/briefs/<project>.json` (or `$BRIEFS_DIR`).

One-time:
```bash
# hub .env — same value as ~/penalty-bot/.env
CLAUDE_CODE_OAUTH_TOKEN=...
# projects.json — mabc entry
"schedule": { "repo": "uni-keyyy/Unikey-outline", "path": "기획/schedule.json" }
```
The bot token (`claude-bot-jh`) needs **Read** on `uni-keyyy/Unikey-outline`.

Versions come from **GitHub milestones** on the penalty-bot `repos` (title `0.1.0 — MVP` → version
`0.1.0`, due date required). Issues attached to a milestone are its features; owner = assignee,
else the author. `schedule.json` only holds the timeline's phase bands: `{ "phases": [...] }`.

Cron (every 2h):
```bash
0 */2 * * * cd /home/ubuntu/cloud-claude && /usr/bin/flock -n /tmp/cc-brief.lock /usr/bin/node hub/src/brief.js >> brief.log 2>&1
```
If the runner stops, the phone shows "요약이 갱신되지 않음" after 6 hours — never a quiet day.
