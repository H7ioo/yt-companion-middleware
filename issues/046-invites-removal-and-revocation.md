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

- [ ] An admin can create an invite; a non-admin cannot.
- [ ] An invite is single-use and stops working after it expires.
- [ ] A person who redeems an invite sets their own credential and can sign in.
- [ ] Revoking one session leaves that account's other sessions working.
- [ ] Removing an account invalidates all of its sessions and tokens on the next request.
- [ ] An expired or already-redeemed invite gives a clear message, not a stack trace.

## Blocked by

- Blocked by `issues/045-roles-admin-and-user.md`

## User stories addressed

- User story 2
- User story 3
- User story 4
