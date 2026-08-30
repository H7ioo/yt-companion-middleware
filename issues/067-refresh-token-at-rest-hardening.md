## Parent PRD

`issues/prd-15-hosted-auth-and-accounts.md`

## What to build

The compensating controls that issue 042 chose *instead of* encrypting the YouTube refresh token at
rest. The decision (PRD-15 §Further Notes) is that plaintext stays, because a boot-supplied key on a
single VPS lives on the same disk as the file it protects, and a key from outside the host either
needs a secret manager this deployment does not have or a human typing at every restart — which
breaks unattended recovery on show night.

That decision is only defensible if the restated threat model is actually enforced, so this issue is
the enforcement:

- **`store.json` is treated as secret material.** The data volume and the file are `0600`, owned by
  the service user, created that way by the server rather than fixed by hand after the fact — a
  fresh deployment must not have a readable window.
- **Backups and snapshots are secret too.** Wherever the data volume is backed up, the destination
  is either encrypted or excluded; written down next to the deployment notes (issue 053).
- **Never in a log or a support bundle.** Credential values must not reach the activity log, the
  audit log (050), an error message or any diagnostic export — asserted by a test, not by care.
- **A compromise-response runbook.** If the host is suspected compromised: revoke the token in the
  Google account, reconnect through issue 052, rotate the OAuth client secret. Short, in the docs,
  written before it is needed.

## Acceptance criteria

- [ ] The server creates the data directory and `store.json` with `0600`/`0700` permissions, and a
      test asserts the mode on a freshly created store.
- [ ] A test asserts no credential value can reach the logger or an error payload.
- [ ] The hosted threat model is stated in the deployment docs: whoever can read the data volume or
      a backup of it owns the channel.
- [ ] Backup handling for the data volume is documented alongside the tunnel setup.
- [ ] The compromise-response runbook exists and names the three steps.

## Blocked by

None — the permission and logging work can start immediately. The docs half sits best alongside
`issues/053-deployment-tunnel-and-origin-lockdown.md`.

## User stories addressed

None directly — it discharges the threat-model decision recorded in issue 042.
