#!/usr/bin/env bash
# Front the hub over HTTPS on the tailnet (tailnet-only — never Funnel).
# Run this on the Ubuntu hub after `npm --prefix hub start`.
set -euo pipefail

PORT="${HUB_PORT:-8080}"

# tailscale serve = HTTPS on the tailnet, reachable from your phone anywhere.
# (Do NOT use `tailscale funnel` — that would expose the hub to the public internet.)
tailscale serve --bg "$PORT"

echo "Serving :$PORT over HTTPS on the tailnet."
echo "Open on the phone:  https://$(tailscale status --json | sed -n 's/.*\"DNSName\":\"\\([^\"]*\\)\".*/\\1/p' | head -1)"
tailscale serve status
