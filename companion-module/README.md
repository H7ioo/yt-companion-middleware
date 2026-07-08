# companion-module-yt-companion-middleware

A [Bitfocus Companion](https://bitfocus.io/companion) module for the YouTube Live Metadata
Control middleware in this repo. It exists to solve one thing the Generic HTTP module can't:
**putting the middleware's Arabic-rendered title/slug PNGs onto a key** (Companion's built-in
fonts render Arabic as tofu boxes, and Generic HTTP has no image feedback).

It also exposes the middleware's state as variables and its `/api/action/*` bus as actions.

## What it provides

- **Variables** — `display_label`, `live_title`, `active_preset_id`, `is_live`, `no_target`,
  `privacy`, `health`, `busy`, `api_enabled`, `quota_remaining`.
- **Image feedbacks** (advanced, `png64`) — *Image: button label (slug)* and *Image: full live
  title*. Bind one to a key; a two-state button toggles between them.
- **Actions** — Apply preset, Privacy toggle/set, Undo, Refresh.

## Install (developer / sideload)

Companion loads modules from a **Developer modules path**.

1. Build/prepare the module folder:
   ```bash
   cd companion-module
   npm install        # pulls @companion-module/base
   ```
2. In Companion: **Settings → Developer modules path** → point it at a folder, and place (or
   symlink) this `companion-module` directory inside it.
3. Restart Companion. Add a connection: search **yt-companion-middleware**.
4. Set the **Middleware base URL** (e.g. `http://localhost:8080`).

To package for distribution, use the Companion module tools
(`companion-module-build`) and submit to the module registry.

## Using it on a button (the Arabic fix)

1. Add the connection and confirm variables populate (e.g. `$(ytmeta:display_label)`).
2. On a button, add a **feedback → yt-companion-middleware → Image: full live title**
   (or *button label*). The button now shows the Arabic image.
3. For a toggle: make it a two-step button — step 1 uses the *slug* feedback, step 2 the
   *title* feedback — so one press flips between the short label and the full title.

See the middleware's in-app guide (`/docs`) for the endpoint details.
