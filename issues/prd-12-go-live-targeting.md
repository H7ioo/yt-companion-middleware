# PRD-12 — Go-live targeting: land pre-live metadata on the broadcast that actually airs

Source: a live end-to-end test on the production channel, 2026-08-05 21:34–21:52 UTC. Reproduced with API-level polling of the channel's broadcast list across a real OBS go-live, with the operator (HITL) starting the encoder.

## Problem Statement

Setting a title before going live does nothing. The operator has to re-apply it mid-show, on air, every time.

The recorded timeline shows why:

```
21:46:22  upcoming  X8tfFO-lL7w  ready  "T1 PRE-LIVE MARKER"      ← title applied here
21:48:13  upcoming  X8tfFO-lL7w  ready  "Testing title"           ← operator applied here too
21:49:38  upcoming  X8tfFO-lL7w         "Testing title"
          upcoming  kn_lwgeVyNY  ready  "نسائم قرآنية…"           ← YouTube mints a NEW broadcast
21:50:43  kn_lwgeVyNY  liveStarting
21:50:48  kn_lwgeVyNY  LIVE       X8tfFO-lL7w still sits upcoming, untouched
```

Three distinct defects, in order of how much damage they do:

1. **The broadcast that airs does not exist when the operator sets the title.** With an auto-start encoder, YouTube mints the broadcast that actually goes live roughly 70 seconds before air. Everything written before that moment lands on some other broadcast. No amount of better target-picking fixes this on its own — at the moment of the write there is nothing correct to write to.
2. **Target selection preferred a stale ghost.** Among `upcoming` broadcasts, ties on readiness were broken by *earliest* `scheduledStartTime`. `X8tfFO-lL7w` was scheduled 2026-05-25 — two months dead — so it beat the real broadcast every time, even once the real one existed. The channel had no `persistent` container to fall back to, because YouTube stopped auto-creating those on 2020-09-01.
3. **Nothing told the operator the aim was ambiguous.** The code already detected "more than one upcoming broadcast" and wrote it to `console.warn`, which no operator ever sees. Two broadcasts sharing one stream key — the decisive case, since the encoder can only feed one — was not detected at all.

Separately, and reported in the same session: the preset fill dialog stays open after a successful apply and reopens carrying the previous show's values. Both were deliberate (an inline "Applied" line; last-used prefill), and both read as "the button did nothing" during a live show. The write had in fact succeeded — confirmed by `Testing title` landing on YouTube at 21:48:13 while the operator believed the feature was broken.

## Solution

Stop pretending the pre-live target is knowable, and say so when it isn't.

1. **Latch the intent.** Metadata applied while idle is remembered alongside the broadcast id it was written to. When the state cache next sees a *different* broadcast go live, it replays that intent onto the real one. The operator sets the title once, before the show, and it lands — even though the target did not exist at the time.
2. **Stop picking ghosts.** Upcoming broadcasts scheduled more than 12 hours in the past are excluded from selection, and remaining ties break by newest-created rather than earliest-scheduled — because YouTube mints the real one last.
3. **Name the ambiguity.** A `targetConflict` state, independent of `health`, reports the three states that mean "the broadcast we edit may not be the one that airs": two upcoming broadcasts on one stream key, several upcoming broadcasts, or the target changing on its own while idle. Surfaced as an amber dashboard banner listing the actual broadcast ids, and as a Companion feedback so a key can go amber.
4. **Make the fill dialog behave like a button.** Close on success; keep last-used prefill but select it on focus so it is one keystroke to replace.

`targetConflict` is deliberately not a fifth `health` state. Health answers "can we reach YouTube"; this answers "are we pointed at the right thing". A perfectly-connected app with an ambiguous target must not read as broken.

## User Stories

1. As a streamer, I want a title I set before the show to be on the stream when it goes live, so that I stop editing metadata on air.
2. As a streamer, I want that to work even though YouTube creates the broadcast a minute before air, so that I do not have to time my edits.
3. As a streamer, I want the app to ignore an abandoned event from months ago, so that my edits go somewhere that matters.
4. As a streamer with a stray broadcast in Studio, I want the dashboard to tell me which broadcasts are competing and to show me their ids, so that I can delete the right one instead of guessing.
5. As a streamer, I want a warning that something else is creating broadcasts, so that I know to close Studio's stream page before the show.
6. As a Stream Deck operator, I want a key that goes amber when the target is ambiguous, so that I see it without looking at the dashboard.
7. As a streamer, I want an ambiguous target to look different from a lost connection, so that I do not go hunting for a network fault that isn't there.
8. As a streamer, I want the fill dialog to close when the apply succeeds, so that I know the key did something.
9. As a streamer reopening a fill dialog, I want last show's value selected rather than silently kept, so that typing replaces it and I can still see what I used last.
10. As a streamer, I want a failed fill to keep the dialog open with my typing intact, so that I can correct and retry without re-entering everything.
11. As a streamer, I want the activity log to record when metadata was re-applied to a new broadcast, so that I can tell the app did it rather than wondering why the title changed.
12. As a streamer, I want a latched title to expire rather than resurface days later, so that yesterday's title never lands on tonight's show.
13. As a developer, I want the go-live regression pinned by a test using the real ids and times from the 2026-08-05 session, so that this specific failure cannot return.
14. As a developer, I want the dashboard's first paint built by the same assembler as every other state push, so that a new contract field cannot go missing on load.

