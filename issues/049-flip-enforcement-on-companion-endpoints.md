## Parent PRD

`issues/prd-15-hosted-auth-and-accounts.md`

## What to build

Turn grace mode off, so `/api/action` and `/api/feedback` require a device token like everything
else. This is the moment the migration either lands cleanly or takes the Stream Deck offline.

Deliberately HITL. Two conditions, both human-judged:

1. **The evidence says it is safe** — issue 047's readout shows nothing tokenless has connected in
   **14 consecutive days, spanning at least one go-live** (settled in issue 042). Not a guess, not a
   feeling.
2. **The timing is chosen** — not a show night, and with the operator present.

Includes the rollback: if something in the field turns out to be tokenless after all, grace mode
goes back on immediately, without a redeploy.

## Acceptance criteria

- [ ] Enforcement is a runtime switch, flippable without a rebuild or a redeploy.
- [ ] With it on, a tokenless request to `/api/action` or `/api/feedback` is refused.
- [ ] `/api/feedback/health` still answers without credentials.
- [ ] The grace-mode evidence is checked and recorded before flipping.
- [ ] Rollback is exercised at least once, deliberately, before the switch is trusted.
- [ ] Companion, holding a valid token, keeps working across the flip with no reconfiguration.

## Blocked by

- Blocked by `issues/047-device-tokens-and-observable-grace-mode.md`
- Blocked by `issues/048-companion-module-carries-a-token.md`

## User stories addressed

- User story 5
