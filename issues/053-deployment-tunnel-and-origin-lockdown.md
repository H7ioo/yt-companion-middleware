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
  issue 042): it is a construction fence while issues 043-045 are built, and comes off the day app
  enforcement is on. **No API path ever trusts a Cloudflare header as proof of identity** — the app decides
  who is who, or the Expo app and Companion would both need exceptions, and the exceptions would
  become the real security posture.
- Written down: how to redeploy this from scratch, since it lives outside the repo.

HITL — it needs the Cloudflare account and DNS.

## Acceptance criteria

- [ ] The dashboard is reachable at the real domain over TLS.
- [ ] The origin is **not** reachable by IP — verified by trying, from outside.
- [ ] Repeated failed sign-ins are rate-limited and locked out.
- [ ] No API route grants access on the basis of a Cloudflare-supplied header.
- [ ] The tunnel and firewall setup is documented well enough to rebuild without guesswork.
- [ ] The Companion machine can still reach the API over the public origin with its token.

## Blocked by

None - issue 042 settled Cloudflare's role.

## User stories addressed

- User story 10
