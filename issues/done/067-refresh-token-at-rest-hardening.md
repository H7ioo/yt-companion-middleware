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

- **`store.json` is treated as secret material.** The data directory is `0700` and `store.json` is
  `0600` — a directory needs its execute bit to be traversed at all, so `0600` on the directory
  locks the server out of its own store. Both are owned by the service user and created that way by
  the server rather than fixed by hand after the fact — a fresh deployment must not have a readable
  window.
- **Backups and snapshots are secret too.** Wherever the data volume is backed up, the destination
  is either encrypted or excluded; written down next to the deployment notes (issue 053).
- **Never in a log or a support bundle.** Credential values must not reach the activity log, the
  audit log (050), an error message or any diagnostic export — asserted by a test, not by care.
- **A compromise-response runbook.** If the host is suspected compromised: revoke the token in the
  Google account, reconnect through issue 052, rotate the OAuth client secret. Short, in the docs,
  written before it is needed.

## Acceptance criteria

- [ ] The server creates the data directory `0700` and `store.json` `0600`, and a test asserts both
      modes on a freshly created store.
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

## Note — 2026-09-02

Landed on `feat/067-refresh-token-at-rest-hardening`. All five acceptance criteria are met.

Two things found while building, worth carrying forward:

- **Create-time modes are not enough on their own.** `mkdir` ignores its `mode` for a directory that
  already exists and `writeFile` ignores its `mode` for a file that already exists, so every
  deployment made before this change would have kept `0755`/`0644` silently. Both writers now
  `chmod` explicitly on init. The same trap bites the atomic write: the temp file is renamed *over*
  the real file, so a `.tmp` left by a crash donates its mode to `store.json` — covered by a test.
- **`AuditLog` widened the data directory.** It re-`mkdir`s the directory on every append, so an
  audit write after the directory was recreated would have undone the store's lockdown. Fixed.

Deliberately out of scope, needs its own issue:

- **Pre-existing flake in `routes/api.integration.test.ts`.** `afterEach`'s `fs.rm` races the
  audit middleware's fire-and-forget `record()`, giving an intermittent
  `ENOTEMPTY: rmdir` on a random test (~1 run in 2, on `main` as well as here — verified by
  stashing). `AuditLog.settled()` already exists for exactly this; the test setup does not await it.
- **Backup handling is documented in `docs/data-security.md`, not next to the tunnel setup**, which
  does not exist yet. Issue 053 should link the two when it lands.
