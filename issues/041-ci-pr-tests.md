## Parent PRD

`issues/prd-05-release-safety.md`

## What to build

Two parts: a **PR test workflow**, and the test gaps it should be guarding (Part 2 below).

A **PR test workflow** — `.github/workflows/ci.yml`. Today the repo only has `release.yml` and
`nightly.yml`, both of which run on a tag/schedule, so nothing checks a pull request: a branch can
merge into `main` with red types or failing tests and the break is first seen at release time.
That is exactly the gap PRD-05 §1.1 assumes is already closed ("mirrors everything CI does").

Drive it through the existing orchestrator rather than re-listing steps in YAML: run
`npm run preflight -- --no-pack`, which is typecheck + typecheck:electron + full vitest (workspaces
and `companion-module`) + `build:all` + `smoke` + `companion:package`. Keeping one step list in
`scripts/preflight.mjs` means local preflight and CI cannot drift. `--no-pack` drops the
electron-builder `--dir` pack, which is the slow, Electron-download-heavy stage and is already
covered by `nightly.yml` / `release.yml`.

Triggers: `pull_request` (all branches) and `push` to `main`. `ubuntu-latest`, `actions/setup-node`
with `cache: npm`, `npm ci`. Add a `concurrency` group keyed on the ref with
`cancel-in-progress: true` so superseded pushes stop burning minutes.

## Acceptance criteria

- [x] `.github/workflows/ci.yml` runs on `pull_request` and on `push` to `main`.
- [x] The job runs `npm ci` then `npm run preflight -- --no-pack` and fails the check on any red step.
- [x] Node version matches the one `release.yml` uses; npm cache enabled.
- [x] `concurrency` cancels superseded runs on the same ref.
- [ ] The workflow is green on its own PR, and its failure mode is verified once (a deliberately
      broken branch shows a red check).
- [x] `RELEASING.md` / contributing docs state that PRs are gated by this check, and that local
      `npm run preflight` (with the pack) is still the pre-tag ritual.

## Blocked by

Nothing — `preflight` (issue 031) and the integration/smoke suites (issue 032) already exist.

## User stories addressed

N/A. See PRD-05 §1.1, §3.

## Part 2 — close the real test gaps first

A gate is only worth what it runs. The suite is broad already (37 test files; `api.integration.test.ts`
alone has 43 cases and does cover the target pin), so this part is not "write tests" in general — it is
four named blind spots the gate would otherwise wave through.

**1. Web components — 16 components, 0 tests.** `packages/web/src/components/*.tsx` has no test file;
only the pure helpers in `packages/web/src/lib/` are covered. Nothing catches a component that throws
on an unexpected prop shape or stops rendering an error state. Needs `jsdom` +
`@testing-library/react` (neither is installed) and a vitest environment override for the web
workspace. Start with the components carrying real branching logic, not presentational ones:
`StatusRail`, `TargetPicker`, `TargetConflictBanner`, `HealthExplainer`, `PresetFillModal`,
`SetupScreen`.

**2. `companion-module/src/upgrades.js` — untested.** Its siblings `transform.js` and vocabulary
both have suites; the upgrade-script module does not. That is the one file whose failure silently
corrupts an existing operator's Companion config on module update — the highest-cost, lowest-coverage
file in the repo. Test each upgrade step against a fixture of the old config shape it migrates from.

**3. Routes with zero integration coverage:** `categories.ts`, `webhook.ts`, `socket.ts` never appear
in `api.integration.test.ts`. Extend the existing suite (same harness) rather than adding new files:
categories list/shape, webhook auth + payload rejection, socket connect/emit contract.

**4. `packages/desktop/main.mjs` — untested.** `updater.mjs` and `gen-oauth-config.mjs` have suites;
the main process (window + tray + server lifecycle, single-instance lock) does not. Lowest priority
here — it is the hardest to test headlessly and the least likely to regress silently. Extract the
testable pure bits rather than trying to drive Electron in CI.

## Acceptance criteria — Part 2

- [ ] Web workspace has a jsdom test environment and `@testing-library/react`; the six listed
      components have render + key-branch tests.
- [ ] `companion-module/src/upgrades.js` has a suite covering every upgrade step from its prior
      config shape.
- [ ] `categories`, `webhook`, and `socket` routes are covered in `api.integration.test.ts`.
- [ ] Testable logic is extracted out of `packages/desktop/main.mjs` and covered (or the file is
      explicitly deferred with a note saying why).
- [ ] All new tests run under the existing `npm run test`, so the Part 1 gate picks them up with no
      workflow change.

## Sequencing

Part 1 (the workflow) can land first and immediately — it protects what already exists. Part 2 is
the larger body of work and can be split further if it wants its own slices; gaps 1 and 2 are the
ones worth doing before the next release.

## Out of scope

- Marking the check *required* in branch protection (repo-settings HITL, not code).
- Windows/macOS matrix builds — the real Windows build stays proven by `workflow_dispatch` on
  `release.yml` (PRD-05 §1.2).

## Progress — 2026-08-22

**Part 1 is done.** `.github/workflows/ci.yml` added; `scripts/ci-workflow.test.mjs` asserts its
shape (triggers, concurrency, Node version parity with `release.yml`, and that it drives
`preflight` rather than re-listing steps). `RELEASING.md` gained a "Every PR: the CI gate" section;
the `main is green` checklist item now points at the check, which meant syncing the mirrored
checklist in `.claude/agents/release-warden.md` — its test enforces the two stay identical.

`js-yaml` was added as a root devDep so the workflow test parses YAML instead of grepping it. It
was already in the tree via electron-builder; this only declares it.

The last Part 1 criterion — the workflow green on its own PR, plus one deliberate red — can only be
observed after the PR exists.

**Part 2 is untouched and remains the open work here.** Per the sequencing note, gaps 1 (web
component tests — note root `jsdom` is already installed, `@testing-library/react` is not) and 2
(`companion-module/src/upgrades.js`) are the ones worth doing before the next release.
