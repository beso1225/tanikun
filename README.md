# 応物単位くん (Tanikun)

A local-first web app for planning university credits and graduation
requirements. Early development: Phase 0 provides the build, Worker, and
browser-test foundation.

**日本語版:** [README.ja.md](README.ja.md)

## Stack

- MoonBit with Rabbita and Warren
- Cloudflare Workers
- Tailwind CSS v4
- Nix for the pinned toolchain, pnpm for npm dependencies

## Quick start

Requirements: Nix with flakes enabled. direnv is optional.

```sh
git clone git@github.com:beso1225/tanikun.git
cd tanikun
direnv allow            # or: nix develop path:.

just setup-web          # install Warren; first run needs network
pnpm install --frozen-lockfile

just dev-web            # http://127.0.0.1:4300
just dev-api            # http://127.0.0.1:8787/api/health
```

Run `dev-web` and `dev-api` in separate terminals.

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

## Docs

- [Phase 0 plan and evidence](docs/PHASE_0.md)
- [Initial design](docs/INITIAL_DESIGN.md)
- [Glossary](GLOSSARY.md)

## License

[MIT](LICENSE)
