## Parent PRD

`issues/prd-03-auth.md`

## What to build

A first-class **Settings page** (PRD-03 §3): a Connection section (status, which flow is in use,
Connect / Reconnect / Disconnect) plus the existing app defaults (`defaultCategory` /
`defaultStreamBoundId`) in one place. Extends `/api/setup/status` to report connection state as
booleans; Docker renders read-only guidance.

## Acceptance criteria

- [x] Settings page reachable any time (not just first run).
- [x] Shows connection status + active flow (bundled vs override); Connect/Reconnect/Disconnect work.
- [x] App defaults editable from the same page.
- [x] Secrets never returned; status is booleans only.
- [x] Docker/headless shows read-only env/CLI guidance.

## Implementation notes

- Server: `SetupStatus` gained `activeFlow: "bundled" | "override" | "env" | null`, derived by the
  pure `deriveActiveFlow` helper (`youtube/setupStatus.ts`) — bundled vs override is told apart by
  comparing the stored client id against the bundled client id, wired through in `server.ts`.
- New `POST /api/setup/disconnect` wipes stored credentials and reboots into setup mode. No secret
  is ever returned; status stays booleans + the flow enum.
- Web: `SettingsPanel` overlay reachable from a rail ⚙ Settings button, holding the Connection
  section (status lamp, flow label, Connect/Reconnect/Disconnect) and the app defaults. The
  `describeConnection` pure helper decides connected/editable/label; env-CLI and headless boots are
  read-only with guidance. Reconnect reuses the stored client, so no secret re-entry.
- Tests: `deriveActiveFlow`, `describeConnection` (pure), and a real-HTTP setup-route test
  (activeFlow + disconnect). Verified end-to-end against a booted server.

## Blocked by

- Blocked by `issues/012-auth-inapp-oauth-flow.md`

## User stories addressed

- User story 4
