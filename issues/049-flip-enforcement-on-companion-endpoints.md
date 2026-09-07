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

- [x] Enforcement is a runtime switch, flippable without a rebuild or a redeploy.
- [x] With it on, a tokenless request to `/api/action` or `/api/feedback` is refused.
- [x] `/api/feedback/health` still answers without credentials.
- [ ] The grace-mode evidence is checked and recorded before flipping.
- [ ] Rollback is exercised at least once, deliberately, before the switch is trusted.
- [ ] Companion, holding a valid token, keeps working across the flip with no reconfiguration.

## Blocked by

- Blocked by `issues/047-device-tokens-and-observable-grace-mode.md`
- Blocked by `issues/048-companion-module-carries-a-token.md`

## User stories addressed

- User story 5

## Progress — 2026-09-07: the switch is built, the flip is not done

The code half of this issue is finished. **The issue stays open**: the three remaining criteria are
the human-judged ones, and none of them can be met from a keyboard here.

**What was built**

- `PUT /api/dashboard/devices/grace` (`packages/server/src/routes/devices.ts`) sets enforcement at
  runtime and answers with the readout. A `PUT` rather than two verbs, so the rollback is the same
  motion as the flip.
- Deliberately **not** gated on `readout().met`. The evidence is judged by the person reading the
  two gauges — a server that refuses to flip early is also a server that cannot roll back.
- A control in the grace panel under **Settings → Machines**, next to the evidence it is read from.
  Turning the requirement **on** confirms first and names the machine last seen connecting without
  a key; turning it **off** does not confirm. That asymmetry is intentional: the rollback is the
  recovery from a dark Stream Deck at 8pm, and a dialog in front of it is a dialog nobody reads.
- Audited both ways as "turned the key requirement on/off" via `noteAudit` — the path alone cannot
  say which direction it went, and the direction is the question.
- Guide (`guide/companion.html`) now says where the switch is.

**Fixed on the way**: this router answered *every* validation failure with "Give the machine a
name.", so a bad enforcement value got advice about naming a machine. Messages are per-route now.

**Blocked on the operator** — what is left is the flip itself:

1. Read the two gauges and record the evidence (14 quiet days **and** ≥1 go-live). At the time of
   writing this has not been checked against a live deployment.
2. Pick a night that is not a show night, with the operator present.
3. Press **Require a key**, confirm Companion still runs a cue on its token, then deliberately
   exercise **Stop requiring a key** once before trusting the switch.

Rollback needs no redeploy: it is the same button. If the dashboard itself is unreachable, the
`grace.enforcing` flag in `store.json` is the manual way back.
