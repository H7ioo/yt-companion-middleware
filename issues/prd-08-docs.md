# PRD — Documentation: Modularize, Onboarding Paths & Interactive Guide

Covers grill-me items **#8** (README: dev/build/release steps), **#17** (modularize the giant
docs), **#21** (interactive UI-layout inspiration in the guide), **#25** (download/use methods,
dev vs end-user onboarding, Windows + Linux).

Current state: `public/guide.html` (1990 lines) and `public/docs.html` (822 lines) are monolithic
static HTML served by express; `README.md` (124 lines), `RELEASING.md`, `AGENTS.md`,
`companion-module/README.md`, `companion-module/VERSIONING.md` exist.

---

## 1. Modularize the docs (#17) — split standalone HTML pages

Decision: **break the monoliths into several standalone HTML pages sharing a nav — no build step**
(lowest churn; keeps express serving static files).

- Split `guide.html` into focused pages by topic, e.g. `public/guide/`:
  `index.html` (overview), `setup.html`, `buttons.html`, `fill-flow.html`, `feedback-health.html`,
  `layouts.html` (see §3). Likewise `docs.html` into `public/docs/` sections.
- A **shared nav** (a small header/sidebar partial included on each page — inline or a tiny
  vanilla-JS include) so pages cross-link and feel like one site.
- Keep everything self-contained (inline CSS/JS, no CDN) so it works offline in Electron.
- Preserve existing anchors/links or add redirects so nothing that references the old single file
  breaks.

## 2. README + onboarding paths (#8, #25)

Rewrite `README.md` as a **router**, not a wall — send each audience down its own path, and cover
**Windows and Linux** explicitly for every OS-specific step.

### 2.1 End-user path (operators)

- **Download & run:** where releases live (GitHub Releases — the desktop app installer + portable
  exe, and the Companion module `.tgz`), what each artifact is, and which to pick.
  - Windows: NSIS installer vs portable exe; the unsigned-app SmartScreen "run anyway" note.
  - Linux: how a Linux operator runs it (Docker path — `docker-compose`, since the desktop build is
    Windows-only today; call this out honestly).
- **Connect YouTube:** the in-app OAuth flow (PRD-03) — bundled one-click vs "use my own
  credentials"; the one-time Google Cloud project steps for the override path.
- **Import the Companion module:** install the `.tgz` into Bitfocus Companion, add the connection,
  point it at the dashboard host.

### 2.2 Developer path (contributors)

- **Setup:** prerequisites (Node ≥20/22), `npm install` (workspaces post-PRD-04), env/`.env` for
  headless, the CLI token script for Docker.
- **Run:** `npm run dev` (server), `desktop:dev` (Electron), web dev server; Docker
  (`docker-compose up`).
- **Build:** `build:all`, `desktop:build`/`desktop:pack`, `companion:package`.
- **Test & preflight:** `npm test`, `npm run preflight` (PRD-05), `typecheck`.
- **Release:** point to `RELEASING.md` + `companion-module/VERSIONING.md` (don't duplicate them).
- Windows vs Linux notes wherever commands/paths differ (e.g. desktop build only produces Windows
  artifacts; Linux devs use Docker + `--dir` packs).

### 2.3 Keep specialized docs where they are

`RELEASING.md`, `VERSIONING.md`, `AGENTS.md`, `companion-module/README.md` stay as the deep
references; README links to them rather than restating. (This *is* the modularization principle
applied to the top-level docs too.)

## 3. Interactive UI-layout inspiration (#21)

Add a **`layouts` guide page** with suggested Stream Deck button arrangements, rendered as
**interactive widgets driven by mocked data — never real API calls**.

- Small inline vanilla-JS components (consistent with the no-build §1 decision) that render mock
  button faces: preset keys, live/idle state colors, the health lamp
  (`ok`/`degraded`/`offline`/`auth_error`), busy blink, the slug/title PNG look.
- Let the reader toggle mock state (go live, trigger degraded/offline, mark busy) to see how a
  layout reacts — pure client-side, no server, no quota.
- Reuse the **canonical vocabulary + colors** (PRD-07 §2, PRD-06) so the inspiration matches the
  real app exactly.

## 4. Consistency guardrail

All docs draw state names, action names, health states/colors, and PNG size (288×288, PRD-07 §8)
from the **single canonical source** (PRD-07 §2). The Release Warden agent (PRD-05 §4) audits doc
freshness against behavior changes per shippable slice, so this modular set stays current instead
of rotting.

---

## Deliverables

- `public/guide/*` and `public/docs/*` split with a shared nav, offline-safe.
- Rewritten `README.md` with distinct end-user and developer paths, Windows + Linux covered.
- Interactive `layouts` guide page (mocked data, vanilla JS).
- All docs sourced from the canonical vocabulary/colors; Release Warden keeps them fresh.

## Out of scope

- Docs-as-SPA / React (rejected — avoids coupling docs to the app build).
- A Markdown→HTML generator (rejected — avoids a new build step).
- macOS instructions (only Windows + Linux in scope, #25).
