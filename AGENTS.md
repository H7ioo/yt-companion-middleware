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

## General

- Conventional Commits. End commit messages with the `Co-Authored-By` trailer used across the repo.
- Keep the SDK-free helpers in `companion-module/src/transform.js` unit-tested (TDD) —
  add behaviour there first, then wire it into `main.js`.
