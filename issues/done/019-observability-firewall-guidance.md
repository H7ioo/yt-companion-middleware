## Parent PRD

`issues/prd-06-observability.md`

## What to build

The `offline` firewall-guidance panel (PRD-06 §2): when health is `offline`, the dashboard shows
an actionable panel explaining it's a network/firewall issue (not login), with concrete
**Windows and Linux** fix steps (allow outbound HTTPS 443 to `*.googleapis.com`; Defender Firewall
allow-app; `ufw`/`firewalld` notes) and a **"Test again"** button that forces
`/api/action/refresh` and re-evaluates. Never offers reauth.

## Acceptance criteria

- [ ] `offline` shows the guidance panel with OS-specific (Win + Linux) steps.
- [ ] "Test again" triggers a forced refresh and re-checks health.
- [ ] Panel is visually/behaviorally distinct from the `auth_error` reconnect flow.

## Blocked by

- Blocked by `issues/016-observability-offline-state.md`

## User stories addressed

N/A. See PRD-06 §2 (#4).
