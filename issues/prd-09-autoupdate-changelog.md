# PRD — Electron Auto-Update & Changelog (GitHub + in-app)

Covers two follow-up requests: **Electron automatic updates** and a **changelog surfaced both on
GitHub and inside the app**. The two interlink — the update prompt shows the changelog.

Builds on `.github/workflows/release.yml`, `package.json` (electron-builder config),
`electron/main.mjs`, and the tag-driven release flow (`RELEASING.md`).

---

## Part A — Auto-update

### A.0 Why it doesn't work today

- No `electron-updater` dependency.
- `release.yml` builds with `--publish never` and uploads **only `release/*.exe`**, **explicitly
  skipping `latest.yml` and `*.blockmap`** — the exact files electron-updater consumes. Auto-update
  is impossible by construction until this changes.
- **NSIS installer supports auto-update; the portable exe does not.** Portable users never
  auto-update (documented, not fixed).

### A.1 Update behavior — streaming-safe (chosen)

This is a live-streaming tool: an updater must **never restart the app mid-stream**.

- On launch, `electron-updater` checks GitHub for a newer version (`autoDownload` on, but
  **`autoInstallOnAppQuit` OFF**).
- If found: show a **non-blocking "Update available (vX.Y.Z)" banner/tray affordance** with the new
  version's changelog (Part B), download in the background.
- Install happens **only** when the operator clicks **"Install & restart"** (`quitAndInstall`).
  Never automatic, never on quit.
- Failures (offline, GitHub unreachable) are silent-but-logged (ties to PRD-06 logging) — the app
  keeps running on the current version.

### A.2 Publish + build changes

- Add `electron-updater` (runtime dep) and configure the electron-builder **`publish` provider =
  `github`** (owner/repo). This makes the build emit `latest.yml` + blockmaps.
- `release.yml`: **stop skipping `latest.yml` / `*.blockmap`** — upload them alongside the `.exe`
  and attach them to the GitHub Release so `electron-updater` can find the feed. Keep the
  `release` job as the publisher (still no electron-builder auto-publish; artifacts flow through
  the existing download→`softprops/action-gh-release` step, now including the update metadata).
- Provider = **GitHub Releases** (already the publish target). Portable target stays but is
  excluded from the update feed.
- **Signing:** remain **unsigned** for now (SmartScreen "run anyway" persists; electron-updater
  works unsigned). Note code-signing as future hardening — it also removes the update warning.

### A.3 Interaction with releases

- Auto-update only makes sense once a release carries `latest.yml`; the **Release Warden**
  (PRD-05 §4) checklist gains: "release includes `latest.yml` + blockmap for the installer."
- The `preflight`/`--dir` pack (PRD-05) can't validate the update feed; the first real tagged
  release after this lands is the smoke test (call it out, like the existing Windows-in-CI note).

---

## Part B — Changelog (GitHub + in-app)

### B.1 Source of truth — auto-generated from Conventional Commits (chosen)

- Generate **`CHANGELOG.md`** (Keep a Changelog format) from commit history at release time using a
  Conventional-Commits tool (e.g. `conventional-changelog` or `release-please`). You already
  mandate Conventional Commits (AGENTS.md), so this is zero extra author burden and **one source**
  feeding both GitHub and the app.
- The generated notes replace/augment `generate_release_notes` so the **GitHub Release body** and
  `CHANGELOG.md` agree.
- Grouped by type (feat/fix/…), stamped with the release version + date.

### B.2 In-app display — bundled What's New + update-prompt notes (chosen)

- **Bundle `CHANGELOG.md`** into the Electron build (add to electron-builder `files`) so the app
  always has the changelog for the exact version it's running — **works offline**.
- **"What's New" panel:** on first launch after an update (detect version change vs a stored
  last-seen version), show the current version's changelog section. Also reachable on demand
  (e.g. from Settings / an About entry).
- **Update banner notes:** the "Update available" banner (Part A.1) shows the **new** version's
  changelog section so the operator sees what they'd get before installing.
- Both read from the single bundled/generated changelog — no runtime GitHub fetch.

### B.3 Semver linkage

- The changelog's version headings come from the release tag (desktop) per the semver rule in
  PRD-05 §3. Conventional-commit types map to bump intent (feat→minor, fix→patch, breaking→major),
  which the Release Warden can cross-check against the chosen tag.

---

## Deliverables

- `electron-updater` wired with launch-check, background download, **manual install only**
  (A.1), GitHub provider (A.2).
- `release.yml` emits + attaches `latest.yml` + blockmaps; provider configured (A.2).
- Auto-generated `CHANGELOG.md` from Conventional Commits, feeding GitHub Release notes (B.1).
- Bundled changelog + "What's New" panel + update-banner notes (B.2).
- Release Warden checklist items for update metadata + changelog freshness (A.3, B.3).
- Docs: `RELEASING.md` note that only the installer auto-updates and the first tagged release is
  the update-feed smoke test; README end-user note on updates (Windows) vs Docker (Linux).

## Out of scope

- Code signing (future hardening; also fixes the SmartScreen + unsigned-update warning).
- Auto-update for the portable exe or the Linux/Docker path (installer-only).
- Delta/differential-only optimizations beyond electron-builder's default blockmaps.
- Auto-install on quit / silent updates (rejected — unsafe mid-stream).
