# Versioning the Companion module

**Read this before you change anything under `companion-module/`.** It is a hard rule, not a
suggestion — humans and AI agents alike must follow it.

## Why it matters

Bitfocus Companion identifies a module and decides whether a re-imported package is a *new build*
by the **`version` in `companion/manifest.json`**. If you change the module's code but leave the
version untouched, an operator who re-imports the `.tgz` may keep running the **old** build with no
warning, or Companion may refuse to replace it. Bumping the version on every shipped change is what
makes "re-add the module → it shows as a new version → nothing breaks" true.

Two files carry the version and they **must always match**:

- `companion-module/package.json` → `version`
- `companion-module/companion/manifest.json` → `version`

A preflight (`scripts/check-version.mjs`) runs automatically before `npm run companion:package` and
**fails the build** if they drift. Never edit either version by hand — use the bump script so both
move together.

## The rule

> Any change to the module's behaviour that you want Companion to pick up **must** be accompanied by
> a version bump in the **same commit/PR**. No behaviour change ships at the same version as the
> build before it.

Choose the bump with semver intent:

| Bump | When | Command |
|---|---|---|
| **patch** | Bug fix, copy tweak, internal refactor — no new/renamed actions, feedbacks, variables, or config fields. | `npm run companion:bump patch` |
| **minor** | New action / feedback / variable / preset, or a new optional config field — backward compatible. | `npm run companion:bump minor` |
| **major** | A breaking change: an action/feedback/variable/config field is **removed or renamed**, or its options reshape. Requires an upgrade script (below). | `npm run companion:bump major` |

`npm run companion:bump` with no argument defaults to **patch**. You may also pass an explicit
version: `npm run companion:bump 2.1.0`. All commands are run **from the repo root**.

## Don't break existing buttons: upgrade scripts

Operators already have buttons wired to this module. When a **major** change removes or renames a
config field, action id, feedback id, or an option id, existing buttons would otherwise break.
Companion migrates them via **upgrade scripts** in [`src/upgrades.js`](src/upgrades.js) — an ordered
array; Companion runs the ones newer than a connection's stored state.

- **Additive changes** (new action/feedback/variable, new *optional* config field with a default) need
  **no** upgrade script — old buttons keep working untouched. Use a **minor** bump.
- **Renames / removals / reshaped options** need an upgrade script appended to the array in the
  **same PR** as the change, plus a **major** bump. Never edit or reorder existing entries — only
  append; their order is the migration history.

Keep the pure, SDK-free helpers in [`src/transform.js`](src/transform.js) and their tests in
`src/transform.test.js` — that is where new behaviour should be unit-tested (TDD) before wiring.

## The workflow, end to end

From the **repo root**:

```bash
# 1. make your change (+ tests) under companion-module/
npm run companion:test          # unit tests for the module
npm run companion:check         # node --check + version-sync guard

# 2. bump the version to match the kind of change
npm run companion:bump minor    # or patch / major / x.y.z

# 3. build the importable package (preflight re-checks version sync)
npm run companion:package       # → companion-module/yt-companion-middleware-<version>.tgz

# 4. commit everything together, then in Companion:
#    Modules → Import module package → pick the new .tgz  (shows as the new version)
```

## Checklist for every module change

- [ ] Behaviour change has a matching **version bump** (`companion:bump`) in the same PR.
- [ ] `package.json` and `manifest.json` versions **match** (the build guard enforces this).
- [ ] Renames/removals have an **appended** upgrade script in `src/upgrades.js`.
- [ ] New behaviour is covered by tests; `npm run companion:test` passes.
- [ ] `npm run companion:package` produces a `.tgz` named for the **new** version.
- [ ] Reference tables in `README.md`, `companion/HELP.md`, and the site guide
      (`packages/server/public/guide/`) reflect the change.
