## Parent PRD

`issues/prd-03-auth.md`

## What to build

Set up the **bundled OAuth client** and its build-time injection (PRD-03 §1.1). Create the Google
Cloud project + OAuth client (consent screen **External + Production, unverified**), register the
loopback redirect `http://localhost:53682/oauth2callback`, and add a build step
(`packages/desktop/scripts/gen-oauth-config.mjs`) that reads `YT_BUNDLED_CLIENT_ID` /
`YT_BUNDLED_CLIENT_SECRET` from the CI env into a gitignored generated constant. Absent env →
empty constant (local dev builds simply offer only the override flow). HITL: needs the human to
create the Cloud project + provide the secret to CI.

## Acceptance criteria

- [ ] Cloud project + OAuth client exist; consent screen is External/Production; redirect URI registered.
- [ ] Build step generates `packages/desktop/generated/oauth.*` from CI env; file is gitignored.
- [ ] Missing env yields empty constants and no crash (override-only build).
- [ ] Bundled client ID/secret are present in the CI-built binary, absent from the repo/git history.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

- User story 1, 2 (foundation)
