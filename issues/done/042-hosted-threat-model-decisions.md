## Parent PRD

`issues/prd-15-hosted-auth-and-accounts.md`

## What to build

Not code — the decisions PRD-15 deliberately left open, written down so the slices that depend on
them stop guessing. Each answer is recorded in the PRD (§Further Notes, or the relevant section)
with its reasoning, and any implementation work an answer implies is raised as a new issue.

Four questions:

1. **The refresh token at rest.** PRD-01 §6 accepts plaintext in `store.json` because disk access
   implies compromise. On a rented host there are snapshots, backups and a provider, and the token
   is full write access to the channel. Encrypt it with a key supplied at boot, or restate the
   threat model explicitly for hosted deployments? If "encrypt", open a follow-up issue.
2. **Session lifetime.** The operator wants a month or a year so nobody types a password mid-show.
   Pick the number, and confirm that per-device revocation (issue 046) is the mitigation.
3. **The grace-window exit threshold.** The "N days with no tokenless client" that gates issue 049.
4. **Cloudflare's role.** PRD-15 puts authentication in the app and Cloudflare on the network. Does
   Access stay in front of the dashboard as a second layer, or is the tunnel its whole job?

## Acceptance criteria

- [x] Each of the four questions has a recorded answer with its reasoning.
- [x] PRD-15 is updated so no downstream slice has to re-derive them.
- [x] If the refresh token is to be encrypted, a follow-up issue exists describing where the key
      comes from and what happens on a boot without it.
- [x] The chosen session lifetime and grace threshold are stated as concrete values, not ranges.

## Blocked by

None - can start immediately.

## User stories addressed

None directly — this unblocks issues 049, 052 and 053, and may add one.

## Outcome

All four answered and recorded in PRD-15; nothing downstream has to re-derive them.

1. **Refresh token at rest — plaintext stays, threat model restated** (PRD-15 §Further Notes). A
   boot-supplied key on a single VPS sits on the same disk as the file it protects, so a snapshot
   takes both; a key from outside the host needs a secret manager this deployment does not have, and
   a typed-at-boot key breaks unattended restart, which is unacceptable for a show-night tool. The
   honest statement is that `store.json` is secret material and whoever reads the data volume or a
   backup owns the channel — with the controls that follow from that raised as
   `issues/067-refresh-token-at-rest-hardening.md`. Rotation is the real mitigation, and issue 052
   makes it two clicks.
2. **Session lifetime — 30 days idle, refreshed on each authenticated request; 90 days absolute**
   (PRD-15 §2). A year means a stolen laptop stays authorised for a year and recovery depends on
   somebody remembering to revoke. Thirty days sliding means a weekly user never sees a password
   (user story 1) while a quiet device drops off unaided. Per-device revocation (issue 046) is
   confirmed as the mitigation for the devices that do not go quiet.
3. **Grace-window exit threshold — 14 consecutive days with zero tokenless connections, spanning at
   least one go-live** (PRD-15 §4). Usage here is show-shaped, not daily: seven days can be one
   quiet week, and the Companion machine may only be powered up on show night. Issue 047's readout
   must therefore surface *days since the last tokenless connection*, not only a list of offenders.
4. **Cloudflare — tunnel, TLS and rate limiting; Access is a construction fence, not a second
   layer** (PRD-15 §Solution). Access stays in front of the dashboard only while issues 043–045 are
   being built, and comes off the day app enforcement is on. A second door on the browser path with
   no second door on the API path is defence in depth in name only, and it makes every future access
   problem start with "which lock refused me?".

These are reversible decisions, not discoveries — if the operator wants a year-long session or an
encrypted token, the reasoning above is what to argue with.
