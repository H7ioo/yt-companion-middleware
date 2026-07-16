# Changelog

All notable changes to the desktop app and the middleware. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this file is **generated** from the
Conventional Commit history by `npm run changelog` — edit the commits, not this file.

## [2.2.2-nightly.20260714.1] - 2026-07-15

_No user-facing changes._

## [2.2.1] - 2026-07-15

### Fixed

- **desktop:** bundle Arabic font so button PNGs render when packaged
- **server:** exit cleanly when listen port is taken

## [2.2.0] - 2026-07-13

### Added

- **desktop:** update-feed release notes on the banner
- **desktop:** in-app What's New + update banner (issue 040)
- **release:** generate CHANGELOG.md from Conventional Commits (issue 039)
- **desktop:** streaming-safe auto-update via electron-updater (issue 038)
- **docs:** interactive Stream Deck layouts guide page (issue 037)
- **docs:** split guide + API console into topic pages (issue 035)
- **release:** advisory release-warden agent (issue 034)
- **release:** route integration tests + boot smoke test (issue 032)
- **release:** npm run preflight — local mirror of CI (issue 031)
- **companion:** last_error variable for failed actions (issue 029)
- **companion:** enforce checkJs + JSDoc on the module (issue 028)
- **web:** stream binding as dropdown in both forms (issue 025)
- **web:** copy fill-route URL per preset row (issue 024)
- **web:** self-host Archivo display font (issue 022)
- **shared:** canonical UX vocabulary glossary (issue 021)
- **observability:** dashboard health explainer (issue 020)
- **observability:** offline firewall-guidance panel + rail distinction (issue 019)
- **observability:** activity logger ring buffer + dashboard panel (issue 018)
- **companion:** thread offline health state through module (issue 017)
- **health:** offline state + network-error classification (issue 016)
- **auth:** reauth banner on auth_error — inline reconnect / settings route (issue 015)
- **auth:** settings page — connection status + Connect/Reconnect/Disconnect (issue 014)
- **auth:** override-credentials flow — connect with your own OAuth client
- **auth:** in-app YouTube OAuth flow with in-process client rebuild
- **desktop:** build-time inject bundled OAuth client (issue 011)
- **desktop:** move electron -> packages/desktop (PRD-04 stage 5)
- **server:** move server -> packages/server (PRD-04 stage 4)
- **web:** move web -> packages/web (PRD-04 stage 3)
- **shared:** extract @app/shared contract to kill web/server drift (PRD-04 stage 2)

### Changed

- **web:** idle dashboard polls are no-ops
- **ux:** bind every surface to the health glossary

### Fixed

- **ci:** checkout before artifact download in publish job
- **ci:** install companion-module deps in checks job
- **server:** reset quota warn latch at day rollover
- **server:** classify host/route outage codes as network
- **server:** refresh returns full dashboard state
- **companion:** drop legacy "Refresh cache" label (issue 026)
- **guide:** correct PNG size to 288×288, wrap API text in flow cards (issue 023)
- **desktop:** write generated oauth on Windows CI (issue 011)
- **ci:** mark pre-release tags as prerelease so rc builds don't claim Latest

### Documentation

- **issues:** PRD-10 + PRD-11 from branch code review
- **readme:** rewrite as an audience router (issue 036)
- **release:** desktop-app semver rule in RELEASING.md (issue 033)
- **routes:** frame action-route split as by-caller, not legacy (issue 027)
- **issue-022:** record packaged-asar font verification
- **issues:** close 011 — bundled OAuth client injection proven in CI
- **issues:** close 010 — monorepo release pipeline proven in CI (PRD-04 stage 6)
- **ci:** repoint release pipeline docs for packages/* layout (PRD-04 stage 6)
- **issues:** add PRDs 03-09 and 36 tracer-bullet issues

## [2.1.0] - 2026-07-10

### Added

- Windows desktop app + CI release pipeline
- kill-switch actions, drag-drop presets, simpler build workflow
- add connection-check action; fix manufacturer name
- WebSocket transport + parity for Companion module
- Companion module for Arabic title/label images + guide routes
- Arabic-safe button labels + title PNGs for Companion
- **ws:** resync state on inbound frame and heartbeat
- add dashboard API kill-switch + Esc-to-close modals
- **web:** bidi text, preset fallback field, session refresh
- **web:** show inherited default on presets; proxy /guide in dev
- **auth:** drop Bearer auth, serve LAN-only unauthenticated (issue 004)
- **web:** companion redirect deep-link flow (issue 003)
- **web:** fill popup for templated presets (issue 002)
- **templates:** resolve preset {vars} + accept vars on trigger endpoint (issue 001)

### Fixed

- **ci:** stop electron-builder auto-publish on tag builds
- **ci:** install web deps in release build; document release/tag flow
- supersample button PNGs for sharper text
- make module packaging actually build
- add guide and docs to the docker

### Documentation

- add import-module-package install path
- full setup + reference guide for Companion module
- reformat and expand operator manual
- add operator manual with Companion setup guide
- check off completed acceptance criteria for issues 001, 004
