## Parent PRD

`issues/prd-14-adaptive-poll-while-armed.md`

## What to build

Not code — the measurement that tells you whether issue 054 actually worked.

PRD-14 §Further Notes is explicit: the useful number is **"seconds of wrong title on air"**, and no
unit test observes it. The 2026-08-05 test is the reference measurement (60s default → live at
23:03:24, corrected at 23:03:29 on a 15s test interval). Re-measure against the shipped fast path.

- Arm a latch, start OBS, and record: when the broadcast went live, when the probe noticed, when
  the corrected title landed.
- Record the day's quota usage before and after, to confirm the fast window cost what it was
  predicted to (~200 units) rather than something surprising.
- Write the result into PRD-14 as the new reference measurement, next to the 2026-08-05 numbers.

HITL: it needs a real go-live on the production channel with the operator starting the encoder.

## Acceptance criteria

- [ ] A real go-live is observed with the fast path shipped, and the seconds-of-wrong-title figure
      is recorded.
- [ ] Measured quota cost for the armed window is recorded and compared to the ~200-unit estimate.
- [ ] PRD-14 carries the new measurement alongside the original.
- [ ] If the observed window is materially worse than a few seconds, a follow-up issue captures why
      rather than quietly adjusting the constants.

## Blocked by

- Blocked by `issues/054-adaptive-fast-probe-while-armed.md`

## User stories addressed

- User story 1
