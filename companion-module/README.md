# companion-module-yt-companion-middleware

A [Bitfocus Companion](https://bitfocus.io/companion) module for the YouTube Live Metadata
Control middleware in this repo. It exists to solve one thing the Generic HTTP module can't:
**putting the middleware's Arabic-rendered title/slug PNGs onto a key** (Companion's built-in
fonts render Arabic as tofu boxes, and Generic HTTP has no image feedback).

It also exposes the middleware's state as variables, colours keys with boolean feedbacks, and
drives its `/api/action/*` bus as actions.

## Transport

The module holds a **persistent WebSocket** to `ws://<host>:<port>/api/feedback/ws` (like the OBS
module holds an obs-websocket connection). The server pushes one `state` frame on connect and one
on every meaningful change, so updates are **instant and cost zero YouTube quota** — there is no
poll interval to configure. It auto-reconnects with backoff. **Actions** stay HTTP `POST`s to the
`/api/action/*` bus; the server pushes a fresh state after each mutation, so nothing is polled.

---

## 1. Prerequisites

- The **middleware is running and reachable** from the machine running Companion — e.g.
  `http://<APP_IP>:8080` opens the dashboard. (See the repo root README for running it via Docker
  or `npm run dev`.)
- **Companion 3.x or newer** (this module targets module-api `~1.11`, Node 22 runtime).
- **Node.js ≥ 22** on the machine where you prepare the module folder (only needed to run
  `npm install` inside `companion-module/` once).
- If your action bus is protected, the **Bearer token** the middleware expects. On a trusted LAN
  it is usually left blank.

---

## 2. Install

Since Companion 4.0 modules are plugins you install independently. There are two ways to get this
one in — **Method A (import a package)** is the simplest for an operator; **Method B (developer
modules path)** is for iterating on the module's code.

### Method A — Import a module package (recommended)

Build a package file once, then import it from the Companion UI. No restart needed.

1. **Build the package** (installs deps incl. the build tool, then bundles a `.tgz`):
   ```bash
   cd companion-module
   npm install
   npm run package   # runs companion-module-build
   ```
   This writes **`yt-companion-middleware-<version>.tgz`** into the folder (e.g.
   `yt-companion-middleware-1.0.0.tgz`).
2. In Companion open **Modules → Import module package** and select that `.tgz`. (Companion's file
   dialog labels it a module package.) The module appears in the list immediately.

> Offline installs of *many* modules at once use the separate **Import offline module bundle**
> feature with a versioned bundle from the Bitfocus website — that's not needed for this single
> module.

### Method B — Developer modules path (for development)

Companion loads unreleased modules from a **Developer modules path** — a folder you nominate that
holds one subfolder per module, and it hot-reloads on change.

1. **Fetch the module's dependencies**:
   ```bash
   cd companion-module
   npm install
   ```
2. **Put the module where Companion can see it.** Pick (or create) a folder to be your developer
   modules path, e.g. `~/companion-dev-modules/`, and place or symlink this whole
   `companion-module` directory inside it:
   ```bash
   mkdir -p ~/companion-dev-modules
   ln -s "$(pwd)" ~/companion-dev-modules/yt-companion-middleware
   ```
   > The subfolder name is up to you; Companion identifies the module by its `manifest.json`, not
   > the folder name.
3. **Point Companion at that folder.** In the Companion admin UI open
   **Settings → Developer modules path** and set it to `~/companion-dev-modules` (the *parent*
   folder, not the module folder). Save.
4. **Restart Companion** so it rescans the developer path. Later code edits reload automatically.

If either method fails, check Companion's log (**Log** tab) for a line mentioning
`yt-companion-middleware` — a missing `npm install`, a bad path, or an unbuilt package is the
usual cause.

---

## 3. Add and configure the connection

1. **Connections → Add connection**, search **yt-companion-middleware**, and add it.
2. Fill in the config fields:

   | Field | Value |
   |---|---|
   | **Middleware base URL** | The dashboard host, e.g. `http://192.168.1.50:8080` — no trailing path. HTTPS is fine; the module derives `wss://` automatically. |
   | **Bearer token** | Leave blank on a trusted LAN. Set it only if the action bus is protected; it is sent as `Authorization: Bearer <token>` on the WS handshake and every action POST. |

3. Watch the connection's status pill. It goes **Connecting → OK** once the WebSocket is up. If it
   sits on **Connection failure**, the base URL is wrong/unreachable or the token was rejected —
   fix it and the module reconnects on its own (or reopen the config to force a reconnect).
4. Confirm variables populate: on any button set the text to `$(ytmeta:display_label)` and it
   should show the active label within a second.

> **Editing presets later?** The preset / category / stream **dropdowns are snapshotted** when the
> connection starts (and on config save). After you add or rename presets in the dashboard, run
> the **Refresh preset/category/stream lists** action once (bind it to a spare key or press it
> from the button editor) so the dropdowns pick up the change.

---

## 4. Reference

### Variables — `$(ytmeta:<id>)`

