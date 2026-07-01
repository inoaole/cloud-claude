# Development Workflow

cloud-claude is built in vertical sprints ([SPRINTS.md](SPRINTS.md)). Each sprint is
one loop iteration: **branch → implement → review → commit → merge**.

## Branch model

- `main` — stable, always integrable. No WIP committed directly.
- `sprint/<n>-<slug>` — one branch per sprint (e.g. `sprint/0-bootstrap`).

## Per-sprint loop

1. `git switch -c sprint/<n>-<slug>` off the latest `main`.
2. Implement the sprint's checklist in [SPRINTS.md](SPRINTS.md).
3. Review the branch diff with `/code-review` (gstack). Address findings.
4. Commit (see convention below) and tick the sprint's checkboxes.
5. `git push -u origin sprint/<n>-<slug>` and open a PR (`gh pr create`).
6. Merge to `main` once the review is clean (`gh pr merge --squash` or `--no-ff`).

The PR trail is intentional — it keeps the review history visible for the public /
portfolio version of the repo.

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<scope>): <imperative subject, <=72 chars>

<what changed and why — not how>
```

- **types**: feat, fix, refactor, docs, test, chore, perf
- **scope**: `sprint-<n>` or a module name (`hub`, `auth`, `pty`, `pwa`)

Example: `feat(sprint-0): scaffold hub server and PWA shell`

## Secrets

Never commit secrets — the repo goes public. All config comes from environment
variables; `.env.example` is the tracked template and `.env` is gitignored. Device
hosts and keys live in `devices.json` (gitignored); `devices.example.json` shows the
shape.
