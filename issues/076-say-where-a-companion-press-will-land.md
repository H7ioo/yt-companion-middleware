## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

Make the Companion surface say where the next press will land, and let a key refuse to press when
the answer is a guess.

A Companion key that applies a preset writes to whatever `resolveTarget` picks. On air that is
unambiguous — `resolveTarget` returns the active broadcast and stops, because the encoder feeds
exactly one broadcast (`packages/server/src/youtube/broadcasts.ts`, the `active` branch). Idle, it
is inference: the stale filter drops leftovers older than 12h, then the mint rank, past-due rank,
readiness rank and scheduled time choose among what is left, and the write lands on a broadcast the
operator never named. The dashboard shows all of that evidence in the broadcast list. The surface
shows none of it — the press just happens, and it looks identical either way.

That gap is why applying a preset from a key feels unreliable. The write itself is fine; what is
missing is any way to tell, from the surface, whether the target was known or guessed.

Three parts.

**1. A target state the surface can read.** Add `target_state` — `live` / `guessed` / `pinned` /
`none` — and `target_title`, the title of the broadcast the next write would hit. `live_title`
already carries the target's title but says nothing about how it was chosen, and `no_target` only
covers the empty case. A boolean feedback `target_is_guessed` binds the `guessed` state to a key
colour, next to the existing `target_conflict` feedback.

**2. An on-air guard, per action.** Add an "Only when on air" option to `apply_preset`, `update`,
`privacy_toggle` and `privacy_set`. When set, a press while off air is refused before the request
leaves the module — logged, and written to `last_error` — the same shape `prepare_broadcast`
already uses when it refuses a press that could not have worked. Default off, so existing installs
keep behaving as they do; the option is how an operator opts into strictness for the keys they
press mid-show.

**3. Say it in the docs.** The module's help text should state the split plainly: on air, a press
lands on the broadcast that is airing; off air, it lands on the app's best guess, and the dashboard
is where that guess is settled.

## Decided against — auto-creating a broadcast on apply

Considered and rejected: a `createIfMissing` flag on a preset, so pressing a key with no broadcast
on the channel would create one and apply the preset to it.

It reads as convenient and is not. A preset press is an edit; creating a broadcast puts a public
link into the world, from a key with no dialog and no undo. PRD-16 user story 8 already settled
this — "creating a broadcast is always a deliberate press, never a side effect" — and the module's
own `prepare_broadcast` description says the same words. Auto-creation also has no safe answer for
the start time, no answer for a riding-mode channel where YouTube refuses the insert, and it walks
into `BROADCAST_LIMIT_REACHED` on any channel where unstarted strays accumulate past the 12h stale
window.

The case it was meant to serve — press one key, tonight's lecture exists with the right metadata —
is already served by preparing the broadcast on the dashboard before the show, which also leaves
exactly one upcoming broadcast for the key to hit. `prepare_broadcast` covers it from a key when
that is genuinely the only surface in the room.

## Acceptance criteria

- [ ] `target_state` and `target_title` are exposed as module variables and are updated from the
      same WebSocket push that already drives `live_title` and `no_target`.
- [ ] `target_state` is `live` when a broadcast is on air, `pinned` when the pin resolved, `guessed`
      when the app chose among upcoming broadcasts, and `none` when there is nothing to edit.
- [ ] A `target_is_guessed` boolean feedback is available and defaults to a colour distinct from
      the `target_conflict` feedback.
- [ ] `apply_preset`, `update`, `privacy_toggle` and `privacy_set` each take an "Only when on air"
      option, default off.
- [ ] With that option set, a press while off air sends no request, logs a warning, and sets
      `last_error` with a message naming why.
- [ ] With the option unset, behaviour is byte-for-byte what it is today — no upgrade script is
      needed for existing installs.
- [ ] Serving `target_state` costs no additional YouTube quota: it is derived from the cache the
      feedback endpoints already read.
- [ ] The module's connection help text states the on-air / off-air split.
- [ ] Tests cover the four target states and a refused off-air press.

## Blocked by

Nothing. Independent of issue 070 and issue 073.

## User stories addressed

- User story 11
- New user story 17, to be added to PRD-16: *As a Companion operator, I can tell from the surface
  whether the next press lands on the broadcast that is airing or on the app's best guess, and a
  key can be set to refuse the guess.*
