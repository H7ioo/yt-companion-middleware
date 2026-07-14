---
name: verify
description: Build and drive the yt-companion-middleware server to verify changes at its HTTP surface.
---

# Verifying yt-companion-middleware

## Build

```bash
npm run build          # tsc -b at repo root, builds all packages
```

## Launch the server

```bash
PORT=18081 DATA_DIR=<scratch-dir> node packages/server/dist/server.js
```

- Always set `PORT` (default 8080 may collide) and `DATA_DIR` (else it writes the real store).
- **Gotcha:** plain `&` backgrounding inside a Bash call gets reaped by the sandbox — the server dies silently. Use the Bash tool's `run_in_background: true` instead, then curl from a separate call.
- **Gotcha:** the repo `.env` holds real YouTube credentials; a launched server boots "ready" and immediately polls the live YouTube API (burns real quota units). Fine for smoke checks; keep runs short.

## Drive

- Health probe: `curl http://127.0.0.1:<port>/api/feedback/health` — returns JSON (`status: ok` when configured, `setup_required` otherwise).
- Startup success line: `[server] listening on http://0.0.0.0:<port> (...)`.
- Fatal startup errors print `[server] fatal: <message>` and exit 1.
- Stop with `pkill -f "node packages/server/dist/server.js"` (exits 144 — expected, not a failure).
