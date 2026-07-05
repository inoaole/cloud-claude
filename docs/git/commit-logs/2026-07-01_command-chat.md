# Commit Log — 2026-07-01 · Chat mode + two-mode console (feature/v0.6.0/command-chat)

- `feat(machines): two-mode device console — Chat (command blocks) + Terminal`
  Restores the original two-mode design (memory 2026-06-29: Terminal + Agent/chat; DESIGN.md:618
  segmented control). The raw phone terminal was clunky to drive one keystroke at a time, so Chat
  becomes the default; Terminal stays for live TUIs.

  **DeviceConsole** (`/machines/:id`) — full-screen, a header with back + device + status + a
  **segmented control `Chat | Terminal`**. Owns the visualViewport `--vvh` so the composer sits
  above the iOS keyboard. Renders one of two bodies.

  **Chat mode (new, default) — `screens/CommandChat.tsx` over WS `/run`:**
  - Backend `hub/src/shell.js`: a persistent non-interactive login shell on the device
    (`ssh … bash -l`, NO tty). Each command is wrapped (`{ cmd } </dev/null 2>&1` + an exit
    sentinel) so output is self-delimiting → one command = one block + exit code. `cd`/env persist
    across commands (verified: `cd /tmp` sticks). `assertSafeArg` arg-injection guard reused.
  - `server.js`: the WS upgrade handler now serves `/pty` (terminal) AND `/run` (chat) behind the
    same token + Origin + allowlist auth; `bridgeShell` spawns the shell, streams `{out}` chunks +
    `{done, exit}` per command id.
  - UI: Warp/Discord-style command blocks — `$ cmd` header (tap to re-edit), output `<pre>`
    (ANSI-stripped), footer with exit chip (✓ / ✗ N) + `~duration` (tilde honesty affordance).
    Quick-command chips + recents (localStorage), composer (autocorrect off, 16px), auto-scroll.

  **Terminal mode — `screens/Terminal.tsx` refactored to a body** (header lifted to DeviceConsole),
  cursor → Action Blue, font 14. Backend `/pty` unchanged.

  Not in scope: Agent chat (claude/codex structured, v1.5); shell interrupt/stop, concurrent caps
  (Sprint 4). Known: a stray profile line can appear in the first block (cosmetic).

  Tests: hub `node --test` +6 (shell build/wrap/sentinel/id) = 24; Vitest +3 (CommandChat run →
  block, exit codes, chip) = 18. Build clean. Deployed + verified end-to-end on the hub: `device=
  macbook-pro` ran pwd/ls/cd/error with correct output + exit codes (0, 0, 127). New bundle live.
