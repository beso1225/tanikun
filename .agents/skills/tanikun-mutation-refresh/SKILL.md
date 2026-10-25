---
name: tanikun-mutation-refresh
description: "Refresh Tanikun's mutation baseline after production or test changes in the pure packages. Use after changes to packages/domain or packages/requirements, when line references are stale, or during Phase closeout evidence."
---

# Tanikun mutation refresh

Use this skill after production or test changes in `packages/domain` or
`packages/requirements`, or when the recorded baseline is stale. Mutation is
local evidence, not a required CI gate.

## Prerequisites

Run commands inside `nix develop`. Install the tool once if it is missing:

```sh
just setup-mutation
```

`just mutate` runs domain directly. Requirements depends on the local domain
module, so `scripts/mutate-requirements.mjs` creates a combined temporary module
and mutates only the requirements package.

## Run

```sh
just mutate
```

The task uses `--fail-under 0`. A nonzero score threshold is not set yet.

## Triage

Read the summary and the survivors from the run.

- A timeout is a mutant that does not terminate. Do not raise the timeout to
  chase it. Record it as accepted when the code path is a binary-search
  increment.
- A survivor is a mutant that passed the tests. Kill it with a focused test when
  it exposes a real gap.
- Accept a survivor only when its branch is defensive, unreachable for valid
  input, or only changes error or slot ordering in a way the public behavior
  does not observe.
- Do not accept a survivor that changes a public result, a boundary condition, or
  a credit or rule outcome.

Keep the accepted set small and explain each entry.

## Update the evidence

After triage, update both files:

- `docs/mutation-baseline.json`
- `docs/MUTATION.md`

Use the current report line numbers. Keep the summary table and the accepted
mutant table consistent. Do not copy a stale line reference from an earlier run.

The machine-readable file contains the package summaries and the survivor
records. The Markdown file explains the policy and why each accepted branch is
safe.

## Verify

```sh
just test
just lint
```

Run `just mutate` again only when the code or tests changed after the run. Do not
add a 100% CI threshold. If a threshold is introduced later, set it from a
measured baseline.

## Hand off

Report:

- package scores;
- new or removed survivors;
- tests added to kill a survivor;
- accepted survivors and their reasons.

Link `docs/MUTATION.md` and `docs/mutation-baseline.json` in the pull request.
