# Mutation testing

Phase 1 uses [`turtles`](https://mooncakes.io/docs/f4ah6o/turtles) to measure
whether the domain and requirements tests detect behavioral changes. Mutation
testing is local evidence, not a required CI gate yet.

## Setup

`turtles` 0.4.5 is the version compatible with the pinned MoonBit toolchain
(`moon 0.1.20260920`, `moonc 0.10.14+7d59c7ec9`). Install it once inside the
development shell:

```sh
nix develop
just setup-mutation
```

The dev shell provides `timeout` from coreutils, which turtles 0.4.5 needs on
macOS. A toolchain bump may allow turtles 0.4.7 later; keep that change separate
from the Phase 1 checks.

## Running

```sh
just mutate
```

The task mutates `packages/domain` directly. Requirements depends on the local
domain module, so `scripts/mutate-requirements.mjs` creates a temporary combined
module under `.cache/mutation-requirements`, rewrites the local import, and runs
turtles against only the requirements package.

Both runs use `--fail-under 0`: the current goal is to record and triage the
baseline, not to fail on every survivor. CI continues to run the normal test and
lint checks.

## Baseline

Recorded on 2026-10-23 with `--target js --jobs 2`. The machine-readable
baseline, including every accepted survivor, is
[mutation-baseline.json](mutation-baseline.json).

| Package      | Mutants | Killed | Survived | Timeout |  Score | Public | Private |
| ------------ | ------: | -----: | -------: | ------: | -----: | -----: | ------: |
| domain       |     155 |    154 |        0 |       1 | 99.35% | 98.59% |    100% |
| requirements |     234 |    211 |       22 |       1 | 90.17% | 98.25% |  87.57% |

The `CourseId::compare` namespace-ordering gap found in the first trial is
closed by `course id compares namespaces before local parts`. The whitespace
predicate is covered by `program id treats every Unicode whitespace as blank`.

## Refactors driven by mutation testing

The mutation run also motivated two production simplifications:

- in-progress and planned entries are no longer deduplicated while being
  collected; the merge into the standard/optimistic entry sets is the single
  deduplication point
- rule reference errors are grouped by entity kind and concatenated after
  sorting, so categories sort before courses without a rank comparator

Both changes are pinned by the existing behavior tests.

## Accepted mutants

These mutants are intentionally accepted. They are ordering-only helpers or
defensive checks whose mutated branch is unreachable for valid evaluation input.

| Location                              | Mutant                             | Reason                                                                                                     |
| ------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `domain/catalog.mbt:42`               | `low = middle + 1` to `middle - 1` | Non-terminating binary-search mutant; the harness times out.                                               |
| `requirements/credit_summary.mbt:408` | `found = false` to `true`          | `RequirementSet` guarantees every assigned category exists; the check is defensive.                        |
| `requirements/credit_summary.mbt:418` | `!found` to `false`                | Same category-table invariant.                                                                             |
| `requirements/credit_summary.mbt:488` | `order != 0` to `true`             | Failure IDs are unique per entity; the equal-ID rank branch is unreachable.                                |
| `requirements/credit_summary.mbt:493` | rank equality/ordering branches    | Only relevant when two failures share one entity ID, which valid input cannot produce.                     |
| `requirements/credit_summary.mbt:495` | rank ordering branches             | Same same-ID tie case.                                                                                     |
| `requirements/credit_summary.mbt:521` | `order != 0` to `true`             | Offering failure IDs are unique per entity.                                                                |
| `requirements/credit_summary.mbt:526` | rank equality/ordering branches    | Same same-ID tie case.                                                                                     |
| `requirements/credit_summary.mbt:528` | rank ordering branches             | Same same-ID tie case.                                                                                     |
| `requirements/credit_summary.mbt:540` | override target ordering branches  | Duplicate target/attribute pairs are rejected; attribute order does not change reference or slot validity. |
| `requirements/credit_summary.mbt:568` | slot day-ordering branches         | The comparator only canonicalizes duplicate slots; equal duplicate slots remain the same value.            |
| `requirements/credit_summary.mbt:574` | slot period-ordering branches      | Same duplicate-slot canonicalization.                                                                      |
| `requirements/credit_summary.mbt:576` | slot period-ordering branches      | Same duplicate-slot canonicalization.                                                                      |
| `requirements/category_table.mbt:52`  | `low = middle + 1` to `middle - 1` | Non-terminating lookup mutant; the harness times out.                                                      |

## Ratchet

When the accepted set is reduced or a stable threshold is agreed, add
`--fail-under <baseline>` to `just mutate`. Do not gate CI at 100%: the current
private score reflects comparator/defensive branches that are not reachable
through the public API.
