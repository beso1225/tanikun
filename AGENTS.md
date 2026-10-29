# Agent guide

Read [README.md](README.md) and [docs/README.md](docs/README.md) before changing
behavior.

## Project

Tanikun is a local-first MoonBit web app for planning credits and graduation
requirements.

- `packages/domain`: pure domain model. It depends only on the MoonBit core.
- `packages/requirements`: pure requirements and evaluation. It depends on
  `packages/domain`.
- `apps/api` and `apps/web`: Workers and browser entry points.

Keep dependencies one-way. The pure packages must not import `apps/`, Workers
APIs, JavaScript FFI, persistence, or network code.

## Rules

- Phase 1 uses one flat `DomainError`. Do not split it without an ADR.
- Evaluation is deterministic: count each course once per mode, preserve rule
  child order, sort output by ID, and never depend on input array order.
- Use `tanikun-moonbit-change` for behavior changes in the pure packages.
- Use `tanikun-mutation-refresh` after changes that mutation testing scans.
- Use `tanikun-docs-update` for README, docs, ADR, AGENTS, and wording changes.
- Use `tanikun-pr-review` for PR review and merge work.
- Use `tanikun-nix-ci` when a CI check fails.
- Use `tanikun-toolchain-update` for version or dependency pin changes.
- Keep refactors separate from behavior changes. The golden fixture in
  `packages/requirements/phase1_fixture_test.mbt` keeps its expected values
  during a refactor.
- Use small commits. Public commits, pull requests, and primary docs are written
  in English.
- Review the full diff. Do not merge without approval, and resolve review
  threads after fixing the code.

## Toolchain and commands

Run commands inside `nix develop`. Node.js 24.22.1 and pnpm come from fnm and
corepack. Do not replace them with global installs.

```sh
just test
just lint
just fmt
nix flake check path:.
```

`just test` covers domain, requirements, API, Web, and the JavaScript export
test. Pure tests need MoonBit only. Web, browser, Worker, and D1 tests need
`pnpm install --frozen-lockfile`.

`just mutate` runs the local mutation baseline. It is not a required CI gate.
Load `tanikun-mutation-refresh` before updating the baseline.

## Project skills

- [tanikun-moonbit-change](.agents/skills/tanikun-moonbit-change/SKILL.md):
  TDD, package boundaries, focused tests, golden fixture, verification.
- [tanikun-mutation-refresh](.agents/skills/tanikun-mutation-refresh/SKILL.md):
  mutation run, survivor triage, baseline updates.
- [tanikun-docs-update](.agents/skills/tanikun-docs-update/SKILL.md):
  current and historical docs, English and Japanese writing, link checks.
- [tanikun-pr-review](.agents/skills/tanikun-pr-review/SKILL.md):
  review comments, checks, thread resolution, merge, main CI.
- [tanikun-nix-ci](.agents/skills/tanikun-nix-ci/SKILL.md):
  Nix and GitHub Actions failure triage.
- [tanikun-toolchain-update](.agents/skills/tanikun-toolchain-update/SKILL.md):
  MoonBit, Node.js, pnpm, Warren, mooncakes, and turtles pins.
- [verify](.agents/skills/verify/SKILL.md):
  drive the built planner page in Chromium; doctor, journeys, and evidence
  under `.cache/verify/`.

## Documentation

- [docs/PHASE_1.md](docs/PHASE_1.md) is the current contract.
- [docs/PHASE_1_RESULTS.md](docs/PHASE_1_RESULTS.md) records the Phase 1
  evidence.
- [docs/PHASE_2.md](docs/PHASE_2.md) is the current Phase 2 planner contract.
- [docs/PHASE_2_RESULTS.md](docs/PHASE_2_RESULTS.md) records the Phase 2
  evidence.
- [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) is the planner UI baseline.
- [docs/MUTATION.md](docs/MUTATION.md) records mutation evidence.
- [GLOSSARY.md](GLOSSARY.md) defines domain terms.
- `docs/INITIAL_DESIGN.md`, `docs/TECH_REVIEW.md`, and `docs/PHASE_0.md` are
  historical records. Do not rewrite their evidence.

Public docs are English. Japanese docs are derived from the English source and
checked with `yomiyasu`. Load `tanikun-docs-update` for the full procedure.

## Keep the tree clean

Do not commit `_build/`, `*.generated.mbti`, `.cache/`, `.turtles/`, result
links, or local state. Remove generated interfaces created by `moon info`.
