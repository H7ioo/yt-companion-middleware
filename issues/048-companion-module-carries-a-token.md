## Parent PRD

`issues/prd-15-hosted-auth-and-accounts.md`

## What to build

Give the Companion module a credential to send, and make its disconnected state unmistakable.
PRD-15 §4.

**Context that makes this slice necessary.** The module's entire config is a single `url` field, and
that is deliberate: v2.0.0 *removed* the Bearer-token field and ships an upgrade script,
`dropBearerToken`, that strips `token` from stored configs — on the reasoning that the middleware
had dropped auth entirely (PRD-02 §8). So an install in the field cannot be configured with a
token; the field is gone. This slice restores it.

- Re-add the token config field, threaded through the existing `headers()` seam and into the `ws`
  handshake options.
- **Append** a new upgrade script that seeds an empty token field. Never edit `dropBearerToken` —
  AGENTS.md hard rule.
- **Minor version bump** in the same PR, via `npm run companion:bump minor`.
- Render the disconnected state unmistakably. Losing the server no longer means the laptop is off;
  it means the internet blinked while the stream carries on fine. Nobody should press a key into
  the void believing it landed.

TLS needs no work: `transform.js` already rewrites `https:` to `wss:`.

## Acceptance criteria

- [ ] The module config has a token field, and the token reaches both HTTP requests and the WS
      handshake.
- [ ] A config saved by the current (tokenless) version still loads after upgrading.
- [ ] The new upgrade script is appended; `dropBearerToken` is byte-identical.
- [ ] `companion-module/package.json` and `companion/manifest.json` are bumped together by the
      script, and `npm run companion:package` passes its preflight.
- [ ] A disconnected module shows an unambiguous state on the key, distinct from "connected but
      idle".
- [ ] `transform.js` helpers for the token path are unit-tested (TDD, per AGENTS.md).

## Blocked by

- Blocked by `issues/047-device-tokens-and-observable-grace-mode.md`

## User stories addressed

- User story 5
- User story 6
