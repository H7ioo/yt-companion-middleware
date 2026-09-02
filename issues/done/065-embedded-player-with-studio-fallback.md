## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

Watch the output without leaving the app — with the limits stated in the interface, not buried in
docs. PRD-16 §4.

- Embed the public player for **public and unlisted** broadcasts.
- **Private broadcasts cannot be embedded.** Route the operator to Studio and say why.

Two things the UI must state, because getting them wrong makes the feature actively misleading:

1. **The embed is the audience's view and runs seconds to a minute behind.** It answers "is it out,
   and does it look right" — never "did the audio just cut". Issue 059's readout is the live signal.
2. **Not on the encoder machine.** It costs bandwidth and CPU on the machine already running OBS,
   and the audio plays over itself. Say so where someone would otherwise open it there.

## Acceptance criteria

- [ ] A public or unlisted live broadcast renders in an embedded player.
- [ ] A private broadcast shows a Studio link and an explanation instead of a broken embed.
- [ ] The delay is stated in the interface, next to the player.
- [ ] The encoder-machine warning is visible where it matters.
- [ ] Nothing is embedded before the broadcast is live.
- [ ] The embed never becomes the app's answer to "is ingestion healthy" — that stays issue 059.

## Blocked by

- Blocked by `issues/057-broadcast-list-which-one-will-air.md`

## User stories addressed

- User story 5
