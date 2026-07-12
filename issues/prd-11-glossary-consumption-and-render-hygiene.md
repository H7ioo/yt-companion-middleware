# PRD-11 — Make the health glossary actually consumed, and quiet the idle dashboard

Source: multi-agent code review of branch `feat/032-release-integration-tests` (reuse/altitude/efficiency angles). Both findings were CONFIRMED against the working tree.

## Problem Statement

1. **The canonical health palette has zero consumers.** Issue 021 established `HEALTH_GLOSSARY` in the shared package as the single source of truth for health-state copy and colors, and its `keyColor` field (Green/Yellow/Grey/Red) is documented as canonical — but nothing at runtime reads it. Three independent hand-written copies exist instead: the web status rail's lamp map, the Companion module's RGB color table, and the operator guide's hand-copied health table (guarded only by a "keep in lockstep" comment, unlike the web explainer and layouts page which have glossary parity tests). This is exactly the drift class issues 017/021 were opened to kill: recolor or reword a state in the glossary and the lamp, the Stream Deck button, and the manual silently diverge. The same pattern repeats for the Companion's non-health colors (on-air red, busy blue, active-preset green), which are hardcoded in three places including a test that asserts the literal rather than importing the source.

2. **The idle dashboard re-renders constantly.** The activity panel's 4-second log poll replaces its entries state unconditionally, re-rendering the full (up to 200-row) list and recomputing its memos ~15×/minute even when the ring buffer is byte-for-byte unchanged. The 60-second app-info poll similarly sets a fresh object every tick, reconciling the root tree for a value that changes only when an update downloads.

## Solution

Close the loop the glossary started: every surface either imports the glossary directly (web) or is bound to it by a parity test (Companion, guide — which cannot import the shared package at runtime). Colors and copy get exactly one authoritative definition each. Separately, both poll loops become steady-state no-ops: they only set state when the fetched payload actually differs.

## User Stories

1. As a maintainer, I want the web status lamp's colors derived from the shared glossary, so that a glossary recolor propagates to the dashboard without a second edit.
2. As a maintainer, I want a parity test binding the Companion module's health colors to the glossary's key colors, so that a palette change that misses the Companion fails CI instead of shipping drift.
3. As a maintainer, I want the operator guide's health table generated from or tested against the glossary, so that the manual can never contradict the app (the drift issue 021 was opened to kill).
4. As a maintainer, I want the Companion's on-air/busy/active-preset colors defined once and imported by the layouts page and its drift test, so that a rebrand is a one-line change.
5. As a docs reader, I want the guide's health meanings to match the dashboard tooltips word-for-word, so that I trust the manual as authoritative.
6. As a streamer with the dashboard open all stream, I want the activity panel to re-render only when a new log entry arrives, so that an idle dashboard costs near-zero CPU.
7. As a streamer, I want the once-a-minute app-info poll to be a no-op when nothing changed, so that the whole dashboard tree doesn't reconcile for a static version chip.
8. As a maintainer, I want misleading "shared with the guide" comments corrected or made true, so that the next developer isn't promised a link that doesn't exist (firewall-guidance copy).

## Implementation Decisions

- **Web lamp:** the status rail's health-lamp map is derived from the glossary's `keyColor` (a small keyColor→CSS-class map), removing the independent per-state table. The glossary stays the single runtime source for the web package, extending the pattern the health explainer already uses.
- **Companion module:** it ships standalone and cannot import the shared package at runtime, so its color table stays local — but a parity test (in the monorepo test suite, which can import both) asserts the Companion's health RGB values correspond to the glossary's key colors, and that its label/copy strings match glossary labels. Same treatment for the non-health palette: layouts data and the guide-layouts drift test import the module's exported constants instead of re-asserting literals.
- **Guide health table:** generated at docs-build time from the glossary (preferred, matching the existing data-driven docs generator), or — if generation is disproportionate — covered by a docs test that parses the table and diffs it against glossary meanings, matching the prior art of the layouts-page test. Either way the "keep in lockstep" comment stops being the only guard.
- **Firewall-guidance copy:** the module-header claim of a shared canonical string is made true (guide references the same source or a parity test binds them) or the comment is corrected to state the copy is web-only.
- **Activity panel poll:** skip the state update when the fetched rows equal current state (compare length + newest entry timestamp/id — cheap and sufficient for an append-only ring buffer).
- **App-info poll:** gate the state update on a real diff of the fields that matter (version, update status, update version).
- Deliberately **not** moving log delivery onto the SSE channel in this PRD — it's a larger contract change; the diff-gate removes nearly all the waste at a fraction of the risk.

## Testing Decisions

- Good tests assert observable parity and behavior, not implementation: "Companion health RGB equals glossary key color" rather than "function X called".
- **Parity tests** are the core deliverable: glossary ↔ Companion colors/labels, glossary ↔ guide health table, Companion palette ↔ layouts page. Prior art: `healthExplainer.test.ts` and `guide-layouts.test.mjs` already diff surfaces against sources — extend that pattern to the missing surfaces.
- **Poll no-op tests:** component-level test that an identical fetched payload does not produce a new entries array reference (assert referential stability), and that a new entry does.
- No snapshot tests of rendered colors — assert the mapping data, not pixels.

## Out of Scope

- Moving activity-log delivery from polling to the SSE stream.
- Any change to the glossary's actual copy or palette values.
- The `degraded` copy weakness for multi-hour outages ("usually clears on the next poll") — worth a wording pass later, but not a drift/hygiene item.
- Smaller simplification nits from the review (duplicated init defaults in the Companion module, hardcoded category-chip array, double fill-URL construction, split error-categorization ternary) — fold these into the touched files opportunistically while implementing, but they don't drive this PRD.

## Further Notes

- The review's altitude angle framed this well: the glossary generalization "stops short" at the surfaces that can't import it. The fix is not forcing imports everywhere — it's ensuring every non-importing surface has a test-time binding, so drift is a CI failure, not a doc bug report.
