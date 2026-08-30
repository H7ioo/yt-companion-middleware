## Parent PRD

`issues/prd-15-hosted-auth-and-accounts.md`

## What to build

The network side: Cloudflare owns the network, the app owns authentication. PRD-15 §Solution.

- A Cloudflare tunnel as the **only** door. The origin must not be reachable by IP — otherwise
  every guard in issues 043–049 can be walked around by anyone who finds the address. The server
  binds `0.0.0.0` (`server.ts:229`), so this is the host firewall's job, not the app's.
- TLS at the edge, on the real domain.
- Rate limiting and lockout on authentication attempts.
- Cloudflare Access does **not** stay in front of the dashboard in the steady state (decided in
  issue 042): it is a construction fence while issues 043-045 are built, and comes off **only once
  app enforcement is actually on** — 043, 044, 045 and 049 all landed and deployed. Everything else
  in this issue can ship immediately; taking the fence down is the one step that waits, because
  removing it early leaves a public, unauthenticated dashboard on a real domain. **No API path ever
  trusts a Cloudflare header as proof of identity** — the app decides who is who, or the Expo app
  and Companion would both need exceptions, and the exceptions would become the real security
  posture.
- Written down: how to redeploy this from scratch, since it lives outside the repo.

HITL — it needs the Cloudflare account and DNS.

## Acceptance criteria

- [ ] The dashboard is reachable at the real domain over TLS.
- [ ] The origin is **not** reachable by IP — verified by trying, from outside.
- [ ] Repeated failed sign-ins are rate-limited and locked out.
- [ ] No API route grants access on the basis of a Cloudflare-supplied header.
- [ ] The tunnel and firewall setup is documented well enough to rebuild without guesswork.
- [ ] The Companion machine can still reach the API over the public origin with its token.
- [ ] Cloudflare Access is in front of the dashboard from the moment it is publicly reachable, and
      is removed only after 043, 044, 045 and 049 are deployed — with the dashboard verified to
      refuse an unauthenticated request from outside once it is off.

## Blocked by

None for the tunnel, TLS, firewall, rate limiting and docs — issue 042 settled Cloudflare's role and
this work can start immediately. Only the final AC (removing the Access fence) waits on
`issues/043-identity-spine-seeded-admin-and-session.md`,
`issues/044-guard-dashboard-routes-and-exemptions.md`, `issues/045-roles-admin-and-user.md` and
`issues/049-flip-enforcement-on-companion-endpoints.md` being deployed.

## User stories addressed

- User story 10
