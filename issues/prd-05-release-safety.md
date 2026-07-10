# PRD — Release Safety: Preflight, Tests, Semver & Release Warden

Covers grill-me items **#27** (test releases locally before pushing tags), **#28** (automated
tests across the app), **#26** (versioning/release/docs agent), **#11** (consolidate scripts),
**#29** (semver).

Builds on the existing setup: `.github/workflows/release.yml`, `RELEASING.md`,
`companion-module/VERSIONING.md`, and the current vitest suites (good unit coverage of `src/core`,
`src/storage`, `src/youtube` (mocked), `companion-module/src/transform`, `web/src/lib`).

---

## 1. Reality: you cannot fully test a Windows release on Linux

The release artifact is a **Windows NSIS installer + portable exe**; you develop on **Fedora**.
`act` cannot run `windows-latest` jobs, and electron-builder Windows-on-Linux needs a flaky
Wine+mono toolchain. So the strategy is **catch ~90% locally, prove the rest remotely without
publishing** — not chase a perfect local Windows build.

### 1.1 Local `preflight` (#27, #11)

A single root script that mirrors **everything CI does except the OS-specific packaging**, so a
tag push almost never surprises you:

```
npm run preflight
  → typecheck            (server)
  → typecheck:electron   (desktop)
  → test                 (all workspaces + companion via companion:test)
  → build:all            (server + web)
  → companion:package    (re-runs the package.json/manifest.json version-sync guard)
  → electron-builder --dir   (pack without an installer — catches builder config/globs errors)
```

- Runs in seconds-to-a-minute, no Wine. The `--dir` pack is the key addition — it exercises the
  electron-builder `files`/`asarUnpack` config that only otherwise fails in CI.
- After the monorepo move (PRD-04) these become workspace-aware; consolidating them here satisfies
  **#11** (all common commands in root `package.json`).

### 1.2 Remote dry-run

`workflow_dispatch` already builds both artifacts **without publishing** (see `release.yml` —
the `release` job is gated on `startsWith(github.ref, 'refs/tags/')`). Formalize it in the flow:
**run the workflow manually and confirm green before tagging.** This is the real Windows build,
just not a Release.

### 1.3 Release smoke test

Add a post-build smoke check (local `preflight` optional stage + a CI step): **boot the built
server (`node dist/server.js` / packaged server) and assert `GET /health` returns 200** with the
expected shape. Catches "it builds but won't boot" before an operator does.

---

## 2. Automated tests (#28) — fill the integration gap

Unit coverage is already good. The gap is **integration** and a **release smoke**; heavy e2e is
deferred.

### 2.1 Route integration tests (new)

- **supertest** (or `app`-level `fetch`) against the express routers with a **mocked YouTube
  client**, covering the real HTTP surface: `/api/action/*` (preset, update, privacy, undo,
  refresh), `/api/feedback/*`, `/api/dashboard/*`, `setup`, `settings`, `streams`, `presets`.
- Assert the **PRD-01 §7 contract**: action endpoints **always return HTTP 200** with
  success/error in the body; error codes map correctly (`INVALID_PRESET`, `MISSING_TEMPLATE_VARS`,
  `BUSY_TRY_AGAIN`, `SERVICE_DISABLED`, auth/quota mapping from `mapYouTubeError`).
- Cover the **dual-alias** guarantee: `/api/action/preset` and `/api/dashboard/action/preset` hit
  the same handler (cross-refs the route-dedupe decision in the hygiene cluster, #12).

### 2.2 Release smoke test (new)

- Boot the built server, hit `/health`, assert 200 + shape. Runs in `preflight` and in CI after
  the desktop build.

### 2.3 Explicitly deferred

- Web component tests (vitest + testing-library on `PresetForm`, fill flow).
- Full Playwright / Electron e2e.
- Revisit if regressions start slipping through integration.

---

## 3. Semver discipline (#29)

Already tag-driven semver (`v2.0.0`). Gap: the **desktop app** has no written bump rule, unlike
`companion-module/VERSIONING.md`. Add a short desktop-app semver rule to `RELEASING.md`:

- **patch** — bug fix / internal change, no user-visible behavior change.
- **minor** — new dashboard/server feature, new endpoint, backward-compatible.
- **major** — removed/renamed endpoint or a breaking change to the Companion-facing contract
  (coordinate with a companion-module major + upgrade script).

The two versions stay **independent** (desktop = git tag; companion = in-repo files) — this PRD
only documents the desktop rule, it does not couple them.

---

## 4. Release Warden agent (#26) — advisory

A `.claude/agents/release-warden.md` subagent, **invoked before tagging**, that **audits and
reports** (does not edit):

- Did anything under `companion-module/` change without a version bump? Are `package.json` and
  `manifest.json` in sync? Is an upgrade script present for any rename/removal?
- Do `README.md`, `companion/HELP.md`, `public/guide.html` reflect the behavior changes in the
  diff since the last tag? (Flags stale docs — cross-refs the docs cluster.)
- What semver bump does the diff imply (per §3 and VERSIONING)? Recommend it.
- Is `preflight` green and `main` pulled?

Output is the **RELEASING.md checklist, filled in** with pass/flag per item. The human runs the
actual `git tag`. Advisory by design — release-critical edits keep a human gate.

Follows a **vertical-slice** model: the warden is meant to run per shippable slice, keeping
version + docs continuously current rather than in a big pre-release scramble.

---

## 5. Deliverables

- `npm run preflight` (root) — §1.1.
- Release smoke test — §1.3 / §2.2.
- Route integration test suite with mocked YouTube — §2.1.
- Desktop-app semver rule appended to `RELEASING.md` — §3.
- `.claude/agents/release-warden.md` — §4.
- CI: add the smoke step; document `workflow_dispatch`-before-tag in `RELEASING.md`.

## 6. Out of scope

- Wine-based local Windows builds (rejected — flaky toolchain for marginal gain).
- Web component + full e2e suites (deferred).
- Coupling desktop and companion versions.
- Code signing the exe (separate concern; noted in RELEASING.md already).
