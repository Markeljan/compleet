# Releasing and npm Publishing

This repository uses [Changesets](https://github.com/changesets/changesets) for versioning, changelogs, tags, GitHub Releases, and npm publishing.

## One-time repository setup

1. In npm package settings, enable Trusted Publishing for this GitHub repository/workflow.
2. Keep `main` protected (require PRs and green CI before merge).
3. No `NPM_TOKEN` secret is required when Trusted Publishing is configured correctly.
4. Release workflow uses Node 22 and explicitly clears `NODE_AUTH_TOKEN` to avoid token fallback auth.

## Daily release workflow

1. Every user-facing change ships with a changeset file (`bun run changeset`).
2. Merge PRs to `main`.
3. The `Release` workflow automatically:
   - opens/updates a version PR when changesets are pending
   - publishes to npm when that version PR is merged
   - creates git tags and GitHub releases (for example `v0.4.1`)

## Tag and release best practices

- Let Changesets create version commits and tags; avoid manual `npm version` or manual git tags.
- Keep release commits scoped to version/changelog changes only.
- Prefer stable releases from `main`; use prereleases intentionally with Changesets pre mode when needed.

## Manual fallback (maintainer only)

```bash
bun run ci
bun run version-packages
git add -A
git commit -m "ci: version packages"
bun run release
```