| Variable | Meaning |
|---|---|
| `display_label` | Button label: slug → preset id → `Custom`. Latin-safe. |
| `live_title` | The live broadcast title (may be Arabic — use the image feedback to render it). |
| `active_preset_id` | Id of the currently applied preset. |
| `active_preset_title` | Title of that preset (looked up in the fetched preset list). |
| `is_live` | `true` while on air. |
| `no_target` | `true` when there is no broadcast target. |
| `privacy` | `public` / `unlisted` / `private`. |
| `health` | `ok` / `degraded` / `auth_error`. |
| `health_message` | Human-readable health detail, if any. |
| `busy` | `true` while an action is being applied. |
| `api_enabled` | `false` when the middleware master switch (kill switch) is off. |
| `quota_used` / `quota_limit` / `quota_remaining` | YouTube API quota counters. |
| `undo_label` | Label of the change that **Undo** would revert. |
| `dashboard_url` | The configured base URL — use it with the built-in **Open URL** action. |

### Feedbacks

Image feedbacks are the reason this module exists; boolean feedbacks recolour keys.

| Feedback | Type | Fires / draws |
|---|---|---|
| **Image: button label (slug)** | advanced (`png64`) | Draws the slug/label PNG (Arabic-safe). |
| **Image: full live title** | advanced (`png64`) | Draws the full broadcast-title PNG (Arabic-safe). |
| **On air** | boolean | While `is_live`. Default style: red bg. |
| **Busy** | boolean | While an action is in progress. Default: blue bg. |
| **API disabled** | boolean | When the kill switch is off. Default: grey bg. |
| **Health state is…** | boolean | When `health` equals the dropdown value (`ok`/`degraded`/`auth_error`). Default: amber bg. |
| **Active preset is…** | boolean | When the dropdown-selected preset is the active one — highlights the applied preset's key. Default: green bg. |

### Actions

All hit the middleware's `/api/action/*` bus over HTTP. State updates arrive over the WebSocket,
so you never need to add a manual refresh after an action.

| Action | Options | Effect |
|---|---|---|
| **Apply preset** | `Preset` (dropdown), `Template vars` (JSON, optional; supports `$(...)`) | Applies the preset. If the preset has template placeholders, pass a JSON object of values. |
| **Update live metadata** | `Title` (required, supports `$(...)`), `Description`, `Privacy`, `Category`, `Bound stream` | Ad-hoc edit of the live metadata. Empty/"unchanged" fields are omitted; `Title` is always sent. |
| **Privacy: toggle private ↔ public** | — | Flips privacy. |
| **Privacy: set** | `Status` dropdown | Sets `public` / `unlisted` / `private`. |
| **Undo last change** | — | Reverts the last change (`$(ytmeta:undo_label)` shows what). |
| **Refresh cache** | — | Forces the middleware to refresh its cached state. |
| **Refresh preset/category/stream lists** | — | Re-fetches the dropdown choices after you edit presets in the dashboard. |

---

## 5. Worked setups

### Arabic title/label on a key (the core use case)

1. Add a button. **Feedbacks → yt-companion-middleware → Image: full live title** (or *Image:
   button label*). The key now shows the Arabic image instead of tofu boxes.
2. **Toggle short label ↔ full title:** make it a **two-step button** — step 1 carries the *slug*
   image feedback, step 2 the *title* image feedback — so one press flips between them. The long
   title rarely fits a key, so the slug is the everyday face.

### An on-air indicator

Add **On air** feedback to a key (default red). Optionally set the key text to
`$(ytmeta:live_title)` or bind the *title* image feedback so it doubles as the live-title display.

### A preset key that lights up when active

1. Add the **Apply preset** action to a key and pick the preset in its dropdown.
2. Add the **Active preset is…** feedback to the *same* key and select the *same* preset. The key
   goes green whenever that preset is the one on air — an instant "which preset am I on" wall.

### Ad-hoc metadata edit

Bind **Update live metadata** to a key. Set **Title** (required — you can reference a variable
like `$(internal:custom_myTitle)`), and leave Privacy/Category/Bound stream on "unchanged" to keep
the current values.

### Template-var presets & opening the dashboard (built-in Open URL, not this module)

Companion keys can't prompt for input, so presets with placeholders and any "open the dashboard"
step use Companion's built-in **Open URL** action:

- **Open the dashboard:** Open URL → `$(ytmeta:dashboard_url)`.
- **Fill a template-var preset:** Open URL →
  `$(ytmeta:dashboard_url)/fill?preset=<id>&redirect=<back>` — the browser page collects the
  values and bounces back.

---

## 6. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Status stuck on **Connection failure** | Base URL wrong/unreachable, or a bad/absent token. The module keeps retrying with backoff; fix the config and it recovers. |
| Variables blank | Connection not **OK** yet, or the middleware hasn't pushed a state frame — check the status pill and the Log tab. |
| Dropdowns missing new presets | Snapshot is stale — run **Refresh preset/category/stream lists**. |
| Arabic still shows as boxes | You bound the *text* variable, not an *image feedback*. Use **Image: full live title** / **Image: button label**. |
| Action seems ignored | Check the Log tab for a `rejected`/`failed` line (e.g. token required, or `update` with an empty title). |

---

## Packaging for distribution

The `npm run package` step in **Method A** produces the `yt-companion-middleware-<version>.tgz`
you hand to other operators (or import yourself). To publish it more widely, submit the module to
the Bitfocus registry so it shows up in Companion's built-in store. See the middleware's in-app
guide at `/docs` for the underlying endpoint details.
