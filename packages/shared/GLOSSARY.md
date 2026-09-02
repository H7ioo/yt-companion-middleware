# Canonical UX vocabulary (issue 021)

One source of truth for the user-facing words this product uses. The machine-readable copy lives
in [`src/glossary.ts`](./src/glossary.ts) and is imported by every runtime surface that can
(dashboard, server). Surfaces that can't import at runtime — the static operator guide
(`packages/server/public/guide/`) and the Companion module (`companion-module/`, a separate
bundle) — mirror these terms **by hand**. When a term changes here, grep those two and update them.

## Health states

Consumed via `HEALTH_GLOSSARY` / `describeBroadcastState`'s sibling explainer. Colour = the
Companion key colour the state lights.

| Key | Label | Colour |
|---|---|---|
| `ok` | Healthy | Green |
| `degraded` | Degraded | Yellow |
| `offline` | Offline | Grey |
| `auth_error` | Auth error | Red |

## Broadcast states

Consumed via `describeBroadcastState(status)`. Distinct from health: a healthy app can be idle.

| Key | Label | Badge |
|---|---|---|
| `live` | **On Air** | LIVE |
| `idle` | **Idle** | IDLE |

## Target

Consumed via `describeTarget(status)` / `TARGET_GLOSSARY`. Names the *resource* an edit lands on —
a different question from what the stream is doing (broadcast state) and from how the target was
chosen (the dashboard's Target readout, which says pinned vs automatic).

| Key | Label |
|---|---|
| `live` | The broadcast on air |
| `upcoming` | The next upcoming broadcast |
| `none` | No broadcast |

## Actions

Consumed via `ACTION_GLOSSARY`. These are the operator actions from PRD-07 §2 (#10).

| Key | Label | Endpoint |
|---|---|---|
| `applyPreset` | Apply preset | `/api/action/preset` |
| `update` | Update live metadata | `/api/action/update` |
| `privacyToggle` | Toggle privacy | `/api/action/privacy` |
| `undo` | Undo last change | `/api/action/undo` |
| `refreshState` | Refresh from YouTube | `/api/action/refresh` |
| `refreshLists` | Refresh lists | _(client-side re-fetch)_ |

## Settled term choices (HITL)

- Live state is **On Air** (not "on air" / "Live" / "Standby"'s opposite).
- Not-live state is **Idle** (not "Standby").
- The idle target is **the next upcoming broadcast**, never a "persistent container" [retired]:
  YouTube stopped auto-creating those on 2020-09-01 and deleted them, and a guard test
  (`src/glossaryGuard.test.ts`) fails the build if the phrase returns to an operator-facing
  surface (issue 066).
- The state refresh is **Refresh from YouTube** (not "Refresh cache" / "Refresh"); the list
  refresh is **Refresh lists**. The two never share a name.
