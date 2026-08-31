## Parent PRD

`issues/prd-15-hosted-auth-and-accounts.md`

## What to build

How the other two people get in, and how anyone gets cut off. PRD-15 §2.

**No email infrastructure**, deliberately: the deployment has no mail server and should not grow
one. An admin generates an expiring invite link and hands it over however they normally talk to
that person. Password reset is a fresh invite.

- Admin creates an invite; it expires (a day is plenty) and is single-use.
- The invitee opens it and sets their own credential. Nobody shares a login.
- Admin can revoke **one** device or session without disturbing anyone else's setup — the lost-phone
  case, and the reason a long session lifetime is acceptable at all.
- Removing an account cuts it off **immediately**: its browser session and any app token stop
  working on the very next request, not whenever they happen to lapse.

## Acceptance criteria

- [x] An admin can create an invite; a non-admin cannot.
- [x] An invite is single-use and stops working after it expires.
- [x] A person who redeems an invite sets their own credential and can sign in.
- [x] Revoking one session leaves that account's other sessions working.
- [x] Removing an account invalidates all of its sessions and tokens on the next request.
- [x] An expired or already-redeemed invite gives a clear message, not a stack trace.

## Blocked by

- Blocked by `issues/045-roles-admin-and-user.md`

## User stories addressed

- User story 2
- User story 3
- User story 4

## What was done

Shipped end to end (server → contract → dashboard), 2026-08-31.

**Server**

- `packages/shared/src/schema.ts` — `inviteSchema` and `invites` on the store. Only a SHA-256 hash
  of the token is persisted, like a session; redeemed invites are kept rather than deleted, since
  `redeemedAt` is what makes the link single-use and the record is the only durable trace of who
  let whom in until the audit log lands (issue 050).
- `packages/server/src/auth/invites.ts` — new. Create / inspect / cancel / redeem. Both the
  single-use check and the duplicate-name check are re-run **inside** the store's serialized
  update, because a link opened twice at once would otherwise pass two checks and create two
  accounts. The password is hashed before the update so scrypt does not hold the write lock.
- `packages/server/src/auth/sessions.ts` — `listFor` and `revokeById`. Revocation is scoped to
  the account as well as the session id, so a mistyped path cannot cut off somebody else.
- `packages/server/src/routes/people.ts` — invite create/list/cancel, account removal, device
  list and per-device revocation. Error handling was collapsed into one `handler` wrapper so all
  six routes report a refusal the same way. The `/invites` routes are registered ahead of the
  `/:id` ones so a future `GET /:id` cannot shadow them.
- `packages/server/src/routes/auth.ts` — `GET`/`POST /api/auth/invite`, deliberately
  unauthenticated: the person following the link has no session yet. The **role comes from the
  invite, never the request body**, and redemption signs them straight in.
- `packages/server/src/core/errors.ts` — `INVITE_INVALID`. 410 for a dead link, 400 for a
  correctable form error, so the page can tell a dead end from a retry.

**Dashboard**

- `packages/web/src/components/InviteScreen.tsx` — new. Checks the link on arrival, so a spent
  link is a dead end *before* a password is typed, and states what the invite grants before it is
  accepted. Routed in `main.tsx` ahead of every other gate, sign-in included.
- `packages/web/src/components/SettingsPanel.tsx` — invite creation (link shown once, with a
  plain warning that it will not be shown again), the invite list, Remove behind a confirm, and a
  per-person device list with single-device sign-out. The seeded admin gets no Remove button at
  all rather than one that answers 403.

**Decisions worth knowing**

- The seeded admin cannot be removed through the route. Configuration recreates it at every boot,
  so removing it deletes a person who reappears on restart.
- `POST /api/auth/invite` is unthrottled. The token is 32 random bytes, so guessing is not the
  attack — but if issue 047 adds a throttle to unauthenticated routes generally, this is one.
- Only browser sessions are cut off here. "Removing an account invalidates its **app token**"
  cannot be finished until device tokens exist (issue 047); `removeAccount` already drops
  sessions in the same write, and token revocation should join it there.

## Notes for the next iteration

- Issue 047 should extend `removeAccount` to drop device tokens in the same store update, and add
  the token half of the "cut off immediately" guarantee.
- The `people` panel is getting long. If issue 050 adds an audit log view, People probably wants
  to become its own settings tab rather than a third section.
