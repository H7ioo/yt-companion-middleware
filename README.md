# YouTube Live Metadata Control Middleware

A LAN gateway between **Bitfocus Companion** (Stream Deck) and the **YouTube Live Streaming API**.
It collapses YouTube's multi-step metadata rules into one-button actions — apply a preset, toggle
privacy, undo — and serves cached state back to Companion, so the keys can show live state without
spending YouTube quota.

Two ways to run it, same app inside:

| | Windows | Linux / macOS |
|---|---|---|
| **Desktop app** (double-click, tray icon, no `.env`) | ✅ installer + portable `.exe` | ❌ **Windows-only artifact** — use Docker |
| **Docker** (`docker compose up`) | ✅ | ✅ |

**Which path are you on?**

- **[I'm running the app](#operators--running-it)** — install it, connect YouTube, put it on a Stream Deck.
- **[I'm working on the code](#developers--working-on-the-code)** — build, test, release.

---

## Operators — running it

### 1. Get the app

Every build is published on the repo's **[Releases](../../releases)** page. A release carries three
artifacts:

| Artifact | What it is |
|---|---|
| `YT Companion Setup <version>.exe` | **Installer** — installs per-user (no admin), lets you pick the folder, adds a Start-menu entry. Pick this for a machine that stays put. |
| `YT-Companion-<version>-portable.exe` | **Portable** — a single file, no install, runs from a USB stick. Pick this if you can't (or won't) install software on the machine. |
| `yt-companion-middleware-<version>.tgz` | The **Companion module** — you import this into Companion itself (step 3). |

**Windows — the app is unsigned.** The first launch shows a blue *"Windows protected your PC"*
SmartScreen dialog. That is the missing code-signing certificate, not a virus warning: click
**More info → Run anyway**. It appears once per version.

**Linux (and macOS) — there is no desktop build.** The `.exe` artifacts are Windows-only; the
release page has nothing else to double-click. Run the same server in Docker instead:

```bash
git clone <this repo> && cd yt-companion-middleware
cp .env.example .env      # fill in the YT_* values — see step 2
docker compose up -d      # dashboard + API on http://<host>:8080, data in ./data
```

### 2. Connect YouTube

The app needs a Google OAuth client (Google Cloud Console → *APIs & Services* → enable **YouTube
Data API v3** → create an **OAuth client**) and a refresh token for your channel. Where those come
from differs by platform — the refresh token is stored server-side only and is never exposed to
Companion or the browser.

**Windows desktop.** Nothing to edit. The app boots into a **Connect your YouTube channel** screen:
press **Connect YouTube**, consent in the browser that opens, and it stores the token itself. If
the build has no bundled OAuth client, or you'd rather use your own, the same screen takes your
client ID + secret (register `http://localhost:53682/oauth2callback` as its redirect URI) or a
refresh token pasted by hand. Credentials live under `%APPDATA%/YT Companion/data`.

**Docker.** The in-app OAuth flow needs a desktop browser and a system tray, so a headless boot
doesn't offer it: put the credentials in `.env` instead. Get the refresh token once, from a machine
with a browser:

```bash
node packages/server/scripts/get-refresh-token.mjs   # prints YT_REFRESH_TOKEN for your .env
```

Then open `http://<host>:8080` for the dashboard: create presets, set the default category and
stream binding, and generate an API token.

### 3. Put it on the Stream Deck

Companion talks to the middleware through the **Companion module** shipped in this repo. It holds a
WebSocket to the app (instant updates, zero quota) and puts the presets, actions and state feedbacks
straight onto your keys.

1. **Get the `.tgz`** — download it from the Releases page, or build it yourself from a checkout:
   ```bash
   npm run companion:package   # → companion-module/yt-companion-middleware-<version>.tgz
   ```
2. **Companion → Modules → Import module package** → pick the `.tgz`.
3. **Connections → Add connection** → search *YouTube Live Metadata* → point it at the app's host
   and port.
4. Drag buttons from the **Presets** tab onto a page. They arrive pre-wired.

Full module reference — every action, feedback, variable, and the Arabic-safe title/slug images:
[`companion-module/README.md`](companion-module/README.md).

### Learn the app

- **Operator manual** — served by the running app at `http://<host>:8080/guide`: how targeting
  works, the dashboard, the Companion keys, suggested Stream Deck layouts.
- **API console** — at `http://<host>:8080/docs`: every route, documented, with a tester that fires
  real requests against your own server.

---

## Developers — working on the code

### Prerequisites

- **Node.js ≥ 20** (Node 22 for the Companion module).
- **Docker** — optional, only to run the container locally.
- **Windows or CI to build the desktop app.** `electron-builder --win` from Linux/macOS needs Wine;
  building on Windows (or letting the release workflow do it) is simpler. Everything else in this
  repo builds and tests on Linux, Windows and macOS alike.

### Install

One install from the repo root covers every workspace (`packages/shared`, `server`, `web`,
`desktop`). The Companion module is a **separate** package with its own lockfile.

```bash
npm install                 # all four workspaces
npm run companion:install   # the Companion module's own deps (only if you touch it)
```

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Backend on `:8080`, watching. |
| `npm --prefix packages/web run dev` | Dashboard on `:5173`, proxying `/api` to `:8080`. |
| `npm run build:all` | Compile shared → web → server into `dist/`. |
| `npm start` | Run the built server. |
| `npm test` | The full suite (vitest). |
| `npm run typecheck` | Server, Companion module (checkJs) and the shared package. |
| `npm run smoke` | Boot the **built** server, with and without credentials, and hit `/api/feedback/health`. |
| `npm run preflight` | Everything CI does except the Windows packaging — run this before tagging. |
| `npm run desktop:dev` | Build and launch the Electron app locally. |
| `npm run desktop:build` | The Windows installer + portable `.exe` into `./release`. |
| `npm run companion:package` | The importable module `.tgz`. |

### Layout

| Path | |
|---|---|
| [packages/server/](packages/server/) | Express + TypeScript API, the state cache, the YouTube client. Serves the dashboard, `/guide` and `/docs` as static files. |
| [packages/web/](packages/web/) | React + Vite dashboard. |
| [packages/shared/](packages/shared/) | The API contract, the JSON schema, and the [canonical UX vocabulary](packages/shared/GLOSSARY.md) every surface draws its wording from. |
| [packages/desktop/](packages/desktop/) | Electron shell — runs the server in-process, tray icon, first-run setup. |
| [companion-module/](companion-module/) | The Bitfocus Companion module (standalone package). |
| [issues/](issues/) | PRDs and the issue files the work is cut from. |

### Releasing

Pushing a `v*` git tag builds and publishes both artifacts. **Don't tag on autopilot** — the
desktop app and the Companion module are versioned independently, and a change under
`companion-module/` must be bumped in the same PR or operators silently keep the old build.

- The tag flow, the semver rule and the pre-release checklist: [`RELEASING.md`](RELEASING.md).
- The Companion module's bump rule and upgrade scripts:
  [`companion-module/VERSIONING.md`](companion-module/VERSIONING.md).
- The rules every contributor (human or AI) follows: [`AGENTS.md`](AGENTS.md).
