# cloud-claude collector

Device-as-sensor. Runs periodically on a device (MacBook Pro for v1a), scans local git repos +
emits a heartbeat, and pushes the events to the hub's `POST /ingest`. It is a **periodic launchd
job** (one scan per run, then exits) — not a resident daemon, so a crash just means the next run
picks up where the last watermark left off.

## What it captures (v1a)
- `commit_seen` — each new commit since the last scan (per configured repo).
- `heartbeat` — one per run ("this device is alive").

`session_observed` (claude/codex/tmux sessions) is v1b, after a process-scan spike.

## Setup
1. Add an `ingestToken` to the device's entry in the hub's `devices.json` (gitignored), e.g.
   `openssl rand -hex 32`. Restart the hub so it loads the token.
2. On the device, create the local config (never committed):
   ```bash
   mkdir -p ~/.cloud-claude-collector
   cp collector/config.example.json ~/.cloud-claude-collector/config.json
   # edit: hubUrl, deviceId (matches devices.json id), ingestToken (matches above), repos[]
   ```
3. One manual run to verify:
   ```bash
   node collector/src/index.js        # prints a JSON run_done line
   curl -s "$HUB/timeline?limit=5" --cookie "cc_session=..."   # (or check from the phone)
   ```

## Install the launchd agent (macOS, per-user)
```bash
NODE=$(command -v node)
INDEX="$(pwd)/collector/src/index.js"
LOG="$HOME/.cloud-claude-collector/collector.log"
PLIST="$HOME/Library/LaunchAgents/com.cloud-claude.collector.plist"

sed -e "s#__NODE__#$NODE#" -e "s#__INDEX__#$INDEX#" -e "s#__LOG__#$LOG#" \
  deploy/com.cloud-claude.collector.plist > "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"          # RunAtLoad fires one scan immediately
tail -f "$LOG"                    # watch run_done lines every ~180s
```
Uninstall: `launchctl unload "$PLIST" && rm "$PLIST"`.

## State (local, gitignored)
`~/.cloud-claude-collector/`:
- `config.json` — hubUrl, deviceId, **ingestToken (secret)**, repos.
- `state.json` — per-repo watermark (last HEAD reported) + the outbox (events awaiting the hub).
  Written atomically (tmp + rename). Delete it to re-baseline (first-run rules apply: no backfill).

## Behavior notes
- **First run / new repo:** baselines at HEAD and emits nothing (no history backfill).
- **Hub down:** events queue in the outbox and flush on a later run.
- **Rebase / gc rewrote history:** re-baselines to HEAD and emits nothing (logged `git_rebaselined`).
