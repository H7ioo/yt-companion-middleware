## Parent PRD

`issues/prd-07-ux-hygiene.md`

## What to build

Dead-code sweep (PRD-07 §12, #24 + #20): remove any on-demand Companion connection-check action
(redundant with the WS push, #20), verify no Bearer-auth/`apiToken`/`token` remnants survive
(PRD-02 §8 dropped it), and drop unused endpoints/fields left after the shared-contract extraction
(PRD-04). Guard removals with the integration tests (032) so nothing reachable is deleted.

## Acceptance criteria

- [ ] Any redundant connection-check action removed (companion bump if module-facing).
- [ ] No bearer-auth/token remnants remain in code or store schema.
- [ ] Unused endpoints/fields removed; integration tests confirm nothing live was dropped.

## Blocked by

- Blocked by `issues/027-ux-route-split-docs.md`

## User stories addressed

N/A. See PRD-07 §7 (#20), §12 (#24).
