## Parent PRD

`issues/prd-05-release-safety.md`

## What to build

The **advisory** `release-warden` agent (PRD-05 §4, #26): a `.claude/agents/release-warden.md`
subagent run before tagging that audits and reports (does not edit) — companion bump + version sync
+ upgrade script presence; doc freshness (README, HELP.md, guide) vs the diff; the implied semver
bump; preflight green + `main` pulled. Output is the RELEASING.md checklist filled in. Follows a
vertical-slice cadence (run per shippable slice).

## Acceptance criteria

- [ ] `.claude/agents/release-warden.md` defines an advisory (report-only) reviewer.
- [ ] It checks companion version sync/upgrade, doc freshness, semver intent, preflight/main state.
- [ ] Output is the filled-in RELEASING.md checklist; the human still cuts the tag.

## Blocked by

- Blocked by `issues/033-release-semver-rule.md`

## User stories addressed

N/A. See PRD-05 §4 (#26).
