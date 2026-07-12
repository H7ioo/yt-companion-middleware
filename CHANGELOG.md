# Changelog

All notable changes to the desktop app and the middleware. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this file is **generated** from the
Conventional Commit history by `npm run changelog` — edit the commits, not this file.

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
