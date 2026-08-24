# Commit Log — 2026-07-26 · worktree isolation

- `chore: ignore isolated implementation worktrees`
  Ignore the project-local `.worktrees/` directory before creating the v1 implementation
  worktree, preventing nested checkout contents from entering repository status or commits.
