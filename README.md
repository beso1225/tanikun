# 応物単位くん (Tanikun)

Tanikun is a local-first web app for planning university credits and graduation
requirements. It is built with MoonBit.

Phase 1 implements the pure domain model, credit summaries, and requirement
evaluation. Phase 1 closeout is tracked in
[issue #19](https://github.com/beso1225/tanikun/issues/19). Later phases will add
the UI, persistence, and sync.

**日本語版:** [README.ja.md](README.ja.md)

## Status

- Phase 0: build, Worker, and browser-test foundation. The evidence is in
  [docs/PHASE_0.md](docs/PHASE_0.md), which is a historical record.
- Phase 1: pure domain and requirement evaluation. The contract and current
  behavior are in [docs/PHASE_1.md](docs/PHASE_1.md).
- Later phases: UI, persistence, and sync. Not started.

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

`just test` needs the MoonBit toolchain. `pnpm install` is required for web
tooling and for the browser, Worker, and D1 tests. The `just` file also defines
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
- [Phase 1 contract and implementation](docs/PHASE_1.md)
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
