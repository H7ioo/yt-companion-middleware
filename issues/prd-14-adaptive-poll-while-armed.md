# PRD-14 — Adaptive polling while a latch is armed: shrink the wrong-title window

Source: the live go-live test of 2026-08-05 23:01–23:04 UTC, which proved PRD-12's replay works and measured exactly how late it lands.

## Problem Statement

PRD-12's latch lands the operator's title on the broadcast that actually airs — but it lands it *after* air.

Measured on the production channel:

```
23:03:24  3u1qu4bOxxM goes LIVE carrying YouTube's stale Studio title
23:03:28  server's poll sees it, replays the operator's title
23:03:29  live title is correct
```

That run used a 15-second poll set up for the test. The shipped default is 60 seconds (`REFRESH_INTERVAL_SECONDS`), so in real use the stream can be live under the wrong title for **up to a minute**. For a channel whose broadcasts are public at go-live, that is a minute of viewers, thumbnails, and notifications carrying the previous show's name.

Simply lowering the global interval is not the answer. The refresh is not cheap — `resolveTarget` costs two to three `liveBroadcasts.list` calls plus a `getBroadcast`, roughly 3–4 quota units — and it runs all day whether or not anything is expected to happen. At a 10-second global interval that is ~1,400 units/hour against a 10,000/day budget: the app would exhaust the channel's quota by lunchtime to solve a problem that exists for one minute a day.

The waste is the point: the app already knows when a go-live is plausible. A latch is armed only when the operator has set metadata and the channel is idle — that is, in the minutes before a show. Outside that window there is nothing to react quickly to.

## Solution

Poll fast only when it can pay off, and probe cheaply when doing so.

1. **Arm-gated.** While a pending latch exists *and* the channel is idle, the cache switches to a short probe interval. Every other state — no latch, already live, API switched off — keeps today's behaviour exactly.
2. **Cheap probe, not a full refresh.** The fast tick asks one question: is anything active? That is a single `liveBroadcasts.list(broadcastStatus: "active")` call, 1 unit, versus 3–4 for a full refresh. The full refresh (and the replay) runs only when the probe flips to live.
3. **Bounded.** Fast probing stops after a fixed window per arming. Past that the latch stays armed and the replay still works — it just lands on the normal 60-second poll, which is today's behaviour. The fast path is an optimisation with an expiry, never a mode the app can get stuck in.

Net effect: the wrong-title window drops from up to 60 seconds to a few seconds, for roughly 200 quota units on show days and zero on quiet ones.

## User Stories

1. As a streamer, I want my title correct within seconds of going live, so that viewers arriving on the notification see the right show.
2. As a streamer, I want that speed only when the app has reason to expect a go-live, so that quota is not spent watching an idle channel.
3. As a streamer who prepared the title hours early, I want the app to stop fast-probing eventually, so that a forgotten latch cannot drain a day's quota.
4. As a streamer whose latch outlived the fast window, I want the title still to land, so that arming early is never worse than arming late.
5. As an operator, I want the kill switch to stop fast probing like it stops everything else, so that "API off" still means no YouTube calls.
6. As an operator watching the quota readout, I want fast probing to be visible in the day's usage rather than mysterious, so that a jump in units has an explanation.
7. As an operator, I want the probe to cost less than a refresh, so that reacting quickly is not the same price as re-reading everything.
8. As a developer, I want the fast interval, the window length, and the probe cost stated as named constants with their quota arithmetic in a comment, so that changing one is an informed decision.
9. As a developer, I want the poll cadence to be a pure function of cache state, so that it can be tested without timers.
10. As a developer, I want a test asserting no fast probing happens on an idle channel with no latch, so that the default cost of the feature is pinned at zero.

## Implementation Decisions

_Proposed — not yet built._

- **Cadence rule.** A single predicate over cache state decides the interval: fast when `pendingMetadata !== null && !status.isLive && apiEnabled && withinFastWindow`, normal otherwise. Keeping it a pure function of the snapshot makes it directly testable and keeps the timer dumb.
- **Fast interval: 10s.** Five would shave two seconds off a worst case that is already only a few seconds, at double the cost. Ten keeps the observed window comfortably under the ~15s the live test demonstrated as acceptable.
- **Fast window: 30 minutes per arming**, measured from `pendingMetadata.capturedAt`. At 10s that is ~180 units — under 2% of a day's budget, and it covers the realistic "set the title, then start the encoder" gap. Arming three hours early degrades gracefully to the 60s poll rather than costing 1,000+ units.
- **Probe, not refresh.** The fast tick calls `liveBroadcasts.list(broadcastStatus: "active")` only. On a non-empty result it hands off to the existing `refresh()`, which resolves the target properly and drives the replay. No duplicate targeting logic — the probe answers "has anything started", nothing more.
- **Timer.** Re-arm a single `setTimeout` per tick with the currently-computed interval, rather than switching between two `setInterval`s. One scheduling path, no chance of both running.
- **Quota.** Probes go through the existing tracker like any other read, so they show up in the day's usage rather than hiding.
- **Config.** The fast interval and window are constants, not env vars. `REFRESH_INTERVAL_SECONDS` keeps its current meaning as the steady-state interval. Another knob for a behaviour that self-limits is not worth the surface area.

## Testing Decisions

- **Cadence predicate:** table-driven unit test over cache snapshots — armed+idle+recent → fast; armed but live → normal; armed but expired → normal; no latch → normal; API off → normal.
- **Zero-cost default:** a test asserting an idle channel with no latch issues exactly the calls it issues today, so the feature cannot quietly add background cost.
- **Probe handoff:** the fast probe seeing an active broadcast triggers a full refresh, and the replay fires through the PRD-12 path (reuse the existing replay tests rather than re-asserting them).
- **Window expiry:** a latch older than the fast window polls at the normal interval and still replays when the channel goes live — arming early must never be worse than arming late.
- No timer-sleep tests. The interval is computed from state; assert the computation.

## Out of Scope

- Changing `REFRESH_INTERVAL_SECONDS` or its default.
- Any push/webhook mechanism from YouTube. There is no such thing for broadcast state; polling is the only option.
- Fast polling driven by anything other than an armed latch — for example "the operator has the dashboard open". Screen-open is not evidence a show is starting.
- Removing the replay's lateness entirely. That requires owning the broadcast so the title is right at air (PRD-13), and this PRD does not substitute for it.

## Further Notes

- This is deliberately the cheap half of the problem. It takes the wrong-title window from ~60s to ~5s for a small, bounded cost and no new failure modes. PRD-13 takes it to zero but promotes the app to broadcast manager, with the eligibility gate and cleanup obligations that brings — and its central premise is not yet verified on this channel (see the note added there). Ship this first regardless of how PRD-13 is decided; the two do not conflict.
- The 2026-08-05 test is the reference measurement. Any change to the fast interval or window should be re-checked against a real go-live, not just unit tests — the useful number is "seconds of wrong title on air", which no unit test observes.
