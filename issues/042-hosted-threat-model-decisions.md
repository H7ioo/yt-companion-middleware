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

- [ ] Each of the four questions has a recorded answer with its reasoning.
- [ ] PRD-15 is updated so no downstream slice has to re-derive them.
- [ ] If the refresh token is to be encrypted, a follow-up issue exists describing where the key
      comes from and what happens on a boot without it.
- [ ] The chosen session lifetime and grace threshold are stated as concrete values, not ranges.

## Blocked by

None - can start immediately.

## User stories addressed

None directly — this unblocks issues 049, 052 and 053, and may add one.
