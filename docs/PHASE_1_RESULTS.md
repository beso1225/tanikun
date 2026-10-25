# Phase 1 results

Phase 1 is complete. It derives confirmed, standard projected, and optimistic
projected credits and requirement results from fictional in-memory input.

## Done criterion

The initial design defines Phase 1 Done as deterministic calculation of
confirmed and projected credits plus satisfaction of a fictional graduation
requirement set. The golden fixture demonstrates that criterion.

## What Phase 1 provides

- `packages/domain`: credits, IDs, calendar values, courses, offerings,
  enrollments, pass snapshots, overrides, programs, and profiles.
- `packages/requirements`: categories, category tables, requirement sets, rule
  trees, credit summaries, validation, and evaluation.
- `evaluate` returns both credit summaries and rule results for the three modes.
- `credit_summary` returns only the credit projection.
- `evaluate_rule` evaluates one rule against a mode-specific `RuleContext`.
- `correct_enrollment` replaces one enrollment and validates the new dataset.

The public contract is in [PHASE_1.md](PHASE_1.md).

## Golden scenario

The fixture in
[phase1_fixture_test.mbt](../packages/requirements/phase1_fixture_test.mbt)
contains one fictional Applied Physics program. It includes every enrollment
status and passing or failing grade, regular, year-long, intensive, and
not-offered offerings, categorized and uncategorized courses, a retired course,
projected overrides, and one explicit correction.

| Mode                 | Total credits | Root rule |
| -------------------- | ------------: | --------- |
| confirmed            |            18 | Partial   |
| standard projected   |            21 | Satisfied |
| optimistic projected |            22 | Satisfied |

The explicit correction changes E1 from in-progress to passed. Confirmed credits
become 21, and the confirmed root rule becomes Satisfied.

The tests record exact totals, category totals, and every rule result:
`packages/requirements/phase1_fixture_test.mbt`.

## Reproduction

Run these commands from the repository root:

```sh
nix develop -c just test
nix develop -c just lint
nix flake check path:.
```

`just test` runs the MoonBit tests for domain, requirements, API, and Web, plus
the JavaScript export test. `nix flake check path:.` runs the sandboxed pure,
API, Web, and release checks. Linux CI runs that check on every pull request.

## Mutation evidence

The current baseline is in [MUTATION.md](MUTATION.md) and
[mutation-baseline.json](mutation-baseline.json).

| Package      | Killed | Survived | Timeout |  Score |
| ------------ | -----: | -------: | ------: | -----: |
| domain       |    138 |        0 |       1 | 99.28% |
| requirements |    217 |       15 |       1 | 93.13% |

The remaining survivors are documented defensive or ordering-only branches.
Mutation is local evidence and is not a CI gate.

## Scope limits

Phase 1 keeps the pure model. It does not add UI, Workers, D1, Automerge,
IndexedDB, persistence, JSON contracts, or HTTP APIs.

The model keeps no revision history. `correct_enrollment` is the only operation
that replaces a passed snapshot. Revision history and audit logging remain
deferred.

## Verification

- Phase 1 issues #14 through #18, #32, and #35 through #39 are closed.
- `just test` passes.
- `just lint` passes.
- `nix flake check path:.` passes on Linux CI.
- The golden fixture records the expected values.
- The mutation baseline is documented.

Closing #19 and the Phase 1B milestone is the remaining step after this PR
merges.
