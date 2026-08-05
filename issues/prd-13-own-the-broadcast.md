# PRD-13 — Own the broadcast: create the stream instead of guessing which one YouTube made

Source: the go-live failure recorded in PRD-12, plus a study of how PRISM Live Studio avoids it. PRD-12 compensates for the race; this removes it.

## Problem Statement

The middleware is a passenger. It creates nothing. Every action begins by listing the channel's broadcasts and *guessing* which one matters, and the guess is wrong in the exact window that matters most: with an auto-start encoder, the broadcast that airs is minted by YouTube about 70 seconds before air, so before that moment there is no correct answer for the guess to find.

PRD-12's latch makes the common case work — set the title, go live, it lands. But it lands *late*, after the broadcast has already gone public with whatever title YouTube's saved stream settings carried. For a few seconds, the stream is live under the wrong name. Everything downstream of the guess inherits the same weakness:

- The operator's fix for an ambiguous target is to go into Studio and delete broadcasts by hand.
- A stray upcoming event silently competes for every edit until someone notices.
- The category, privacy and stream binding are applied as *corrections* to someone else's broadcast rather than as its definition.
- Guide and dashboard copy still describe a "persistent container" as the normal idle target, a concept YouTube deprecated on 2020-09-01 and which returns zero results on the test channel.

PRISM Live Studio does not have this problem, and the reason is not OAuth. OAuth is table stakes — this app already uses it. The difference is ownership of the lifecycle: PRISM calls `liveBroadcasts.insert` with the title, description and privacy the user typed, creates or reuses a `liveStream`, `bind`s them, and drives `transition` through testing → live → complete. Because it created the broadcast, the title is set at insert time and the id is known. There is no "find the right broadcast" step, so there is nothing to get wrong. PRISM falls back to plain RTMP-key mode only where the API is unavailable — notably, YouTube blocks third-party stream creation for channels under 50 subscribers.

## Solution

Become the driver, without taking over the encoder.

PRISM also pushes the video itself; this app must not, because OBS is the operator's encoder and that is not changing. The insight that makes this feasible: **the encoder does not need to know anything changed.** The channel already has one reusable `liveStream` that OBS points at. The middleware can create its own broadcast carrying the operator's metadata, `bind` it to that same existing stream, set `enableAutoStart`, and OBS goes live exactly as it does today — into *our* broadcast, with *our* title, from the first frame.

Scope:

1. **Create.** A "Prepare broadcast" action (dashboard and Companion) inserts a broadcast from a preset or ad-hoc payload, binds it to the operator's existing stream, and enables auto-start/auto-stop.
2. **Track.** The created broadcast id is recorded, and it — not a list query — becomes the target while it lives. Guessing becomes the fallback path, not the primary one.
3. **Retire.** A broadcast this app created and the operator abandoned is its responsibility to clean up, not the operator's.
4. **Fall back honestly.** Channels where insert is refused (the sub-50-subscriber gate, missing scope, disabled live streaming) keep today's passenger behaviour, and the dashboard says which mode it is in and why.

## User Stories

1. As a streamer, I want my title on the stream from the first frame, so that no viewer ever sees YouTube's saved default.
2. As a streamer, I want to prepare tonight's broadcast before the show, so that going live is one action on the encoder and nothing else.
3. As a streamer, I want the app to know exactly which broadcast is mine, so that a stray event in Studio cannot compete for my edits.
4. As a streamer, I want the category and privacy to be part of how the broadcast is created, so that they are never briefly wrong.
5. As a streamer, I want to keep using OBS and my existing stream key, so that adopting this changes nothing about my encoder setup.
6. As a streamer, I want a prepared broadcast I never used to be cleaned up, so that my channel does not accumulate the ghosts that caused PRD-12.
7. As a streamer on a small channel, I want to be told plainly that YouTube will not let this app create broadcasts, so that I know to prepare the stream in Studio instead of thinking the app is broken.
8. As a Stream Deck operator, I want a key that prepares tonight's broadcast from a preset, so that setup is one press.
9. As a Stream Deck operator, I want a key that shows whether a broadcast is prepared and bound, so that I can check before the show without a screen.
10. As a streamer, I want to end the broadcast from the app, so that a stream that fails to auto-stop does not sit live indefinitely.
11. As an operator, I want the app to say whether it is driving or riding along, so that I know which failure modes apply tonight.
12. As an operator, I want creating a broadcast to be an explicit action, never a side effect of applying a preset, so that the app cannot surprise me with a new public broadcast.
13. As a developer, I want the create/bind/transition sequence covered against a faked YouTube client, so that lifecycle regressions are caught without touching a real channel.
14. As a developer, I want the quota cost of the new writes accounted for, so that a channel near its daily budget is not pushed over by preparation.

