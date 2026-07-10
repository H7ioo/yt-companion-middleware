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

## Progress (2026-07-10)

**Code/infra complete — awaiting HITL to close.**

Done and verified:
- Build step `packages/desktop/scripts/gen-oauth-config.mjs` reads `YT_BUNDLED_CLIENT_ID` /
  `YT_BUNDLED_CLIENT_SECRET` and writes `packages/desktop/generated/oauth.mjs`
  (`BUNDLED_CLIENT_ID` / `BUNDLED_CLIENT_SECRET` / `HAS_BUNDLED_CLIENT`). Values JSON-encoded (quote-safe).
- `generated/` is gitignored; `git check-ignore` confirms the file is never committed.
- Absent env → empty constants + `HAS_BUNDLED_CLIENT=false`, no crash (override-only build). Verified.
- Wired into root `desktop:build` / `desktop:pack` / `desktop:dev` via `desktop:gen-oauth`.
- CI `release.yml` passes the two secrets into `npm run desktop:build`.
- 6 unit tests (`gen-oauth-config.test.mjs`); full suite 129 passing, typecheck + typecheck:electron clean.
- HITL runbook: [packages/desktop/BUNDLED-OAUTH.md](../packages/desktop/BUNDLED-OAUTH.md).

Remaining (HITL — cannot be automated):
- [ ] AC1: Create Cloud project + External/Production (unverified) OAuth client; register redirect
  `http://localhost:53682/oauth2callback`.
- [ ] AC4 (secrets half): Add `YT_BUNDLED_CLIENT_ID` / `YT_BUNDLED_CLIENT_SECRET` as GitHub repo
  secrets, then confirm a CI build carries them.

Once the human completes the two boxes above, move this issue to `issues/done/`.
