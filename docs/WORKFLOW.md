# Development Workflow

cloud-claude is built in vertical sprints ([SPRINTS.md](SPRINTS.md)) on a `main` +
`develop` branch model.

## Branch model

- **`main`** — stable / release. Only receives merges from `develop` (a released version).
  Never commit WIP directly.
- **`develop`** — integration. All sprint work lands here via PR.
- **`sprint/<n>-<slug>`** (or `feature/<slug>`) — one branch per sprint/feature, cut from
  `develop`, merged back to `develop` via PR.
- **`hotfix/<slug>`** — cut from `main` for urgent production fixes; merged to `main` and
  back to `develop`.

```
main ─────────●───────────────────●──────   (releases only)
               \                  /
develop ──●──●──●──●──●──●──●──●──●────────   (integration; VERSION bumps here)
              \        /   \      /
               feature      sprint/…         (PR → develop)
```

## Per-sprint loop

1. `git switch develop && git pull` then `git switch -c sprint/<n>-<slug>`.
2. Implement the sprint's checklist in [SPRINTS.md](SPRINTS.md).
3. Review the branch diff with `/code-review`. Address findings.
4. Commit — **every commit leaves a commit-log entry** (see below) and ticks the sprint's
   checkboxes.
5. `git push -u origin sprint/<n>-<slug>` → `gh pr create --base develop`.
6. Merge to `develop` once review is clean → **bump `VERSION`** (see Versioning).

Release: when a version on `develop` is ready to ship, open `gh pr create --base main --head develop`.

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<scope>): <imperative subject, <=72 chars>

<what changed and why — not how>
```

- **types**: feat, fix, refactor, docs, test, chore, perf
- **scope**: `sprint-<n>` or a module (`hub`, `auth`, `pty`, `pwa`, `collector`, `pwa`)
- Example: `feat(sprint-0): scaffold hub server and PWA shell`

### Commit log (every commit)

Each commit also gets a short log entry appended under `docs/git/commit-logs/` as
`YYYY-MM-DD_<short-slug>.md` — one line per commit: `<sha> <type>(<scope>): <subject>`
plus a sentence of context. This keeps a human-readable trail alongside git history.

## Versioning

- `VERSION` file at repo root holds the current semver (starts at `0.1.0`).
- **Bump `VERSION` on every PR merge into `develop`**: `patch` for fixes/chores, `minor`
  for a completed sprint/feature. `major` stays 0 until v1 ships (develop → main).
- The `develop → main` release PR is where a `0.x` line is cut.

## Secrets

Never commit secrets — the repo goes public. All config comes from environment variables;
`.env.example` is the tracked template and `.env` is gitignored. Device hosts / keys live in
`devices.json` (gitignored); `devices.example.json` shows the shape.
