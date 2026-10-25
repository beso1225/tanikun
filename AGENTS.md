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
- For behavior changes, write a failing test first.
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

`just mutate` is optional local evidence. Run `just setup-mutation` first. It is
not a required CI gate. When mutation changes, update
`docs/mutation-baseline.json` and `docs/MUTATION.md`. Kill each survivor or
accept it with a reason. Do not set a 100% CI threshold.

## Documentation

- [docs/PHASE_1.md](docs/PHASE_1.md) is the current contract.
- [docs/MUTATION.md](docs/MUTATION.md) records mutation evidence.
- [GLOSSARY.md](GLOSSARY.md) defines domain terms.
- `docs/INITIAL_DESIGN.md`, `docs/TECH_REVIEW.md`, and `docs/PHASE_0.md` are
  historical records. Do not rewrite their evidence.

Write English docs with the `technical-writing` and `unslop` guidance. Derive
Japanese docs from the English source and check them with `yomiyasu`. Use
sentence case headings, straight quotes, and no em dashes. Keep terms consistent
with `GLOSSARY.md`.

## Keep the tree clean

Do not commit `_build/`, `*.generated.mbti`, `.cache/`, `.turtles/`, result
links, or local state. Remove generated interfaces created by `moon info`.
