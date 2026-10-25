---
name: tanikun-moonbit-change
description: "Implement or fix behavior in Tanikun's pure MoonBit packages. Use when changing packages/domain or packages/requirements, adding a public API, fixing a domain or requirement bug, or updating the Phase 1 golden fixture."
---

# Tanikun MoonBit change

Use this skill for behavior changes in `packages/domain` or
`packages/requirements`. Use the `tdd` skill for the general loop; this skill
adds the Tanikun paths, commands, and guardrails.

## Read first

- [AGENTS.md](../../../AGENTS.md)
- [docs/PHASE_1.md](../../../docs/PHASE_1.md)
- the ADR that covers the model you change
- [GLOSSARY.md](../../../GLOSSARY.md) when you introduce or rename a domain term

## Pick the package

| Change                                                                  | Package                 | Typical test file                          |
| ----------------------------------------------------------------------- | ----------------------- | ------------------------------------------ |
| Credits, IDs, calendar, course, offering, enrollment, override, profile | `packages/domain`       | `packages/domain/<concept>_test.mbt`       |
| Category, requirement set, rule, credit summary, evaluation             | `packages/requirements` | `packages/requirements/<concept>_test.mbt` |

The requirements package depends on the domain package. The domain package must
not depend on requirements, `apps/`, Workers APIs, or JavaScript FFI.

## Write the test first

1. Add the smallest failing test to the matching `_test.mbt` file.
2. Use the shared helpers in `test_fixtures_test.mbt` and
   `test_assertions_test.mbt` when they fit.
3. Run the focused package:

```sh
moon test --target js --deny-warn -p beso1225/tanikun-domain
moon test --target js --deny-warn -p beso1225/tanikun-requirements
```

For a behavior change, the test must fail before the implementation.

## Implement

- Keep smart constructors. Return `Result[T, DomainError]` for invalid input.
- Keep the flat `DomainError` model. Add a variant only when no existing variant
  fits.
- Preserve validation order and the current error variant.
- Keep private arrays private. Return copies from public accessors.
- Keep evaluation deterministic: count each course once per mode, preserve rule
  child order, and sort category, course, and error output by ID.
- Do not add UI, Workers, persistence, or network code to the pure packages.

## Update the golden fixture

The fixture is in `packages/requirements/phase1_fixture_test.mbt`. Change its
expected values only for an intended behavior change. For a refactor, keep every
value unchanged.

If the change affects the public contract, update `docs/PHASE_1.md` and add or
supersede an ADR.

## Verify

```sh
just test
just lint
nix build path:.#pure --no-link
```

`just test` runs the domain, requirements, API, Web, and export tests.
`nix build path:.#pure` runs the sandboxed pure check locally when the Nix store
is complete.

## Hand off

If the change touches production code or tests that mutation testing scans, load
`tanikun-mutation-refresh` and refresh the baseline after the behavior settles.

Do not commit `_build/`, `*.generated.mbti`, `.cache/`, or `.turtles/`.
