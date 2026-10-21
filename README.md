# 応物単位くん (Tanikun)

A local-first web app for planning university credits and graduation
requirements. Early development: Phase 0 provides the build, Worker, and
browser-test foundation.

**日本語版:** [README.ja.md](README.ja.md)

## Stack

- MoonBit with Rabbita and Warren
- Cloudflare Workers
- Tailwind CSS v4
- Nix for the pinned MoonBit and system toolchain
- fnm + corepack for Node.js 24.22.1 and pnpm 12.9.0

## Quick start

Requirements: Nix with flakes enabled. direnv is optional.

The first shell entry uses fnm to download Node.js 24.22.1 from
`.node-version`; corepack provides the pinned pnpm, so no global Node.js
installation is required. CI uses `actions/setup-node` and skips the fnm hook.

```sh
git clone git@github.com:beso1225/tanikun.git
cd tanikun
direnv allow            # or: nix develop

just setup-web          # install Warren; first run needs network
pnpm install --frozen-lockfile

just dev-web            # http://127.0.0.1:4300
just dev-api            # http://127.0.0.1:8787/api/health
```

Run `dev-web` and `dev-api` in separate terminals.

## Lint and format

```sh
pnpm install --frozen-lockfile
just lint
just fmt
```

`just lint` runs MoonBit checks, Nix linting, Just formatting, oxlint/oxfmt,
editorconfig-checker, markdownlint-cli2, stylelint, actionlint, and zizmor.
`just fmt` applies the available formatters.

## Tests

```sh
just check
just test
just test-css
just test-browser
just test-worker
just test-automerge
just test-d1
```

`test-browser` needs `just setup-web`; `test-worker`, `test-automerge`, and
`test-d1` need `pnpm install`.

## Development workflow

Changes land through pull requests. The `linux` and `lint` CI checks are
required on `main`; direct pushes, force pushes, and branch deletion are
blocked.

## Docs

- [Phase 0 plan and evidence](docs/PHASE_0.md)
- [Phase 1 design contract](docs/PHASE_1.md)
- [Initial design](docs/INITIAL_DESIGN.md)
- [Glossary](GLOSSARY.md)

## License

[MIT](LICENSE)
