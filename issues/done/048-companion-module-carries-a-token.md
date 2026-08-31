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

- [x] The module config has a token field, and the token reaches both HTTP requests and the WS
      handshake.
- [x] A config saved by the current (tokenless) version still loads after upgrading.
- [x] The new upgrade script is appended; `dropBearerToken` is byte-identical.
- [x] `companion-module/package.json` and `companion/manifest.json` are bumped together by the
      script, and `npm run companion:package` passes its preflight.
- [x] A disconnected module shows an unambiguous state on the key, distinct from "connected but
      idle".
- [x] `transform.js` helpers for the token path are unit-tested (TDD, per AGENTS.md).

## Blocked by

- Blocked by `issues/047-device-tokens-and-observable-grace-mode.md`

## User stories addressed

- User story 5
- User story 6

---

## Done (2026-08-31)

Shipped as module **v2.3.0** (minor: a new optional config field, a new feedback, two new
variables and a new preset — nothing removed or renamed). Every acceptance criterion is covered by
a test, and the credential half is covered end-to-end against the real server rather than against
the module's own assumption about it.

**The credential.** `bearerHeaders` / `apiHeaders` / `wsHandshakeOptions` in `transform.js`, wired
into the existing `headers()` seam and passed to `new WebSocket(url, options)`. The server reads
both surfaces through one seam (`Auth.callerOfHeaders`), so the module sends on both.

**A blank field sends no header, not a bare `Bearer `.** This is the load-bearing detail of the
whole migration. The server refuses a credential that was *presented and rejected* whatever grace
mode says, and admits *silence*. Get it backwards and every not-yet-configured install goes dark on
the day the module ships — the exact breakage this slice exists to prevent.

**`seedDeviceToken`** appended to `UpgradeScripts`; `dropBearerToken` is byte-identical (the diff
touches only the array literal and its type comment). It seeds an **empty** token and never
overwrites one an operator pasted in. A v1.x config upgrading straight through both steps lands on
`{ url, token: '' }` — a v1 Bearer token is not resurrected as a device credential, because those
are different secrets issued by different systems and reusing one would only fail auth more
confusingly.

**The disconnected state.** A `link` variable (`connected`/`connecting`/`disconnected`), a `link_up`
boolean, and a **Server unreachable** feedback in a magenta nothing else uses. Magenta on purpose:
every other alarm colour on a deck already belongs to something that is still *working* — tally red
is on air, amber is the kill switch, slate is health `offline`, which is the **server** saying it
cannot reach YouTube and therefore still talking to us. This one means nothing is talking to us at
all. It is overlaid **last** on the five state-showing presets (Companion applies feedbacks in
order, last match wins), so a key cannot sit in tally red showing a reading that is minutes old.

**Verified end-to-end** — `companion-module/src/credential.integration.test.ts` boots the real route
table and the real upgrade handler and drives them with the module's *own* helpers: a minted token
authenticates HTTP and the handshake, a blank one is refused on `/api/dashboard/*` but admitted and
recorded as tokenless on the Companion socket, a wrong one is refused on both, and revocation drops
both. Written as `.ts`, not `.js`: vite only rewrites a `.js` import specifier to its `.ts` source
from inside a TS file, so a JS test cannot import the server's sources at all.

### Notes for the next iteration

- **Rollout order is the remaining risk, and it is not code.** Install v2.3.0 on the Companion
  machine and paste the token in *before* issue 049 flips enforcement. The evidence for when that is
  safe is already on the dashboard (Settings → Machines): both counters, days **and** go-lives.
- **A still-tokenless module cannot reach the five `/api/dashboard/*` routes** (presets, categories,
  streams, service, fill-request) even in grace mode — grace covers the Companion bases and the
  socket, not that prefix. So an install that upgrades but leaves the field blank gets a live state
  socket with empty dropdowns. That is the intended shape (issue 047 decided not to widen grace),
  but it means "the keys still light up" is *not* evidence the token was configured. The Machines
  readout is.
- `npm run companion:bump` still does not touch `companion-module/package-lock.json`; the version
  there was corrected by `companion:package` running `npm install`. Bumping without packaging would
  leave it stale — worth folding into the bump script.
