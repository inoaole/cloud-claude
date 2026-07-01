#!/usr/bin/env bash
# Front the hub over HTTPS on the tailnet (tailnet-only — never Funnel).
# Run this on the Ubuntu hub after `npm --prefix hub start`.
set -euo pipefail

PORT="${HUB_PORT:-8080}"

# tailscale serve needs root (or a configured operator). We use sudo for reliability.
# (Do NOT use `tailscale funnel` — that would expose the hub to the public internet.)
sudo tailscale serve --bg "$PORT"

NAME=$(sudo tailscale status --json | sed -n 's/.*"DNSName":"\([^"]*\)".*/\1/p' | head -1 | sed 's/\.$//')
echo "Serving :$PORT over HTTPS on the tailnet."
echo "Open on the phone:  https://${NAME}/"
sudo tailscale serve status
