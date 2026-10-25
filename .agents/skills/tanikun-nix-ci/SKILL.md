---
name: tanikun-nix-ci
description: "Diagnose Tanikun Nix and GitHub Actions failures. Use when a PR check fails, a Nix build fails, a source or hash is missing, or Linux CI differs from local results."
---

# Tanikun Nix CI

Use this skill when `lint` or `linux` fails. Separate a code failure from a Nix
store, network, runner, or toolchain failure before editing code.

## Read the failure

```sh
gh pr checks <number>
gh run view <run-id> --log-failed
gh run list --branch main --limit 5
```

Record the failing job, step, command, and first real error. Ignore later errors
that only report the failed dependency.

## Classify

| Symptom                                             | Check                                                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Test assertion or compiler error                    | Run the focused MoonBit package locally. Use `tanikun-moonbit-change`.                         |
| `path ... is not valid` or a missing Nix store path | Rerun the failed job before changing pins.                                                     |
| `404` for an upstream source archive                | Check the pinned version and URL. Do not raise the version without `tanikun-toolchain-update`. |
| Hash mismatch                                       | Regenerate the fixed-output hash from the current source.                                      |
| `pnpm` or Node version mismatch                     | Compare `.node-version`, `packageManager`, the CI corepack step, and `nix/packages.nix`.       |
| Generated files or dirty tree                       | Check `git status` for `_build/`, `pkg.generated.mbti`, `.cache/`, or `.turtles/`.             |
| Sandbox or network                                  | Check whether the CI runner has network access and whether the build is marked offline.        |

Do not bypass a required check, disable the sandbox, or drop a test to make CI
green.

## Reproduce locally

```sh
nix build path:.#pure --no-link
nix flake check path:. -L
```

A local Nix failure can come from a cache or source that the pinned store does
not have. Treat Linux CI as the gate when local sources are incomplete, and say
so in the report.

## Rerun or fix

For a transient runner or source failure:

```sh
gh run rerun <run-id> --failed
```

For a real failure, fix the cause and run the smallest command that covers it.
Then run `just test` and `just lint`. If the fix changes a pin, Node version,
MoonBit version, or mooncakes source, load `tanikun-toolchain-update`.

## Handoff

Report:

- failing job and step;
- root cause;
- whether the fix was code, infrastructure, or a rerun;
- commands run;
- remaining CI risk.

Do not mark a PR ready solely because a rerun passed.
