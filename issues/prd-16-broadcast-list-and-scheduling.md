# PRD-16 — Broadcast list, scheduling, and the readouts that end the Studio detour

Source: the grilling session of 2026-08-29. Supersedes the open questions in
[PRD-13](prd-13-own-the-broadcast.md), whose central premise this PRD records as **verified**.

## Problem Statement

Two things still send the operator to `studio.youtube.com` in the middle of a show, and a third
means the show cannot be prepared in advance at all.

- **You cannot tell which broadcast will actually air.** The app resolves a target by listing
  broadcasts and picking one. Nothing shows the operator *why*, or which event YouTube will feed
  when the encoder starts.
- **You cannot tell whether ingestion is healthy.** "Is it stuck on preparing?" is answerable only
  in Studio today, and it is the single most common reason to open it mid-show.
- **You cannot schedule.** The normal working pattern is to create an event days ahead to get a
  shareable link. That is not possible from this app, so it happens in Studio, and then the app is
  a passenger to something it did not create.

Opening Studio is not free. It is heavy, it competes for attention during a show, and there is a
standing suspicion that having it open changes which broadcast YouTube selects.

### What the tests established

The failure recorded on 2026-08-05 — YouTube minting `3u1qu4bOxxM` and airing it while a valid
`upcoming` broadcast existed — has a mundane cause, confirmed by the operator: **the scheduled
broadcast was not attached to the stream key OBS was pushing to.** Nothing was racing; the two
objects were never connected. YouTube created a broadcast to receive video nobody was expecting.

Re-tested in August 2026 with the event correctly attached to the reusable key:

- **Round 1 (Studio closed):** the scheduled broadcast aired, as expected.
- **Round 2 (Studio open):** the same — YouTube grabbed the correct scheduled broadcast.

So PRD-13's premise holds, and the Studio-open suspicion is unfounded. **What has *not* been tested
is a broadcast this app created** — see the prerequisite below.

The API side is confirmed against the docs: `contentDetails.enableAutoStart` and
`enableAutoStop` are settable on `liveBroadcasts.insert` and `update`, and YouTube's own guide
names them as the way to skip the testing stage and let the encoder start the show.

## Prerequisite — Test 3

**Nothing in this PRD is built until this runs.** Rounds 1 and 2 validated a broadcast *Studio*
created. This PRD depends on a broadcast *the app* created behaving identically. It should — same
resource, same settings — but that assumption is the foundation of the whole feature.

1. Insert a broadcast through the API with title, description, privacy and scheduled start.
2. Bind it to the channel's existing reusable stream — the key OBS already holds.
3. Set `enableAutoStart` and `enableAutoStop` to true.
4. Start OBS. Observe which broadcast airs and with what title from the first frame.

Record in the same pass:

- whether `insert` is permitted at all on this channel (the refusal is explicit — see §Riding mode);
- whether `enableAutoStart` coexists with `contentDetails.monitorStream.enableMonitorStream`, or
  requires it off. [`dry-run-resolve.mjs`](../packages/server/scripts/dry-run-resolve.mjs) already
  prints both;
- how long the broadcast sits in "preparing".

If the app's own broadcast loses, this PRD is dead and the work becomes making the Studio detour
shorter instead.

## Solution

### 1. Broadcast list — answer "which one will air?"

A list of upcoming and live broadcasts showing, for each: title, scheduled start, privacy, the
stream it is bound to, and whether auto-start is on. One of them is marked as **the one that will
air** — the bound, auto-start-enabled event on the key the encoder uses — with the reason stated in
plain words.

This is a read-only feature. It needs no permission to create anything, and it is buildable
regardless of how Test 3 goes. **It is the highest-value slice here** and should ship first.

### 2. Prepare / schedule a broadcast

An explicit action — dashboard and Companion — that inserts a broadcast from a preset or an ad-hoc
payload, binds it to the existing reusable stream, and sets auto-start and auto-stop.

- **Never a side effect.** Applying a preset must not create a broadcast. Creating a public
  broadcast is a deliberate press, always.
- Metadata is set **at insert**, so the title is right from the first frame rather than corrected
  seconds later.
- The share link is shown and copyable as soon as the broadcast exists — this is the reason
  scheduling matters at all.
- Scheduling for a future date is **in scope** here (it was explicitly out of scope in PRD-13).

### 3. Stream health readout

Surface YouTube's ingestion state for the bound stream (`liveStreams.list`, `status.streamStatus`
and `status.healthStatus` — confirm exact values while implementing) directly in the dashboard and
as a Companion feedback.

This is what replaces the "is it stuck on preparing?" trip to Studio. It is small, cheap, and
independent of everything else in this PRD.

### 4. Embedded player, with an honest boundary

Embed the public player for **public and unlisted** broadcasts. Private ones cannot be embedded —
route the operator to Studio, and say why.

Two things stated in the UI, not just in the docs:

- **The embed is the audience's view and runs behind by seconds to a minute.** It answers "is it
  out, and does it look right", never "did the audio just cut". The §3 readout is the live signal.
- **Not on the encoder machine.** It costs bandwidth and CPU on the machine already running OBS,
  and the audio plays over itself.

### 5. Cleanup

Broadcasts this app created, that never aired and whose time has passed, are retired automatically.

- **Only broadcasts this app created are ever candidates.** A human-made broadcast is never touched,
  under any condition.
