# Commit Log — 2026-07-02 · public-readiness scrub (fix/v0.8.1/public-scrub)

- `fix(security): scrub real values from tracked files ahead of going public`
  Pre-public audit found one real issue and three hygiene items; all fixed:
  - The REAL hub PIN sat in a test fixture (api.test.ts) — replaced with a fake, and the
    actual PIN was ROTATED on the hub (old value in git history is now harmless).
  - Test fixtures / example configs / docs swapped real tailnet hostname, tailscale IPs,
    ssh username, and machine names for synthetic placeholders (100.64.0.x, dev, my-macbook).
  - Verified clean: work email and author emails were never present; no key/credential file
    was ever committed (checked full history); public IP absent; gitignore intact.
  147 tests green after the fixture changes. No production code touched.
