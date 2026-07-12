# PRD-10 — Review correctness fixes: refresh state integrity, offline detection, update notes, quota warning

Source: multi-agent code review of branch `feat/032-release-integration-tests` (issues 017–040 range). All four defects were CONFIRMED by independent verifier agents with quoted code paths.

## Problem Statement

Four confirmed bugs degrade the operator's trust in the dashboard:

1. **Refresh wipes readouts.** Clicking "Refresh from YouTube" makes the "API quota N / 10,000" readout disappear, disables Undo, and blanks display labels until the next background update restores them. Root cause: the refresh action route responds with the raw session cache (which has no quota/undo/busy/apiEnabled/displayLabel fields) while the web client wholesale-replaces its full dashboard state with that partial payload. A misleading client response type asserted the payload was a full `DashboardState`, so the compiler never caught it.
2. **Offline is unreachable for common outages.** The YouTube error mapper's network-code set omits `EHOSTUNREACH`, `ENETUNREACH`, and `ECONNABORTED`. Those outage errors map to a generic transient failure, so health pins at `degraded` and never reaches `offline` — the firewall-guidance panel built in PRD-06 never renders for the very outages it was designed for.
3. **"What's in it" can never render.** The app-info route looks up the offered update's release notes in the changelog **bundled with the currently installed build**, which by construction cannot contain a newer version's entry. `updateNotes` is structurally always null, so the update banner's notes affordance is dead code. electron-updater already delivers the real notes (`releaseNotes` on its update info) but the updater controller discards them.
4. **Quota warning fires once per process, not once per day.** The quota tracker's one-time 90% `warned` latch is never reset in the Pacific-midnight rollover (usage is reset, the latch is not), so a long-running server warns on day 1 and then never again.

## Solution

Make every state-bearing response authoritative and every daily signal actually daily:

1. The refresh action responds with the same fully assembled dashboard state that the state route, SSE push, and webhook already produce, and the client response type tells the truth. Refresh becomes indistinguishable from any other state update — no field ever transiently vanishes.
2. The network-error code set covers the full family of host/route/abort outage codes, so a dropped link classifies as a network failure, health reaches `offline`, and the firewall guidance renders.
3. The desktop updater threads the release feed's notes through its state contract to the server route and web banner, so "What's in it" shows the offered version's real notes.
4. The quota warning latch resets at the same day rollover that resets usage, restoring the once-per-day heads-up.

## User Stories

1. As a streamer, I want the API quota readout to stay visible when I click "Refresh from YouTube", so that I never wonder whether quota tracking broke mid-stream.
2. As a streamer, I want the Undo button to remain enabled across a refresh when an undo snapshot exists, so that I can still revert my last action immediately after refreshing.
3. As a streamer, I want display labels and title/slug images to stay rendered through a refresh, so that the dashboard never flickers to a blank state.
4. As a developer, I want the refresh API's response type to match its actual payload, so that the compiler catches shape mismatches instead of shipping them.
5. As a streamer whose venue Wi-Fi drops, I want the dashboard to show the Offline state and firewall guidance, so that I follow network troubleshooting steps instead of suspecting my YouTube token.
6. As a streamer behind a strict firewall that returns "no route to host", I want the Companion button to turn the canonical offline grey, so that my Stream Deck tells me the same story as the dashboard.
7. As an operator, I want a persistent network outage to classify as `offline` rather than `degraded`, so that health states keep their glossary meanings.
8. As a desktop-app operator, I want the update banner's "What's in it" to show the offered version's release notes, so that I can decide whether to install mid-week or wait.
9. As a desktop-app operator, I want release notes sourced from the update feed itself, so that the notes always describe the version being offered, never the one I already run.
10. As an operator running the server for weeks, I want the 90%-quota warning to fire every day it becomes relevant, so that I get a heads-up before writes start failing on any day, not just the first.
11. As an operator reading the activity log, I want exactly one quota warning per day (not zero, not spam), so that the signal stays meaningful.
12. As a developer, I want integration tests asserting the refresh response carries quota/undo fields, so that this regression class cannot silently return.
13. As a developer, I want a unit test that rolls the quota tracker across a simulated day boundary and asserts a second warning, so that the latch reset is pinned.
14. As a developer, I want the error-mapper tests to enumerate every outage code the mapper must classify as network, so that adding a new code is a one-line change with a matching assertion.

## Implementation Decisions

- **Refresh route (server).** The refresh action handler assembles its response through the same dashboard-state builder used by the state route, SSE socket, and webhook — the cache snapshot is never spread directly into a response again. The success flag stays on the response envelope.
- **Refresh client (web).** The API client's refresh return type is corrected to the true payload (full dashboard state plus success envelope). The state-replacement in the refresh handler is kept wholesale — it is correct once the payload is authoritative.
- **Error mapping (server).** The network-code set is extended with `EHOSTUNREACH`, `ENETUNREACH`, and `ECONNABORTED`. Verified: this stack (googleapis → gaxios → node-fetch) surfaces OS codes directly on `err.code`, so no `err.cause` unwrapping is needed. The set stays a single constant with a test enumerating it.
- **Update notes (desktop → server → web).** The updater controller's state contract gains an optional notes field populated from the update feed's release notes on `update-available`/`update-downloaded` (normalized to a plain string; the feed can deliver a string or structured list). The app-info route prefers the threaded feed notes; the bundled-changelog lookup remains only for the *installed* version's "What's New" panel, which is its correct use. The shared contract type is the single definition both sides import.
- **Quota latch (server).** The day-rollover routine resets the warned latch alongside usage. The latch stays in-memory (not persisted): a restart mid-day may re-warn once, which is acceptable and simpler than persisting it.

## Testing Decisions

- Good tests here assert **external behavior**: response bodies, health-state transitions, and logged warnings — never private fields.
- **Refresh route:** extend the existing route integration tests (issue 032 prior art, `api.integration.test.ts`) to assert the refresh response contains `quota`, `undo`, and `apiEnabled` keys matching the state route's shape.
- **Error mapper:** table-driven unit test mapping each outage code to `NETWORK_ERROR`, plus a state-cache test asserting repeated network failures reach `offline`.
- **Quota tracker:** unit test with an injectable clock/date crossing a Pacific-midnight boundary asserting a second `YOUTUBE_QUOTA_LOW` log entry (prior art: existing quota tests).
- **Update notes:** unit test on the updater state reducer (feed event with notes → state carries notes) and a route test asserting app-info surfaces them; web-side test that the banner renders the affordance when notes are present.

## Out of Scope

- Any redesign of the health-state machine or escalation policy for persistent `degraded` (a 5xx pinning at degraded is intentional per PRD-06; only its glossary copy might deserve a later tweak).
- Persisting the quota-warned latch across restarts.
- Rendering rich/HTML release notes — plain text is sufficient.
- Health palette/copy drift and dashboard render efficiency (PRD-11).

## Further Notes

- The refresh bug reproduces the operator report verbatim: quota readout vanishes on click, returns on the next push. Fixing the route alone fixes all collateral symptoms (Undo, labels, images) at once — do not patch the client to merge partial state; that would paper over the wrong layer.
- Review also REFUTED two candidate findings, for the record: the dashboard does not render in setup mode (a setup gate covers it), and the removal of transient→auth_error escalation was a deliberate, correct PRD-06 fix.
