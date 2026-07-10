## Parent PRD

`issues/prd-06-observability.md`

## What to build

Add the 4th health state **`offline`** and failure classification (PRD-06 §0, §1). Extend
`mapYouTubeError` (or a classifier) to detect Node network codes (`ECONNREFUSED`, `ETIMEDOUT`,
`ENOTFOUND`, `EAI_AGAIN`, `ECONNRESET`) as a distinct `NETWORK_ERROR`, and update `health.ts` /
`stateCache.ts` so repeated network failures escalate `degraded → offline` (never `auth_error`) —
**fixing the bug where firewalls masquerade as auth errors**. Auth failures still jump to
`auth_error`; quota stays data-only.

## Acceptance criteria

- [ ] `healthStatusSchema` includes `offline`; server + feedback endpoints emit it.
- [ ] Network errors are classified distinctly from auth/quota.
- [ ] Repeated network failures reach `offline`, not `auth_error`; auth failures still reach `auth_error`.
- [ ] `health.ts` unit tests cover the new escalation paths.

## Blocked by

- Blocked by `issues/009-monorepo-move-desktop.md`

## User stories addressed

N/A. See PRD-06 §0 (bug), §1.
