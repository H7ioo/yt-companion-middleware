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
- [x] The workflow is green on its own PR, and its failure mode is verified once (a deliberately
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

- [x] Web workspace has a jsdom test environment and `@testing-library/react`; the six listed
      components have render + key-branch tests.
- [x] `companion-module/src/upgrades.js` has a suite covering every upgrade step from its prior
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

Both halves of the last Part 1 criterion are observed. Green on its own PR (#18, run 32586371687,
1m14s). Red proven on a throwaway branch carrying one deliberate type error: the check failed with
`src/__ci-canary.ts(2,14): error TS2322` and `✗ preflight failed at "typecheck"` — so a broken
branch is caught *and* the log names the step. That PR (#19) and its branch are closed and deleted.

**Part 2 is untouched and remains the open work here.** Per the sequencing note, gaps 1 (web
component tests — note root `jsdom` is already installed, `@testing-library/react` is not) and 2
(`companion-module/src/upgrades.js`) are the ones worth doing before the next release.

## Progress — 2026-08-29

**Part 2, gap 2 is done.** `companion-module/src/upgrades.js` now has `src/upgrades.test.js` — 11
cases, no production code changed.

Two layers, because the file has two ways to hurt an operator. The per-step layer runs
`dropBearerToken` against the v1.x shape it migrates *from* (`{ url, token }`): token stripped,
sibling fields preserved, empty-string token stripped too, `updatedConfig: null` on a config already
on the v2 shape, and a `null` config surviving without a throw — Companion can invoke an upgrade on
a connection with nothing saved yet. The array layer pins the invariant VERSIONING.md states but
nothing enforced: the migration history is append-only. Length and `UpgradeScripts[0].name` are
asserted, so splicing a step into the middle — which silently re-points a migration an operator has
already applied — fails the gate. Appending fails it too, deliberately: that failure is the prompt
to extend the suite with the new step's own cases.

The suite was mutation-proven rather than assumed. Replacing the `{ ...config }` copy with an
in-place `delete` failed the no-mutation test; dropping the `config &&` null guard failed two
(null-config and the result-array shape check). Both mutations reverted; `upgrades.js` is
byte-identical to before.

No `companion:bump`. VERSIONING.md ties a bump to a *behaviour* change Companion must pick up, and
this ships none — precedent is `transform.test.js`, which already lives in the packaged tree.

Full suite 531 tests / 53 files green, `npm run typecheck` clean.

**Remaining in Part 2:** gap 1 (web component tests — `@testing-library/react` still not installed;
root `jsdom` is), gap 3 (`categories`/`webhook`/`socket` integration coverage), gap 4
(`packages/desktop/main.mjs`, lowest priority).

## Progress — 2026-08-30

**Part 2, gap 1 is done.** The six named components have suites — 93 cases across
`TargetConflictBanner` (6), `HealthExplainer` (7), `StatusRail` (23), `TargetPicker` (23),
`PresetFillModal` (19) and `SetupScreen` (15). No production code changed.

The environment override is a `// @vitest-environment jsdom` docblock at the top of each of the
six component files, and no root config at all. A root `vitest.config.ts` with
`environmentMatchGlobs` was written first and dropped: that option is deprecated in vitest 3 and
removed in vitest 4, and its glob covered only `src/components/**`, so a DOM test placed in
`src/lib` would have silently run on `node`. A vitest *workspace* file was the other alternative
and was rejected too: it would have meant re-declaring include/exclude for every other package to
stop the web tests running twice, for the same result. Per-file keeps the server, shared,
companion-module and scripts suites on plain `node` — they neither need jsdom nor should pay to
boot one — and survives a major bump. No React plugin is needed: vitest's esbuild reads `packages/web/tsconfig.json`
(`"jsx": "react-jsx"`) and transforms the TSX on its own. `@testing-library/react` and its
`@testing-library/dom` peer are new root devDeps; `jsdom` was already one. Auto-cleanup is not
wired globally (vitest `globals` is off repo-wide), so each file does its own `afterEach(cleanup)`.

What the tests are pointed at is the branching, not the markup — the criteria the components were
written to meet, so a rewrite that keeps the behaviour keeps the suite: the rail defaulting the
breaker to *armed* before the first state lands (so it never flashes "Paused" on load), its Target
readout naming *how* the target was chosen, the quota bar's 75/90% steps and its zero-limit
division, the picker reading nothing at all while the API is paused and treating a failed read as
no evidence rather than as an empty channel, the fill popup sending only typed values and closing
on success while a failure keeps the values, and the setup screen's three host shapes
(bundled one-click, override, headless paste) with credentials trimmed and secrets masked.

Mutation-proven rather than assumed — ten mutations, each caught, each reverted, every component
source left byte-identical: quota red moved 90→95%; the breaker default flipped to false; the
picker's `!apiEnabled` guard removed; its failed read emptying the list; the fill popup sending
blanks and staying open on success; setup saving untrimmed credentials and assuming a browser when
the probe fails; the explainer starting expanded; the banner hiding the conflict ids.

Full suite 624 tests / 59 files green (was 531/53), `npm run typecheck`, `typecheck:electron` and
`npm run build:web` clean, and `npm run companion:test`'s path filter still resolves under the new
root config.

**Remaining in Part 2:** gap 3 (`categories`/`webhook`/`socket` integration coverage) and gap 4
(`packages/desktop/main.mjs`, lowest priority).
