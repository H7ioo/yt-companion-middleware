# Bundled OAuth client (HITL setup)

The desktop app's one-click "Connect YouTube" flow (PRD-03 §1.1) uses a **bundled** Google OAuth
client owned by the project maintainer. Its ID + secret are injected at **build time** from CI
secrets into `packages/desktop/generated/oauth.mjs` — a **gitignored** file the shipped binary
carries but the repo never does. The build step is
[`scripts/gen-oauth-config.mjs`](scripts/gen-oauth-config.mjs), wired into `desktop:build` /
`desktop:pack` / `desktop:dev`.

**Without the secrets the build still works** — the generated constants are empty, `HAS_BUNDLED_CLIENT`
is `false`, and the app offers only the override flow (paste-your-own-credentials). That is the
expected state for local dev builds and forks.

The secret of an unverified desktop client isn't truly secret; keeping it out of git history is the
only goal here.

## One-time human steps

1. **Create the Google Cloud project + OAuth client**
   - New (or existing) Cloud project → APIs & Services → enable **YouTube Data API v3**.
   - OAuth consent screen: user type **External**, then **Publish → Production**. Leave it
     **unverified** (accepted: ≤100 users, one "Google hasn't verified this app" warning). Do **not**
     leave it in *Testing* — those refresh tokens die after 7 days.
   - Scope: `https://www.googleapis.com/auth/youtube`.
   - Credentials → Create OAuth client ID → application type **Desktop app** (or Web with the
     loopback redirect below).
   - Register the redirect URI **exactly**: `http://localhost:53682/oauth2callback`.

2. **Add the client to CI as repo secrets**
   - GitHub → repo Settings → Secrets and variables → Actions → New repository secret:
     - `YT_BUNDLED_CLIENT_ID`
     - `YT_BUNDLED_CLIENT_SECRET`
   - The `Release` workflow passes these into `npm run desktop:build`
     ([.github/workflows/release.yml](../../.github/workflows/release.yml)).

3. **Verify** a tagged/dispatched build: the generated file should log `bundled client present`, and
   the packed binary should carry the values (the repo/git history must not).

Override users register the same `http://localhost:53682/oauth2callback` redirect on their own client.
