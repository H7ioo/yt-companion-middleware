# Agent & contributor rules

Conventions every contributor — human or AI — must follow in this repo. Keep this file short; it is
a contract, not documentation.

## Companion module versioning (hard rule)

Any change under **`companion-module/`** that alters the module's behaviour **must** include a
version bump in the **same commit/PR**. Companion decides whether a re-imported package is a new
build from the manifest version, so without a bump an operator's re-import can silently keep the old
build.

- Bump with the provided script — never edit versions by hand:
  `npm run companion:bump [patch|minor|major|x.y.z]` (from the repo root).
- It moves **both** `companion-module/package.json` and `companion-module/companion/manifest.json`
  together; a preflight fails `npm run companion:package` if they ever drift.
- **patch** = fix/refactor, **minor** = new action/feedback/variable/preset or optional config,
  **major** = a removed/renamed action/feedback/variable/config field (also append an upgrade script
  to `companion-module/src/upgrades.js` — never edit existing entries).

Full details and the end-to-end workflow: [`companion-module/VERSIONING.md`](companion-module/VERSIONING.md).

## Building the module

One command from the repo root produces the importable package — no `cd`:

```bash
npm run companion:package   # → companion-module/yt-companion-middleware-<version>.tgz
```

Other helpers: `companion:install`, `companion:check`, `companion:test`.

## Cutting a release (hard rule)

Releases are driven by pushing a `v*` git tag, which builds and publishes **both** the desktop app
(version stamped from the tag) and the Companion module `.tgz`. Before tagging: if this release
changed anything under `companion-module/`, bump the module version in the same PR first (see
above). Never tag on autopilot.

Full end-to-end flow, semver guidance, and the checklist: [`RELEASING.md`](RELEASING.md).

## Branching and stacked PRs (hard rule)

A branch is finished by opening a PR and filling in *How to test* — never by merging locally.

**A stacked child survives a merge, but not a bare branch deletion.** When the parent PR merges and
its head branch is then deleted, GitHub retargets the open children onto the parent's base. When the
parent's branch is deleted *without* its PR merging — an abandoned parent, a cleanup sweep — GitHub
**closes** the children instead, and their review threads go with them. Auto-delete-on-merge is off
in this repo (`gh api repos/:owner/:repo --jq .delete_branch_on_merge` returns `false`); branches
vanish here because someone passed `--delete-branch`, as with PR #4, merged 2026-07-08 with its
branch gone three seconds later. Merge, then delete, is the safe order. Deleting an unmerged parent
is not.

- **Retarget the child by hand before touching the parent** — `gh pr edit <n> --base main`. It is
  the reliable move whatever becomes of the parent branch.
- **Recovery, if a child was closed:** reopen it only if its head branch still exists
  (`gh pr reopen <n>`, restoring the branch first if GitHub offers it). Otherwise recover the
  commits from the local branch or `git reflog`, push them again, and open a fresh PR against
  `main`. The old review thread does not come back.

## General

- Conventional Commits. End commit messages with the `Co-Authored-By` trailer used across the repo.
- Keep the SDK-free helpers in `companion-module/src/transform.js` unit-tested (TDD) —
  add behaviour there first, then wire it into `main.js`.