## Implementation Decisions

- **Latch (`cache.pendingMetadata`).** Written by the action runner whenever a payload is applied while `isLive` is false, carrying title/description/privacy/category and the target id. `streamBoundId` is deliberately excluded — by replay time the encoder is feeding the live broadcast and re-binding would cut it. Replays are marked so they cannot re-arm the latch, or a channel that keeps minting broadcasts would loop.
- **Replay trigger (`StateCache`).** Fires on the refresh that first sees `isLive && target.id !== pending.targetId`. TTL is 6 hours: long enough to set a title well before the show, short enough that it cannot cross into another day. The latch is cleared whether the replay succeeds *or fails* — a stuck latch re-firing every 60s for a whole show is worse than one missed title. Both outcomes are logged to the activity feed.
- **Runner/cache cycle.** The cache detects the go-live, the runner is what can write. The cycle is broken with `cache.setReplayHandler(...)` in `server.ts` rather than constructor injection either way.
- **Staleness window.** 12 hours, chosen so a broadcast YouTube mints at ~now and a legitimately-scheduled future show are both always safe. If every upcoming candidate is stale, the filter falls back to the full list rather than reporting no target.
- **Conflict copy.** State labels and remedies live in `TARGET_CONFLICT_GLOSSARY` in `@app/shared`, alongside `HEALTH_GLOSSARY`. Per-channel specifics (counts, titles) ride on the conflict's own `message`, since those are discovered facts, not fixed vocabulary.
- **Drift detection.** Reported only while idle and only when the previous state was also idle — a new target right after a show ends is expected, not drift.
- **State route.** Rebuilt on `buildDashboardState`. It had been hand-rolling an equivalent payload, so `targetConflict` (and `displayLabel`, and the PNGs) were absent on first paint until an SSE push arrived — the same drift PRD-10 §1 fixed on the refresh route, still living one route over.
- **Fill dialog.** Closes on success; keeps the dialog open with values intact on failure. Prefill stays a real value rather than a placeholder, because the placeholder slot already carries the preset's own inline default/fallback and blank already means "use that" — overloading it would make what-gets-sent ambiguous. `select()` on focus makes the stale value one keystroke to replace.

## Testing Decisions

- Tests assert **external behavior**: which broadcast id is chosen, what the cache holds after a refresh, what the activity log says.
- **Target selection:** `pickUpcoming` is exported and tested directly with the real ids, titles and timestamps from the 2026-08-05 session — the ghost must lose to the freshly-minted broadcast. Plus: shared-stream-key detection, plain multi-upcoming, single-upcoming (no conflict), readiness still beating schedule, and the all-stale fallback.
- **Replay:** `StateCache` tests with an injected replay handler covering replay-on-new-broadcast, no-replay-when-same-id, no-replay-while-idle, stale-latch-dropped, and failure-clears-the-latch-and-logs.
- **Drift:** flagged when the target changes while idle; *not* flagged when the previous state was live (a show ending).
- **State route:** integration test asserting the first paint's key set equals the refresh payload's, so a future contract field cannot silently go missing again.

## Out of Scope

- **Owning the broadcast lifecycle** — creating broadcasts via `liveBroadcasts.insert` instead of editing whatever YouTube made. This is the only change that removes the race entirely rather than compensating for it, and it is the subject of PRD-13.
- Deleting stray broadcasts on the operator's behalf. The app reports them; removing someone's broadcast is not a thing it should do unasked.
- Any change to the `health` state machine or its glossary.
- Detecting whether YouTube Studio is literally open. There is no API for it; the conflict states are the observable consequences.

## Further Notes

- The `broadcastType: persistent` fallback in `resolveTarget` is dead on any channel enabled for live since 2020-09-01, when YouTube stopped auto-creating default broadcasts. The test channel returns zero. It is kept for older channels, and now carries a comment saying so. Dashboard and guide copy still describe a "persistent container" as if it were the normal idle target — that wording should be revisited (see PRD-13).
- The operator's original report was "ad hoc doesn't work at all". The evidence contradicts the literal claim — the write landed — but not the experience: a dialog that stays open after a successful apply is indistinguishable from one that failed. Worth remembering when weighing "confirm inline" against "close and toast" anywhere else in this app.
