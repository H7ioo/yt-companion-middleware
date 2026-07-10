# PRD — UX Parity, Bug Fixes & Codebase Hygiene

Covers grill-me items **#1** (Electron font), **#10** (wording parity), **#12** (action-route
clarity), **#13** (stream-key dropdown polish), **#14** (JSDoc), **#16** (stale PNG size in guide),
**#18** (Companion error display), **#19** (refresh cache vs refresh list), **#20** (no on-demand
connection check), **#22** (guide card overflow), **#23** (copy pre-filled data), **#24** (dead
code). Small, mostly mechanical — decisions already made; this is the build list.

---

## 1. Font fix (#1) — bundle Archivo

**Root cause:** `web/src/styles.css` sets `--font-display: "Archivo"` but there is **no
`@font-face` and no Archivo file bundled** (`assets/fonts/` only holds NotoNaskhArabic, used for
PNG rendering). Archivo never loads → headings fall back to Arial in a browser and to whatever's
available in offline Electron ("messed up font").

- Self-host **Archivo** as `woff2` under the web app's assets with an `@font-face` rule (include
  the 800 weight the display headings use). No external/CDN fetch — must work offline in Electron.
- Verify in a packaged Electron build, not just the browser dev server.

## 2. Wording parity (#10) — one canonical vocabulary

Establish a single source of truth for user-facing state/action labels, reused across the
dashboard, the Companion module, and the guide. No more "on air" vs "is live" drift.

- Define the canonical terms once (e.g. a shared constants map in `@app/shared` post-monorepo, or a
  documented glossary): live/idle state, health states (`ok`/`degraded`/`offline`/`auth_error` —
  see PRD-06), action names (preset, update, privacy toggle, undo, refresh).
- Audit dashboard copy, `companion-module` action/feedback labels, and `public/guide.html` against
  the glossary and align.
- The new `offline` label (PRD-06) must be identical everywhere it appears.

## 3. Action-route clarity (#12) — keep both, document

Decision: **keep both bases, document the split as intentional** (no deprecation, no companion
bump). They are not redundant — they serve different callers through a shared handler:

- `/api/action/*` → the **Companion module**.
- `/api/dashboard/action/*` → the **dashboard SPA**.

Fix the misleading PRD-02 note and add a short comment/section (server + guide) stating the split
is by caller, both are supported, and neither is deprecated.

## 4. Stream-key dropdown (#13) — polish only

Already largely built: `PresetForm` consumes `streams: StreamInfo[]` and warns when a bound id
isn't among the channel's live streams. Remaining work is polish, not new capability:

- Ensure the stream binding is a **`<select>` dropdown** of `{title — streamName}` (not free text)
  in both `PresetForm` and `AdHocModal`, with an explicit "inherit default" option.
- Show the resolved stream label for the "inherit default" case (the form already tracks
  `defaultStreamLabel`).

## 5. Refresh cache vs refresh list (#19) — disambiguate

Two different "refresh" actions confuse users. Name and separate them everywhere:

- **Refresh state** — force a live YouTube GET to update the cached broadcast status
  (`/api/action/refresh`). "Get the current live state now."
- **Refresh lists** — re-fetch presets/categories/streams (the dashboard/Companion reference data).
  "Reload the dropdowns."
- Apply the same two labels in the dashboard buttons, the Companion action names, and the guide
  (ties into #10).

## 6. Companion error display (#18) — surface errors on a key (optional enhancement)

Today the module logs `error.code`/`message` to its **log panel only** (`main.js`), so a
`INVALID_PRESET` (deleted preset) or `MISSING_TEMPLATE_VARS` (no fallback) is invisible on the
button. Optional improvement, behind a module bump:

- Add a **`lastError` Companion variable** (code + message of the most recent failed action) so an
  operator can bind it to button text for on-stream debugging (PRD-01 §7 anticipated this).
- Documentation: explain in the guide how errors surface (log panel by default, `lastError`
  variable if bound).

## 7. No on-demand connection check in Companion (#20) — confirmed; remove if present

The module is **push-only over WebSocket** (`main.js` "No poll here"); health arrives in the pushed
state frame and WS-down is detected automatically. An on-demand connection-check action would be
redundant.

- Audit `companion-module` for any manual connection-check **action**; if one exists, remove it
  (companion bump + upgrade script per AGENTS.md). Keep the automatic WS reconnect + `health`
  variable as the single connection signal.

## 8. Guide PNG size (#16) — fix stale "72×72"

`public/guide.html` (lines ~1192, ~1207) states the button PNG is **72×72**. It is actually
rendered at **288×288** — a 72px logical face supersampled 4× (`titleImage.ts` `SIZE=72`,
`SCALE=4`) so it stays crisp when Companion downscales onto larger Stream Deck surfaces. Update the
guide copy to 288×288 (and explain the supersample rationale, since that was the blurry-image fix).

## 9. Guide card overflow (#22)

In the "fill flow" section, the API text in the **"apply (submit fires)"** card overflows the card
boundary. CSS fix: constrain/wrap long API strings (`overflow-wrap: anywhere` / `word-break` +
`max-width`) so they stay inside the card. Verify at narrow widths (the guide must not scroll
horizontally).

## 10. Copy pre-filled data (#23)

Add a **copy button to every preset row** in the dashboard that copies the pre-filled
redirect/fill data (e.g. the `/fill?preset=<id>&...` URL or the JSON payload for a Companion
button), making the redirect fill flow (PRD-02 §6) one click to wire up.

- Decide payload: default to the fill-route URL (most useful for the redirect flow); optionally a
  second "copy JSON" for the direct-API path. Confirm during build.

## 11. JSDoc everywhere in JS (#14)

Native JavaScript (not TypeScript) code must carry **JSDoc annotations** for type safety —
primarily `companion-module/` (`main.js`, `src/*.js`, `scripts/*.mjs`) and any `electron/*.mjs`.

- Add `@param`/`@returns`/`@typedef` where missing; enable `checkJs` in the relevant jsconfig so
  the annotations are actually enforced by `tsc --noEmit`.
- Keeps `companion-module/src/transform.js` (the TDD'd helpers, per AGENTS.md) typed.

## 12. Dead-code removal (#24)

Sweep and delete obsolete logic, tracked against the changes above so nothing live is removed:

- Any on-demand connection-check action (§7).
- Bearer-auth remnants (PRD-02 §8 dropped it — verify no `apiToken`/`token` leftovers).
- Unused endpoints/fields after the monorepo shared-contract extraction (PRD-04).
- Verify with the new integration tests (PRD-05 §2.1) that nothing removed was reachable.

---

## Deliverables

Font woff2 + @font-face (§1); shared vocabulary glossary + audit (§2, #10); route-split docs (§3);
stream dropdown polish (§4); refresh naming split (§5); optional `lastError` variable (§6);
connection-check removal if present (§7); guide 288×288 fix (§8); card-overflow CSS fix (§9); preset
copy button (§10); JSDoc + `checkJs` on JS packages (§11); dead-code sweep (§12).

Each companion-module-affecting change (§6, §7) carries a version bump in the same PR (AGENTS.md).