## Implementation Decisions

_Proposed — this PRD is not yet built. Decisions here are the starting position for review, not settled fact._

- **Explicit action, never implicit.** Applying a preset must never create a broadcast. Creating a public broadcast is exactly the kind of outward-facing act that has to be a deliberate press.
- **Bind, do not create, the stream.** Reuse the operator's existing reusable `liveStream` (the one OBS holds the key for). Creating a stream would mean handing them a new key to paste into OBS, which defeats the point.
- **`enableAutoStart: true`, `enableAutoStop`** to match today's behaviour, so the encoder remains the thing that starts the show. Manual `transition` is the fallback for channels where auto-start is unavailable.
- **Ownership record.** Persist the created broadcast id and the fact that *we* created it. Target resolution prefers it while it is `upcoming`/`live`; PRD-12's guessing path remains for everything else. Only broadcasts this app created are ever candidates for cleanup.
- **Capability probe.** Detect at connect time whether `liveBroadcasts.insert` is permitted and record the mode (driving / riding). The failure is a channel-eligibility fact, not a transient error, so it belongs in setup status rather than health.
- **Quota.** `insert` and `bind` are 50-unit writes each; preparation costs roughly 100 units, against a 10,000/day default. Worth stating in the guide, not worth engineering around.
- **Copy.** Retire "persistent container" from the dashboard, guide and glossary. It names a thing YouTube deleted in 2020 and it is actively misleading about what the idle target is.

## Testing Decisions

- **Lifecycle:** unit tests against a faked YouTube client for insert → bind → (transition) → complete, asserting the request bodies carry the operator's metadata rather than patching it afterwards.
- **Ownership:** target resolution prefers an owned broadcast over any listed candidate, and falls back to PRD-12's picker when the owned one is gone.
- **Cleanup:** an owned, unused, expired broadcast is retired; a broadcast the app did not create is never touched, under any condition.
- **Capability:** an insert refused for channel eligibility puts the app in riding mode with an explanatory status, and does not escalate health.
- **No implicit creation:** applying a preset or ad-hoc update never issues an insert.

## Out of Scope

- Pushing video. OBS remains the encoder; this app never touches RTMP.
- Multi-platform simulcast, chat, or viewer counts — the parts of PRISM's feature set that OAuth linking also unlocks, and which are not this app's job.
- Replacing PRD-12. The latch and the conflict warnings stay: they are what protects the riding-mode fallback, which some channels will always be on.
- Scheduling broadcasts in advance for a calendar of future shows.

## Further Notes

- Sequencing: PRD-12 ships first and independently. It removes today's pain in a small diff. This PRD is the larger change and should not block it.
- The honest trade: this promotes the middleware from "metadata editor" to "broadcast manager", and brings failure modes it does not have today — orphaned broadcasts, two broadcasts when Studio also creates one, cleanup obligations, and a hard channel-eligibility gate. Those are the price of removing the race, and each needs a deliberate answer before this is built.
- Reference: [Migration guide for deprecation of default broadcasts and streams](https://developers.google.com/youtube/v3/live/guides/migration-guide-default-broadcasts) — the source for `enableAutoStart`/`enableAutoStop` and the 2020-09-01 date. [YouTube Live Streaming API overview](https://developers.google.com/youtube/v3/live/getting-started) — the insert/bind/transition sequence. [PRISM Live Studio: YouTube streaming cannot be started](https://guide.prismlive.com/mobile/guides/error-solution/youtube/youtube-streaming-cannot-be-started) — the sub-50-subscriber gate and their Studio fallback.
