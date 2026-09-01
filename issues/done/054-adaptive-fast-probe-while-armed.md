## Parent PRD

`issues/prd-14-adaptive-poll-while-armed.md`

## What to build

The whole of PRD-14 in one slice — it is small, and splitting it would produce halves that change
nothing observable on their own.

Poll fast only when it can pay off, and probe cheaply while doing so:

- **A cadence predicate**, a pure function of the cache snapshot: fast when a latch is pending, the
  channel is idle, the API is enabled, and the arming is still inside its window; normal otherwise.
  Pure so it is testable without timers (PRD-14 §Implementation Decisions).
- **A cheap probe, not a refresh.** The fast tick asks one question — is anything active? — via
  `liveBroadcasts.list(broadcastStatus: "active")`, 1 unit against the 3–4 a full `resolveTarget`
  costs. A non-empty result hands off to the existing `refresh()`, which resolves the target and
  drives PRD-12's replay. No duplicate targeting logic.
- **Bounded.** Fast probing expires 30 minutes after `pendingMetadata.capturedAt`. Past that the
  latch stays armed and the replay still works on the normal 60-second poll — today's behaviour.
  The fast path is an optimisation with an expiry, never a mode the app can get stuck in.
- **One scheduling path.** Re-arm a single `setTimeout` per tick with the computed interval, rather
  than switching between two `setInterval`s, so both can never run at once.
- Probes go through the existing quota tracker, so they appear in the day's usage rather than
  hiding.
- Fast interval, window length and probe cost are named constants with the quota arithmetic in a
  comment. Not env vars — `REFRESH_INTERVAL_SECONDS` keeps its meaning as the steady-state interval.

Expected effect: the wrong-title window drops from up to 60 seconds to a few seconds, for ~200
units on show days and **zero on quiet ones**.

## Acceptance criteria

- [x] The cadence predicate is a pure function of the snapshot, table-tested: armed+idle+recent →
      fast; armed but live → normal; armed but expired → normal; no latch → normal; API off →
      normal.
- [x] An idle channel with no latch issues exactly the calls it issues today — the feature's default
      cost is pinned at zero by test.
- [x] The fast probe is a single `active` list call, not a full refresh.
- [x] A probe seeing an active broadcast triggers the full refresh, and the PRD-12 replay fires.
- [x] A latch older than the fast window still replays on the normal interval — arming early is
      never worse than arming late.
- [x] With the API kill switch off, no probe is issued.
- [x] Probe calls are counted by the quota tracker.
- [x] No test sleeps on a timer; the interval computation is asserted directly.

## Blocked by

None - can start immediately.

## User stories addressed

- User stories 1–10 (the whole PRD)

## Done

`packages/server/src/core/pollCadence.ts` holds the whole decision: `pollIntervalMs` /
`isFastWindow` are pure functions of the cache snapshot plus the kill switch, with
`FAST_POLL_INTERVAL_MS` (10s), `FAST_POLL_WINDOW_MS` (30 min) and `FAST_PROBE_COST_UNITS` (1)
carrying the quota arithmetic in their comments. Fast never polls *slower* than
`REFRESH_INTERVAL_SECONDS`: a deployment already set below 10s keeps its own speed.

`StateCache` now runs one self-rearming `setTimeout` instead of a `setInterval`, so a fast and a
normal cadence can never both be running. Each tick calls the new public `pollOnce()`, which
probes (`liveBroadcasts.list(broadcastStatus: "active")`, 1 unit) inside the fast window and does
today's full `refresh()` otherwise. A non-empty probe hands straight off to `refresh()` — no
targeting logic was duplicated, so PRD-12's replay fires through its existing path. A probe that
cannot reach YouTube goes through `recordFailure`, the same as a failed refresh; a probe raised
while a refresh is already in flight joins that run rather than spending a unit on a worse
question. `nextPollIntervalMs()` is public so the cadence can be read without waiting on a timer.

Probes are counted by the existing `instrumentQuota` patch, asserted by test. No test sleeps on a
timer. 994 tests pass.

Not done here: the real-go-live measurement, which is `issues/055-verify-fast-probe-on-a-real-golive.md`.
