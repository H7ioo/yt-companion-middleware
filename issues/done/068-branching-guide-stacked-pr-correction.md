## Parent PRD

`issues/prd-08-docs.md`

## What to build

Correct the branch-workflow guidance about **stacked PRs**, which is wrong in a way that already
cost work: PR #4 was closed, not retargeted, when its base branch went away.

The claim to kill: *"GitHub retargets a stacked PR when its base merges."* GitHub only retargets a
child PR onto the parent's base when the parent merges **and the parent's branch still exists**.
If the base branch is deleted — including by GitHub's own auto-delete-on-merge setting, which is the
common case — the child PR is **closed** instead, and its review thread goes with it.

Scope note: there is no `docs/branching-guide.md` in this repo today, and no branch-workflow
guidance anywhere under `issues/`, `.github/`, `AGENTS.md`, `README.md` or `RELEASING.md`. So this
slice is *write it, correctly*, not *edit one line*. Keep it short — the workflow rules that already
exist live in `AGENTS.md`, and this belongs beside them rather than in a new sprawling document.

What it must say:

- **Delete-on-merge and stacking are incompatible.** Either keep the parent branch alive until every
  child has merged, or do not stack.
- **Retarget the child by hand before merging the parent** (`gh pr edit <n> --base main`), which is
  the reliable move regardless of the repo's delete setting.
- **Recovery when it already happened:** a closed-by-deletion PR can be reopened only if its head
  branch survives; the commits are otherwise recovered from the local branch or a reflog, and a
  fresh PR is opened against `main`.
- Restate the existing repo rule: a branch is finished by opening
  a PR and filling *How to test*, never by merging locally.

## Acceptance criteria

- [ ] The branch-workflow guidance exists in a findable place (`AGENTS.md` section, or a doc it
      links to) and no document anywhere claims GitHub auto-retargets a stacked PR unconditionally.
- [ ] The delete-on-merge interaction is stated explicitly, naming auto-delete-on-merge.
- [ ] The manual-retarget-before-merge step is given as a concrete command.
- [ ] The recovery path for an already-closed stacked PR is written down.
- [ ] PR #4 is named as the incident, so the rule reads as history rather than as folklore.

## Blocked by

None. Small enough to fold into whatever branch is next.

## User stories addressed

None directly — contributor documentation.

## Note (2026-09-02)

Done: `AGENTS.md` gained a `## Branching and stacked PRs (hard rule)` section. No document anywhere
in the repo claimed unconditional auto-retargeting, so this was write-it-correctly, as the scope
note predicted.

Two corrections to the premise above, both checked against the record:

- **The retargeting claim is backwards, not wrong.** GitHub *does* retarget open children when the
  parent PR merges and its head branch is deleted afterwards — that is documented behaviour. The
  case that closes a child is a base branch deleted *without* its PR merging. The section is written
  for that failure mode.
- **Auto-delete-on-merge is off here.** `gh api repos/:owner/:repo --jq .delete_branch_on_merge`
  returns `false`; PR #4's branch disappearing three seconds after merge was a manual
  `--delete-branch`, not a repo setting. The section cites #4 for that, and names the setting by
  saying it is off.

The GitHub record also does not show PR #4 being closed by a deleted base: it merged into `main` on
2026-07-08, no PR in this repo has ever had a base other than `main`, and the only CLOSED PR is #19,
the deliberate CI canary.
