# 応物単位くん (Tanikun)

Tanikun is a local-first web app for planning university credits and graduation
requirements. It is built with MoonBit.

Phase 1 is complete. It implements the pure domain model, credit summaries, and
requirement evaluation. Phase 2 adds the in-memory planner UI; its contract and
evidence are in [docs/PHASE_2.md](docs/PHASE_2.md) and
[docs/PHASE_2_RESULTS.md](docs/PHASE_2_RESULTS.md). Phase 3 adds local
persistence and local Automerge replica convergence; its evidence is in
[docs/PHASE_3_RESULTS.md](docs/PHASE_3_RESULTS.md). Network sync follows in
Phase 4.

**日本語版:** [README.ja.md](README.ja.md)

## Status

- Phase 0: build, Worker, and browser-test foundation. The evidence is in
  [docs/PHASE_0.md](docs/PHASE_0.md), which is a historical record.
- Phase 1: complete. The contract is in [docs/PHASE_1.md](docs/PHASE_1.md),
  and the evidence is in [docs/PHASE_1_RESULTS.md](docs/PHASE_1_RESULTS.md).
- Phase 2: complete. The planner UI contract is
  [docs/PHASE_2.md](docs/PHASE_2.md), and the evidence is in
  [docs/PHASE_2_RESULTS.md](docs/PHASE_2_RESULTS.md).
- Phase 3: complete. Automerge/IndexedDB persistence, save/reload recovery,
  and local replica convergence are implemented; the evidence is in
  [docs/PHASE_3_RESULTS.md](docs/PHASE_3_RESULTS.md), with the storage contract
  in [ADR-0012](docs/adr/0012-automerge-planner-document.md).
  Phase 4 network sync is not started.

## Stack

- MoonBit with Rabbita and Warren
- Cloudflare Workers
- Tailwind CSS v4
- Nix for the pinned MoonBit and system toolchain
- fnm and corepack for Node.js 24.22.1 and pnpm 12.9.0

## Quick start

You need Nix with flakes enabled. direnv is optional.

The first shell entry uses fnm to download Node.js 24.22.1 from `.node-version`.
corepack provides the pinned pnpm, so you do not need a global Node.js install.
CI uses `actions/setup-node` and skips the fnm hook.

```sh
git clone git@github.com:beso1225/tanikun.git
cd tanikun
direnv allow            # or: nix develop

just setup-web          # install Warren; the first run needs network
pnpm install --frozen-lockfile

just dev-web            # http://127.0.0.1:4300
just dev-api            # http://127.0.0.1:8787/api/health
```

Run `dev-web` and `dev-api` in separate terminals.

## Common tasks

```sh
just test               # build and run the MoonBit and export tests
just lint               # formatting, types, and repository linters
just fmt                # apply the available formatters
nix flake check path:.  # sandboxed checks, including pure domain tests
```

`just test` needs the MoonBit toolchain and `pnpm install --frozen-lockfile`
for the Automerge document tests. Web tooling and browser, Worker, and D1 tests
also need the installed packages. The `just` file defines
`test-css`, `test-browser`, `test-worker`, `test-automerge`, and `test-d1`.

Mutation testing is optional and is not a CI gate:

```sh
nix develop
just setup-mutation     # first run needs network
just mutate
```

See [docs/MUTATION.md](docs/MUTATION.md) for the baseline and accepted mutants.

## Docs

- [Documentation index](docs/README.md)
- [Phase 1 contract](docs/PHASE_1.md)
- [Phase 1 results](docs/PHASE_1_RESULTS.md)
- [Phase 2 planner contract](docs/PHASE_2.md)
- [Phase 2 results](docs/PHASE_2_RESULTS.md)
- [Phase 3 results](docs/PHASE_3_RESULTS.md)
- [Mutation testing](docs/MUTATION.md)
- [Glossary](GLOSSARY.md)
- [Architecture decision records](docs/adr/README.md)
- [Phase 0 evidence](docs/PHASE_0.md), [initial design](docs/INITIAL_DESIGN.md),
  and [technical review](docs/TECH_REVIEW.md) are historical records.

## Development workflow

Changes land through pull requests. The `linux` and `lint` CI checks are
required on `main`. Direct pushes, force pushes, and branch deletion are
blocked.

## License

[MIT](LICENSE)