- This is not housekeeping. YouTube refuses `insert` once too many live or scheduled broadcasts
  exist (`limitExceeded` / `userBroadcastsExceedLimit`), so uncleaned ghosts eventually block
  preparation on the night it matters.

### 6. Riding mode

YouTube blocks broadcast creation for ineligible channels (notably under 50 subscribers). **Detect
it, do not guess it** — `insert` fails with a recognisable refusal (`insufficientLivePermissions`,
`livePermissionBlocked`, `liveStreamingNotEnabled`). Record the mode at connect time.

In riding mode: the list (§1), the health readout (§3) and the embed (§4) all still work; creation
and scheduling are disabled with a plain explanation that YouTube — not the app — is refusing, and
that the event must be made in Studio. This is a channel-eligibility fact, so it belongs in setup
status, not in health.

### 7. Update safety (applies to every write here)

`liveBroadcasts.update` **deletes any property omitted from the request**, and requires
`monitorStream` fields to be re-sent. Every update must read current state and send it back whole.
This is a much larger hazard once a list of scheduled broadcasts is being managed than it was with
a single live target — one sloppy write silently wipes a description or turns auto-start off on
tonight's show.

### 8. Interaction with the target pin

The shipped pin is what makes today's flow work. Selecting a broadcast in the list **sets the pin**
rather than competing with it — one concept, surfaced two ways. The pin remains the answer to
"which broadcast do my actions apply to".

## User Stories

1. As a streamer, I see which broadcast will actually air, and why, without opening Studio.
2. As a streamer, I schedule tonight's show days ahead and copy its link straight away.
3. As a streamer, my title is on the stream from the first frame.
4. As a streamer, I can tell whether YouTube is receiving my video without leaving the app.
5. As a streamer, I can watch the public output in the app when the stream is public or unlisted,
   and I am told to use Studio when it is private.
6. As a streamer, a prepared broadcast I never used is cleaned up for me.
7. As a streamer on an ineligible channel, I am told plainly that YouTube refuses, not that the app
   is broken.
8. As an operator, creating a broadcast is always a deliberate press, never a side effect.
9. As an operator, changing an existing broadcast never silently erases a field I did not touch.
10. As an operator, deleting a broadcast whose link I have shared asks me to confirm.
11. As a Companion operator, a key prepares tonight's broadcast from a preset, and a feedback shows
    whether one is prepared and bound.
12. As a developer, the create/bind/schedule sequence is covered against a faked YouTube client.

## Implementation Decisions

_Proposed — starting position for review, not settled fact._

- **Ship in slices, in this order:** the list (§1) → the health readout (§3) → scheduling (§2) →
  embed (§4) → cleanup (§5). The first two are read-only, cheap, and independent of Test 3.
- **Bind, never create, the stream.** Reuse the key OBS already holds; a new key would mean
  re-pasting into OBS, which defeats the point.
- **Auto-start and auto-stop on**, so the encoder stays the thing that starts the show. Manual
  transition is the fallback where auto-start is unavailable.
- **Ownership record.** Persist which broadcasts this app created; only those are cleanup
  candidates, and target resolution prefers them while they live.
- **Quota.** Insert and bind are 50-unit writes each (~100 per preparation, against 10,000/day).
  List calls are cheap reads, but a *list* refreshed on an interval costs more than one target —
  budget it before adding polling.
- **Copy.** Retire "persistent container" from dashboard, guide and glossary; it names something
  YouTube removed in 2020.

## Testing Decisions

- **Which-one-will-air logic** is a pure function over listed broadcasts, tested with the real
  shapes from the 2026-08-05 session and the August re-tests.
- **Lifecycle:** insert → bind → schedule against a faked client, asserting the request body carries
  the operator's metadata rather than patching it afterwards.
- **Update safety:** an update that changes one field re-sends the rest; a regression that drops a
  field fails the test.
- **Cleanup:** an app-created, unused, expired broadcast is retired; a broadcast the app did not
  create is never touched, under any condition.
- **Riding mode:** each eligibility refusal puts the app in riding mode with an explanation, and
  does not escalate health.
- **No implicit creation:** applying a preset or an ad-hoc update never issues an insert.
- **Pin integration:** selecting from the list sets the pin; the two never disagree.

## Out of Scope

- Pushing video. OBS remains the encoder; this app never touches RTMP.
- Live chat, analytics, multi-platform simulcast.
- Replacing PRD-12's latch and conflict warnings — they protect riding mode, which some channels
  will always be on.
- Anything requiring a monitor of the *live* video or audio feed. No API provides it; that is
  permanently a Studio or public-page job, and the goal is "never open Studio to set something up",
  not "never open Studio".

## Further Notes

- **Depends on [PRD-15](prd-15-hosted-auth-and-accounts.md)** only for the confirmation-gated
  actions (stream binding, deleting a shared broadcast) and for attributing scheduling actions in
  the audit log. The rest is independent and could ship either side of it.
- The honest trade from PRD-13 still stands: this promotes the app from metadata editor to
  broadcast manager and brings failure modes it does not have today — orphaned broadcasts, the
  creation cap, cleanup obligations, and a hard eligibility gate. Each has an answer above.
- References: [liveBroadcasts resource](https://developers.google.com/youtube/v3/live/docs/liveBroadcasts),
  [liveBroadcasts.insert errors](https://developers.google.com/youtube/v3/live/docs/errors),
  [Life of a broadcast](https://developers.google.com/youtube/v3/live/life-of-a-broadcast).
