## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

The gate. **Nothing in issues 061–064 is built until this runs.** PRD-16 §Prerequisite.

Rounds 1 and 2 (August 2026) verified that a broadcast **Studio** created, correctly bound to the
reusable key with auto-start on, airs — with Studio closed and with Studio open. A broadcast **this
app** creates has never been tested. It should behave identically, same resource and same settings,
but that assumption is the foundation of the entire feature, and the last time an assumption went
unchecked here it cost a live show and months of parked work.

A throwaway script is enough — precedent exists in `packages/server/scripts/` (`dry-run-resolve.mjs`,
`get-refresh-token.mjs`). This is not product code.

1. Insert a broadcast through the API with title, description, privacy and scheduled start.
2. Bind it to the channel's existing reusable stream — the key OBS already holds.
3. Set `enableAutoStart` and `enableAutoStop`.
4. Start OBS. Observe which broadcast airs, and with what title from the first frame.

Record in the same pass:

- whether `insert` is permitted on this channel at all, and the exact refusal if not (feeds issue
  061);
- whether `enableAutoStart` coexists with `contentDetails.monitorStream.enableMonitorStream` or
  requires it off — `dry-run-resolve.mjs` already prints both;
- how long the broadcast sits in "preparing".

**If the app's own broadcast loses, this PRD is dead** and the work becomes shortening the Studio
detour instead. Write the outcome into PRD-16 either way.

## Acceptance criteria

- [ ] A script inserts, binds and configures a broadcast without touching product code paths.
- [ ] A real go-live is observed and the winning broadcast recorded.
- [ ] Insert eligibility is recorded, with the verbatim refusal if refused.
- [ ] The auto-start / monitor-stream interaction is recorded.
- [ ] The result is written into PRD-16, replacing the prerequisite section with the finding.
- [ ] If the result is negative, a follow-up issue captures the redirected scope.

## Blocked by

None - can start immediately.

## User stories addressed

- User story 3
