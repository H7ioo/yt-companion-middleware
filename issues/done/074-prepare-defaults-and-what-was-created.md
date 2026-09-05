## Parent PRD

`issues/prd-16-broadcast-list-and-scheduling.md`

## What to build

Two corrections to the Prepare panel, both about it being honest with the operator up front.

**1. Public is the default, not unlisted.**

`PrepareBroadcast` opens on `unlisted`, and the server falls back to `unlisted` when the request
names no privacy. For a channel whose whole purpose is a public broadcast, the safe-looking
default is the wrong one — it means a show goes out unlisted whenever nobody touched the field.
Change both, so the form and the API agree on what an unspecified privacy means.

A selected preset still overrides the field with its own privacy, and that stays: the preset is a
recorded decision, and a default is only what applies when no decision was recorded. Presets that
say `unlisted` keep saying it until edited. Worth stating in the PR, because it means changing the
default will not change what your existing presets create.

**2. Say what was created, and what it will do.**

The form silently sets auto-start and auto-stop, and the panel only mentions it afterwards in a
single line under the link. Two gaps:

- **Before the press**, the form does not say that the broadcast will start when OBS starts and
  end when OBS stops. That is the most consequential thing about the broadcast being made, and it
  is stated only after it is made.
- **After the press**, the "Share this" strip shows the title and the link but not the details it
  was created with — the start time, the privacy, the ingestion key it was bound to. Those are
  exactly what an operator wants to confirm at a glance before sending the link out.

## Acceptance criteria

- [ ] The Prepare form opens with privacy set to public.
- [ ] A prepare request that names no privacy and uses no preset creates a public broadcast.
- [ ] A preset's own privacy still wins over the default, and a test covers it.
- [ ] The form states, before the create press, that the broadcast starts when the encoder starts
      and ends when it stops.
- [ ] The post-create strip shows start time, privacy and bound ingestion key alongside the title
      and link.
- [ ] The strip continues to lead with the link, which is the panel's whole output.
- [ ] The existing warning path — a partial preparation — still takes precedence over the details
      line rather than sitting beside it.

## Blocked by

Nothing.

## User stories addressed

- User story 2
- User story 8
