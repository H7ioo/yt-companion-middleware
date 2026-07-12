# Releasing

This repo ships **two independently-versioned things**. A release touches one or both, and each
has its own version rule. Read this before cutting a release — skipping a step means shipping a
build nobody can tell is new.

| Module | Version lives in | Bumped by | Shipped as |
|---|---|---|---|
| **Desktop app** (Electron installer + portable exe) | the **git tag** (`v2.1.0`) | pushing the tag | `.exe` attached to the GitHub Release |
| **Companion module** | `companion-module/package.json` **and** `companion/manifest.json` (must match) | `npm run companion:bump` | `.tgz` attached to the GitHub Release |

The `Release` workflow ([.github/workflows/release.yml](.github/workflows/release.yml)) builds both
and publishes the Release. It runs on any pushed `v*` tag.

## Before you tag: bump what changed

Whether or not a given release changes the Companion module, **decide deliberately** — don't tag on
autopilot.

- **Changed anything under `companion-module/`?** You **must** bump the module version in the same
  commit, per [companion-module/VERSIONING.md](companion-module/VERSIONING.md). Companion only
  treats a re-imported `.tgz` as a new build when its `manifest.json` version changes; ship a
  behaviour change at the old version and operators silently keep the old build. Renames/removals
  also need an upgrade script. The build guard fails if `package.json` and `manifest.json` drift.

  ```bash
  npm run companion:bump patch|minor|major   # from repo root, same PR as the change
  npm run companion:test && npm run companion:check
  ```

- **Only changed the app/server/dashboard?** No file edit needed for the desktop version — the CI
  build stamps it from the tag you push. But pick the tag with semver intent, per the rule below,
  so the exe is named for a real version.

## Picking the desktop version: the semver rule

The Companion module has had a written bump rule since day one; the desktop app has not, and "the
tag is just whatever number felt right" is how a breaking release ships as a patch. The rule:

| Bump | When | Example |
|---|---|---|
| **patch** (`v2.1.0` → `v2.1.1`) | Bug fix, copy tweak, dependency bump, internal refactor. Nothing an operator can see except that a bug is gone. | A health lamp showed `degraded` when it should have shown `offline`. |
| **minor** (`v2.1.1` → `v2.2.0`) | A new, backward-compatible capability: a new dashboard feature, a new API endpoint, a new optional field. Everything that worked before still works, unchanged. | Added `GET /api/dashboard/logs`. |
| **major** (`v2.2.0` → `v3.0.0`) | A break in the contract someone else depends on: an endpoint **removed or renamed**, a request/response shape reshaped, or any change that makes an existing Companion button (or a hand-rolled HTTP integration) stop working. | Renamed `/api/action/preset`, or dropped a field from the feedback payload. |

**A major is a coordinated release, not a solo one.** A Companion-facing break means the module has
to change too — so it needs a **companion major bump plus an upgrade script** in the same PR, per
[companion-module/VERSIONING.md](companion-module/VERSIONING.md), or operators' existing buttons
break silently on re-import. Never ship a desktop major that breaks the API without doing the
companion side in the same release.

**The two versions are independent.** The desktop version lives in the git tag; the companion
version lives in `companion-module/package.json` + `companion/manifest.json`. They are not kept in
lockstep and are not expected to match — a desktop `v2.4.0` may happily ship alongside a companion
`1.2.0`. Bump each for its own reasons; the only coupling is the major-break coordination above.

Pre-release tags work as expected: anything with a hyphen (`v2.2.0-rc.1`) publishes as a GitHub
pre-release rather than claiming "Latest".

## Before you tag: preflight

```bash
npm run preflight          # add --no-pack to skip the slow electron pack
```

One command, mirroring everything CI does **except the OS-specific packaging** — typecheck (server,
companion, electron entry), the full test suite, `build:all`, the **release smoke test**,
`companion:package` (which re-runs the version-sync guard), and an `electron-builder --dir` pack. It
fails fast on the first broken step and needs no Wine: the `--dir` pack targets the host OS, but it
still exercises the electron-builder `files`/`asarUnpack` globs, which is the config that otherwise
only fails on a tag push.

The smoke test (`npm run smoke`, also runnable on its own after `build:all`) boots the **built**
server — once with no credentials (setup mode) and once with dummy ones (the full route table) — and
asserts `GET /api/feedback/health` answers 200 with the right shape. It is the only step that runs
the shipped `dist/`, so it is what catches a build that compiles but won't boot. The same three
checks — typecheck, tests, smoke — run as the `checks` job in CI, and the desktop/companion builds
are gated on them.

What preflight **cannot** catch is the Windows build itself. Prove that remotely without publishing:
run the `Release` workflow via **workflow_dispatch** and confirm it's green (see the note below) —
then tag.

## Cut the release

1. Land all changes on `main` (including any `companion:bump`).
2. Pick the next version. Tags are `v<semver>`, e.g. `v2.1.0`.
3. Tag and push:

   ```bash
   git checkout main && git pull
   git tag v2.1.0
   git push origin v2.1.0
   ```

4. CI (`Release` workflow) then:
   - **checks** job (ubuntu-latest): typecheck, the full test suite, and the release smoke test.
     Both build jobs below are gated on it, so a red test never becomes a Release.
   - **desktop** job (windows-latest): stamps the app version from the tag, builds the installer
     + portable exe.
   - **companion** job (ubuntu-latest): packages the module `.tgz` (re-checks version sync).
   - **release** job: publishes a GitHub Release with both artifacts + generated notes.

5. Watch it: `gh run watch` (or the Actions tab). Grab the exe and `.tgz` from the Release page.

## Notes

- **The Windows build only runs in CI** — `preflight` packs for the host OS, so the NSIS/portable
  targets themselves are never exercised on Linux. Don't let the first tagged run be their smoke
  test: `workflow_dispatch` first.
- **The exe is unsigned** — Windows SmartScreen shows a "run anyway" prompt on first launch until a
  signing cert is added.
- **`workflow_dispatch`** (manual run from the Actions tab) builds both artifacts but does **not**
  publish a Release — use it to test the build without cutting a release.
- **Re-releasing a version**: delete the tag and Release first (`git push origin :refs/tags/v2.1.0`
  and delete the GitHub Release), then re-tag. `npm version --allow-same-version` in CI tolerates a
  re-run of the same tag.

## Release checklist

Claude Code can fill this in for you: the **`release-warden`** agent
([.claude/agents/release-warden.md](.claude/agents/release-warden.md)) audits the diff since the
last tag — companion version sync, upgrade scripts, doc freshness, the implied semver bump,
preflight/`main` state — and reports this checklist with a verdict per item. It is **advisory**: it
never edits and never tags. Run it per shippable slice, not just before a release.

- [ ] Companion module changed? → `companion:bump` in the same PR, versions in sync, tests pass.
- [ ] Upgrade script appended for any Companion rename/removal.
- [ ] Docs (`README.md`, `companion-module/companion/HELP.md`, `packages/server/public/guide/`) reflect behaviour changes.
- [ ] `main` is green and pulled locally.
- [ ] `npm run preflight` is green.
- [ ] `workflow_dispatch` run of `Release` is green (the real Windows build, no publish).
- [ ] Desktop bump chosen per the semver rule above (a Companion-facing break = major, and a
      companion major + upgrade script in the same release).
- [ ] Tag is `v<semver>` and pushed.
- [ ] CI `Release` run is green; exe + `.tgz` are on the Release page.
