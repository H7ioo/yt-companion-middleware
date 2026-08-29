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

- [ ] The cadence predicate is a pure function of the snapshot, table-tested: armed+idle+recent →
      fast; armed but live → normal; armed but expired → normal; no latch → normal; API off →
      normal.
- [ ] An idle channel with no latch issues exactly the calls it issues today — the feature's default
      cost is pinned at zero by test.
- [ ] The fast probe is a single `active` list call, not a full refresh.
- [ ] A probe seeing an active broadcast triggers the full refresh, and the PRD-12 replay fires.
- [ ] A latch older than the fast window still replays on the normal interval — arming early is
      never worse than arming late.
- [ ] With the API kill switch off, no probe is issued.
- [ ] Probe calls are counted by the quota tracker.
- [ ] No test sleeps on a timer; the interval computation is asserted directly.

## Blocked by

None - can start immediately.

## User stories addressed

- User stories 1–10 (the whole PRD)
