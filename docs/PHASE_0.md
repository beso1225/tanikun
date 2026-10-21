# Phase 0: development foundation

This plan implements [the initial design](INITIAL_DESIGN.md) and uses
[the technical review](TECH_REVIEW.md) as a list of hypotheses to verify.
Each step should leave a small, runnable result. Phase 0 is not complete until
the web build and minimal tests also pass on Linux in CI.

## Steps and acceptance criteria

1. **MoonBit workspace and JavaScript export — complete on local macOS.**
   Add only `apps/api`, using DSL manifests and an explicit JS target.
   Run a MoonBit test and import its release output from JavaScript.
   Keep the health body as a small bridge fixture for the Workers spike.
2. **Pin the development environment with Nix and direnv — complete on local macOS.**
   Pin nixpkgs and official MoonBit distributions with hashes; establish the
   macOS/Linux platform matrix. Provide Node.js, a pinned pnpm, and just.
   Verify `nix develop` and document any initial network requirements.
3. **S1: MoonBit JavaScript on Workers — complete on local macOS.**
   Pin Wrangler and the pnpm lockfile. Wrap the generated ESM in a thin
   `export default { fetch }` entry and exercise it with the local Workers
   runtime. Node.js import success alone does not satisfy this step.
4. **S2: minimal Rabbita and Warren application — complete on local macOS.**
   Add `apps/web` and its `cmd/browser` entry. Verify development and release
   builds and record the generated artifact paths.
5. **S3: Tailwind v4 and MoonBit sources — complete on local macOS.**
   Check whether a class used only in `.mbt` appears in generated CSS.
   Use an explicit `@source` only if needed.
6. **S4: offline Nix builds and Linux CI — complete on macOS and Linux CI.**
   Pin MoonBit and pnpm dependencies for sandboxed builds. Implement
   `nix build .#web`, then `.#api` and `.#release` when
   their artifact boundaries are established. Run deterministic checks with
   `nix flake check` and add a Linux GitHub Actions workflow.
7. **Minimum browser test — complete on macOS and Linux CI.**
   Add Playwright to verify the built page, including the Tailwind fixture.
8. **Remaining review spikes — complete on local macOS.**
   S5 verifies Automerge core/IndexedDB through FFI; S6 verifies the Workers
   Vitest plugin with local D1. Add these dependencies when each spike starts.

Use just as selected in the existing design. Add shared domain modules only
when they have real consumers. Do not create cloud resources during the local
toolchain spikes.

## Step 1 evidence (2026-10-18)

Host: macOS, Apple Silicon (`Darwin arm64`). Tools already installed:

| Tool           | Observed version       |
| -------------- | ---------------------- |
| Nix            | 2.34.5                 |
| direnv         | 2.37.1                 |
| moon / moonrun | 0.1.20260920 (914d7da) |
| moonc          | v0.10.14+7d59c7ec9     |
| Node.js        | v24.20.0               |
| just           | 1.58.0                 |

These are observed host versions, not yet a reproducible environment pin.
The existing pnpm executable is a Corepack shim. `pnpm --version` attempted
to resolve `pnpm/latest` and failed with `ENOTFOUND registry.npmjs.org` in
the agent sandbox. No pnpm installation or global toolchain changes were made.

The manifests follow the official
[workspace](https://docs.moonbitlang.com/en/latest/toolchain/moon/workspace.html),
[module](https://docs.moonbitlang.com/en/latest/toolchain/moon/module.html), and
[package](https://docs.moonbitlang.com/en/latest/toolchain/moon/package.html)
documentation, checked on 2026-10-18, and were exercised with the installed CLI.

Validation from the repository root:

```sh
just check
just test
```

The MoonBit test was first run without `health_body` and failed with an
unbound identifier (Red). Adding the function made it pass (Green).
The JavaScript test checks that the release output exports a callable function
whose return value is a native string containing the expected JSON object.
No external MoonBit or npm packages are needed for this step; the installed
MoonBit standard library is used. This does not yet prove a clean installation,
a Nix sandbox build, Linux compatibility, or Workers runtime compatibility.

## Step 2: pinned Nix environment (2026-10-18)

The root `flake.nix` and `flake.lock` pin nixpkgs at
`f20cd90e28fe0403873f473b29e42662cd86e8c4`. The development shell provides:

| Tool                  | Pinned version         |
| --------------------- | ---------------------- |
| MoonBit compiler/core | 0.10.14+7d59c7ec9      |
| moon / moonrun        | 0.1.20260920 (914d7da) |
| Node.js               | 24.21.0                |
| pnpm                  | 12.9.0                 |
| just                  | 1.58.0                 |
| direnv                | 2.38.2                 |

Node.js and pnpm were later moved out of the Nix shell; see
[Node.js via fnm](#nodejs-via-fnm-2026-10-22) below.

`nix/moonbit.nix` fetches the versioned official toolchain and matching core
archives with SHA-256 hashes. It bundles core during the Nix build, following
the [official installer](https://cli.moonbitlang.com/install/unix.sh) rather
than executing that installer or modifying the host installation. The flake
permits the proprietary MoonBit compiler specifically through
`allowUnfreePredicate`.

The compiler and bundled core remain in the Nix store. The wrapper pins
`MOON_TOOLCHAIN_ROOT`; the development shell uses `.direnv/moon` as writable
`MOON_HOME` for registry metadata, caches, and subsequently installed tools.
These paths are separate in the
[pinned moon implementation](https://github.com/moonbitlang/moon/blob/914d7da/crates/moonutil/src/moon_dir.rs).
The development shell does not use the host's `~/.moon` installation. When
`.direnv/moon/registry` is absent or incomplete, the shell seeds it from the
pinned `mooncakes` closure, so a fresh clone can resolve the locked MoonBit
packages without a prior `moon update`. Run `moon update` before adding
dependencies outside that locked closure.

Enter the environment and run the existing checks:

```sh
nix develop path:.
just check
just test
```

For direnv, run `direnv allow` once in a shell with the direnv hook enabled.
The `.envrc` uses `use flake path:.`. The explicit path reference also lets
Nix see the new files before this repository's first commit; a Git flake
reference only includes files known to Git.

Run the clean build and tests inside the Nix sandbox:

```sh
nix flake check path:.
```

The check uses the full workspace, filtered sources, integration tests, and
the justfile; existing `_build` output is not an input. It runs the API, Web,
and release checks with the fixed Mooncakes and pnpm closures. Initial
provisioning requires network access to nixpkgs, the Nix binary cache, and the
official MoonBit archives. Once fixed inputs are in the store, the compiler,
MoonBit dependency resolution, and the current project checks need no network.

Platform scope:

- `aarch64-darwin`: development shell, tool versions, existing tests, and
  sandboxed `nix flake check` verified locally.
- `x86_64-linux`: outputs evaluate successfully with
  `nix flake check path:. --all-systems --no-build`; the distribution hash
  comes from the official SHA-256 sidecar. Actual build/runtime verification
  remains for a Linux runner. Linux binaries are patched with autoPatchelf.
- Other platforms are not exposed by this initial flake.

The flake exposes `packages.<system>.moonbit`, `devShells.<system>.default`,
and `checks.<system>.moonbit-js`. Web/API release packages and Linux CI remain
later steps; this check validates only the existing minimal API fixture.

## Step 3 / S1: MoonBit on local Workers (2026-10-18)

Wrangler is pinned to `4.151.1` in `package.json` and `pnpm-lock.yaml`.
Its installed workerd runtime is `1.20261012.1`; `wrangler.jsonc` pins
`compatibility_date` to `2026-10-12`, which that runtime supports. The pnpm
workspace explicitly permits the esbuild and workerd installation scripts
that prepare their native executables.

The boundary follows Cloudflare's
[fetch handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/)
and [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
documentation:

1. `moon build --target js --release --deny-warn` produces a named ESM export,
   `health_body`, in `_build/js/release/build/tanikun-api.js`.
2. `apps/api/bridges/worker.mjs` imports that function and provides Workers'
   `export default { fetch }`. It maps the path/method and wraps the MoonBit
   result in a standard `Response`.
3. Wrangler bundles the entry and generated module and runs them with local
   workerd. No `nodejs_compat` flag or runtime Node.js API is needed by this
   fixture. This result does not establish compatibility of future FFI code.

Wrangler's custom build hook rebuilds MoonBit before startup and when files
under `apps/api` change. MoonBit and the JavaScript bridge remain separate;
the MoonBit package does not import Workers APIs.

From the repository root:

```sh
nix develop path:.
pnpm install --frozen-lockfile
just test-worker
just dev-api
```

In another terminal, while `just dev-api` is running:

```sh
curl -i http://127.0.0.1:8787/api/health
```

Expected: HTTP 200, `application/json; charset=utf-8`, and `{"status":"ok"}`.
Unknown paths return 404; methods other than GET on `/api/health` return 405
with `Allow: GET`. This endpoint is a toolchain fixture, not a dependency
readiness check. `just dev-api` binds to loopback and uses local mode without
remote bindings. Wrangler telemetry is disabled in the configuration.

Validation:

- The HTTP test first failed because `wrangler.jsonc` did not exist (Red).
- After adding the configuration and bridge, `just test-worker` passed in
  local workerd (Green), checking HTTP 200/body/content type, 404, and 405.
- The test starts the real Wrangler CLI on dynamically assigned ports and
  shuts down its process group afterward. Its startup deadline is 30 seconds.
- `just check`, `just test`, and the existing `nix flake check path:.` also pass.

The HTTP test intentionally has its own command, `just test-worker`. It needs
installed npm dependencies and a local listening socket. `just test` and the
Nix check retain the deterministic MoonBit/export checks. Packaging the npm
dependency closure for sandboxed Nix release builds remains S4. Linux runtime
verification, D1 integration (S6), authentication, and deployment remain open.

## Step 4 / S2: minimal Rabbita application (2026-10-18)

Verified locally with MoonBit `0.10.14+7d59c7ec9`, Rabbita `0.16.4`, and
Warren `0.4.4`. These versions preserve the toolchain established in step 2.

Installing the latest Warren `0.4.5` failed: its sources and evol-minifier
`0.3.0` use `Int32`, which the pinned compiler does not recognize. Installing
`moonbit-community/warren@0.4.4` succeeded with evol-minifier `0.1.0`,
parser `0.2.5`, x `0.5.1`, and async `0.22.4`. Rabbita `0.16.4` resolved with
x `0.5.1`, async `0.22.4`, and moonback `0.8.5`. These are observed dependency
versions; the full Mooncakes dependency closure is not yet frozen for Nix.

The [official Warren documentation](https://github.com/moonbit-community/rabbita/blob/main/warren/README.md)
was checked against the installed CLI and its published source archive.
`warren -C /tmp new tanikun-warren-s2` successfully generated the default
template. Its browser package is named `main`, requiring `--browser-entry main`;
this repository instead uses Warren's default `cmd/browser` convention.

Repository additions:

- `apps/web/moon.mod`: JS module registered in the root `moon.work`.
- `apps/web/app`: a pure counter update and two tests for increment/reset.
- `apps/web/cmd/browser`: Rabbita state/view wiring and mounting to `#app`.
- `apps/web/public`: Japanese HTML shell and minimal ordinary CSS. Tailwind
  integration remains S3. The counter is a temporary interaction fixture.

From the repository root, in the Nix/direnv environment:

```sh
just setup-web
just dev-web
```

Open `http://127.0.0.1:4300`. Warren's development page displays the app in its
preview frame, alongside its diagnostic tools. `just setup-web` installs
Warren into the project's `.direnv/moon/bin`; it requires network access on
first setup. Moon also fetches Rabbita dependencies on the first check/build.

To produce release assets:

```sh
just build-web
```

Output: `apps/web/dist/index.html`, `index.js`, and `styles.css`. The browser
bundle was 80,345 bytes after Warren's evol minification. Warren obtains the
compiler artifact path from `moon run --build-only --target js --release
cmd/browser` JSON, then writes the static output directory. This is a local
release build, not yet `nix build .#web`.

Validation:

- Counter tests failed for the missing update/message definitions (Red), then
  passed after implementation (Green).
- `just check`, `just test` (three MoonBit tests plus the JS export test),
  `just build-web`, and `just test-worker` passed.
- Playwright CLI verified the Japanese heading, counter `0 -> 1 -> 0`, and
  both buttons in Warren development preview and in release assets served
  separately by a temporary static server. Browser logs contained only the
  expected missing optional `favicon.ico` request, with no application errors.
- `nix flake check path:.` passed for the existing API fixture on macOS.
  Its generated workspace deliberately contains only `apps/api`; it does not
  claim to build/test the Web module offline. `just check` and `just test`
  in the development environment cover the entire root workspace.

Persistent browser regression tests remain step 7. Linux builds and a fully
fixed Mooncakes/Warren dependency closure remain S4.

## Step 5 / S3: Tailwind and MoonBit sources (2026-10-18)

`tailwindcss` and `@tailwindcss/cli` are both pinned to `4.3.3` in the pnpm
manifest and lockfile. The official
[CLI installation](https://tailwindcss.com/docs/installation/tailwind-cli) and
[source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files)
documentation were checked before integration.

**Result: `.mbt` files are detected automatically.** No extension-specific
`@source` registration or safelist is needed for this application.
`apps/web/styles/input.css` imports Tailwind with `source("..")`, setting
the automatic scan base to `apps/web` independently of the shell's working
directory. That scopes extraction to the Web app instead of allowing test
files or unrelated repository content to provide candidates. Ignored build
output and generated CSS are not sources.

The input stylesheet defines CSS-first color tokens in `@theme` and basic
element rules. Layout utilities are complete literal strings in the MoonBit
view. Avoid assembling utility names through string interpolation; Tailwind
does not evaluate MoonBit expressions.

Commands in the Nix/direnv environment:

```sh
pnpm install --frozen-lockfile
just test-css
just build-web
just dev-web
```

- `just build-css` generates `apps/web/public/styles.css` from the input CSS.
  The generated file is ignored by Git.
- `just build-web` first generates minified CSS, then lets Warren copy it
  into `apps/web/dist/styles.css` alongside the HTML and JavaScript.
- `just dev-web` performs an initial CSS build, then runs both Tailwind's
  watcher and Warren. The small Node.js supervisor stops both process groups
  when interrupted or when either process exits. It targets the Unix platforms
  declared by the flake. The existing preview URL is unchanged.
- The pnpm workspace permits `@parcel/watcher`'s installation hook alongside
  the previously allowed native-tool hooks.

Validation:

- `just test-css` first failed because the Tailwind input stylesheet was
  absent (Red), then passed after integration (Green).
- The test invokes the actual Tailwind CLI into a temporary output file. It
  checks that utilities used in `.mbt` appear and that a utility candidate
  present only in the test file is excluded. No generated JS is needed.
- Playwright inspected computed styles in the development preview: a flex
  layout, 12px button gap, and the configured canvas color were applied.
  Temporarily changing only `.mbt` from `gap-3` to `gap-5` automatically
  regenerated CSS and changed the browser's computed gap to 20px. The source
  was then restored to `gap-3`. Interrupting the supervisor stopped Warren
  and released port 4300.
- The release stylesheet matched the generated public stylesheet byte for
  byte (5,899 bytes). Playwright confirmed the release page's 12px gap, flex
  layout, and canvas color after serving `apps/web/dist` separately.
- The frozen/offline pnpm install, `just check`, `just test`, `just test-css`,
  `just build-web`, `just test-worker`, and the existing API-only
  `nix flake check path:.` all passed on local macOS.

This completes local integration only. Pinning Tailwind's platform-specific
native dependencies for an offline Nix Web build, and verifying the combined
pipeline on Linux, remain S4. The existing Nix check still covers the API
fixture rather than the CSS/browser pipeline.

## Step 6 / S4: fixed dependency closures and Linux CI (2026-10-18)

Implemented release packages for both supported systems. Local macOS builds,
checks, and offline rebuilds pass. Linux CI now passes, so S4 is complete.

```sh
nix build path:.#web       # result/{index.html,index.js,styles.css}
nix build path:.#api       # result/apps/api/bridges/worker.mjs + generated ESM
nix build path:.#release   # result/web and result/api
nix flake check path:.
nix flake check path:. --all-systems --no-build
# After the inputs and tools have been provisioned:
nix build path:.#web path:.#api --offline --rebuild --no-link
```

`nix build path:.` selects the combined release by default. The API artifact
preserves the bridge's relative import layout and can be consumed as a Workers
entry. It contains no environment bindings or deployment configuration.

Dependency boundaries:

- `nix/mooncakes-lock.json` records the seven-module source closure: Rabbita
  0.16.4, Warren 0.4.4, evol-minifier 0.1.0, async 0.22.4, x 0.5.1,
  parser 0.2.5, and moonback 0.8.5. Checksums and dependency requirements
  come from the registry records and match the downloaded ZIP bytes.
- `nix/mooncakes.nix` fetches those ZIPs by hash, extracts source trees, and
  constructs a minimal registry index/cache containing only the locked
  versions. Version requirements in the published modules still apply;
  the resolver can only choose from this fixed closure. Parser's published
  generated sources do not require running yacc during these builds.
- Warren is compiled from that closure with the pinned MoonBit compiler and
  a native C toolchain. The host's installed Warren is not a build input.
- `fetchPnpmDeps` uses pnpm 12.9.0, fetcher version 4, the frozen lockfile,
  and a fixed output hash. Its forced fetch includes optional packages for
  other platforms, including Tailwind's native packages. `pnpmConfigHook`
  installs offline with lifecycle scripts disabled; CSS generation does not
  need the workerd/esbuild installation hooks.
- Project derivations use a fresh `HOME` and `MOON_HOME`, the fixed registry,
  and extracted Mooncakes sources. The source fileset excludes `_build`,
  `.mooncakes`, `.direnv`, `node_modules`, Web dist output, and generated CSS.
  Both API and Web checks use the full workspace. Only Web needs pnpm/Warren.

The first provisioning still needs network access for Nix packages, MoonBit,
Mooncakes, and npm archives. `--offline` disables Nix input fetching; network
isolation of build processes is supplied by the Nix sandbox, separately.

The clean build exposed a stale-artifact bug from the workspace expansion:
with multiple modules, Moon writes the API export to
`_build/js/release/build/beso1225/tanikun-api/tanikun-api.js`, whereas the
previous import pointed to the single-module output path. An old local file
had hidden the mismatch. The Worker bridge and export test now use the actual
workspace path; the API package preserves it.

Checks and evidence:

- The first clean Web check failed on the old API import (Red). Updating the
  import path made both clean release builds pass (Green).
- `nix flake check path:.` checks formatting, JS types, all three MoonBit
  tests, the native-string JS export, and Tailwind extraction. A separate
  release check imports the packaged Worker and checks 200/JSON, 404, and
  405/Allow, and verifies the linked HTML/JS/CSS assets. It uses no socket.
- `nix build path:.#web path:.#api --offline --rebuild --no-link` passed and
  produced the same outputs as the initial builds on macOS.
- The Wrangler/workerd HTTP test passed in a temporary source tree with no
  prior `_build` or `.mooncakes` and a fresh Moon home seeded only from the
  fixed registry. The installed npm tools were reused for this local run.
- Both supported systems pass flake evaluation. CI verifies the Linux binaries
  and the Linux pnpm store hash; fetcher version 4 hashes are per-platform.
- The local Nix daemon reports `sandbox = false` and rejects an untrusted
  client's `--option sandbox true`. These local results therefore establish
  clean inputs and offline rebuilds, **not** sandbox enforcement. Earlier
  sections' local sandbox claims should not be taken as evidence of isolation.

`.github/workflows/ci.yml` installs Nix on Ubuntu 24.04, explicitly enables
and verifies the sandbox, evaluates both systems, builds the combined release,
runs flake checks, and rebuilds Web/API offline. It also runs the existing
Wrangler/workerd HTTP test with a fresh Moon home seeded from the fixed
registry. That runtime test installs the frozen npm dependencies with their
allowed native hooks and runs outside the Nix build sandbox, where loopback
sockets are available. Actions are pinned by commit SHA. No cloud resources
or deployment credentials are required.

The workflow also passes actionlint (including its shellcheck integration).
Initial commit `fb95011` was pushed to `origin/main`; the first Linux run
([39446269536](https://github.com/beso1225/tanikun/actions/runs/39446269536))
passed all steps in 3m5s, including the browser, Workers runtime, and offline
rebuild steps. The job also verified `sandbox = true` on the runner.

## Step 7: minimum browser test (2026-10-21)

Playwright comes from the pinned nixpkgs rather than npm. That pin contains
`playwright-core` 1.64.1 and the matching Playwright browsers (Chromium
155.0.8059.79), so the test does not run `pnpm add`, `playwright install`, or
download a browser. The development shell exports:

- `PLAYWRIGHT_CORE`: the nixpkgs `playwright-core` package directory.
- `PLAYWRIGHT_BROWSERS_PATH`: the nixpkgs browser bundle.

The test imports `index.mjs` from `PLAYWRIGHT_CORE` and launches Chromium with
that browser path. This keeps the browser test reproducible and avoids writes
outside the workspace; it also means `just test-browser` must run inside
`nix develop`.

`tests/integration/browser.test.mjs` starts a loopback static server for
`apps/web/dist` (or `TANIKUN_WEB_DIST`), then checks:

- HTTP 200, the Japanese title and heading, and exactly two buttons.
- The counter changes `0 -> 1 -> 0` through the two buttons.
- Tailwind utility effects in the release stylesheet: a flex container, a
  computed `12px` gap from `gap-3`, and the configured canvas background
  color (`rgb(246, 248, 244)`).
- No uncaught page errors or console errors. The server answers the optional
  `favicon.ico` request with 204.

Commands from the repository root:

```sh
nix develop path:.
just test-browser

# Test the packaged release instead of apps/web/dist:
nix build path:.#web --out-link result-web
TANIKUN_WEB_DIST="$PWD/result-web" node --test tests/integration/browser.test.mjs
```

Validation:

- Temporarily changing only the MoonBit class from `gap-3` to `gap-5` made the
  test fail with a computed `20px` gap (Red). Restoring `gap-3` made it pass
  (Green), so the test observes the CSS generated from `.mbt` sources.
- The test passed against both `apps/web/dist` and the `nix build .#web`
  output on local macOS.
- `nix flake check path:. --all-systems --no-build` still evaluates both
  systems, including the Playwright packages on `x86_64-linux`.
- CI runs the same file against `result-web` from `nix build path:.#web`; the
  browser is not downloaded and no extra npm dependency is installed.
- `just test-worker` now keeps Wrangler's registry and cache under the ignored
  `.cache` directory, so the Workers test no longer needs a writable home
  directory.

The local Nix daemon still runs with `sandbox = false`, but the Linux CI job
verifies an enabled Nix sandbox before building. The browser step passed there
in run 39446269536.

## Step 8 / S5 and S6: review spikes (2026-10-21)

Both spikes use dependencies pinned in `package.json` and `pnpm-lock.yaml`.
The Nix `pnpmDeps` hash was updated for the larger npm closure.

### S5: Automerge core and IndexedDB through FFI

Versions: Automerge `3.5.0`, fake-indexeddb `6.2.6`, and
`moonbitlang/async` `0.22.4` with the pinned MoonBit compiler.

`spikes/automerge` is a workspace module. It models documents and changes as
opaque `#external` handles and passes serialized bytes as MoonBit `Bytes`,
which the JavaScript ABI maps to `Uint8Array`. A JS bridge installs Automerge
and IndexedDB on `globalThis`; the MoonBit side never imports npm directly.

The spike verifies:

- `save`/`load` round-trips a document through `Bytes`.
- Changes between two replicas merge through opaque change handles.
- An async MoonBit wrapper stores bytes in IndexedDB and restores them.

Commands:

```sh
nix develop path:.
just test-automerge
```

Results and reusable findings:

- Automerge 3 marks the input of `change` outdated. Branch creation must
  clone first; the bridge does `change(clone(doc), ...)`.
- `applyChanges` returns an array of documents, not a document. The bridge
  takes element `0`.
- A raw MoonBit `async fn` exported to JavaScript cannot be called directly:
  `Promise::wait` panics because no coroutine is running. Exporting a normal
  MoonBit function that returns `@js_async.Promise` and wraps the async work
  in `Promise::from_async` works: JavaScript can `await` it. The Node test now
  uses this pattern for `idb_put`/`idb_get`, and it is the recommended bridge
  shape for Phase 3. Linux CI run 39452587833 verified this export.
- The test uses fake-indexeddb in Node; real browser IndexedDB and Automerge
  WASM loading/bundling are not yet verified. That remains a browser-specific
  check for Phase 3.
- Test count: three MoonBit async tests in the spike plus three Node tests for
  the `Bytes` ABI, change handles, and the exported IndexedDB promise.

### S6: Workers Vitest plugin and local D1

Versions: Vitest `5.0.5`, `@cloudflare/vitest-plugin` `1.4.6`. The plugin
brings its own Wrangler `4.151.3` and Miniflare `5.20261019.1-beta` alongside
the directly pinned Wrangler `4.151.1`; the test uses the plugin's copy.

`apps/api/test` contains a small Worker, a test-only Wrangler configuration
with a D1 binding (`database_id` is a placeholder, never deployed), and four
Vitest tests. The tests verify:

- Per-test isolated D1 storage.
- A `BLOB` round-trip through the Worker: POST bytes, GET them back.
- A direct `env.DB` read inside the test.
- A 404 for an unknown change.

Commands:

```sh
nix develop path:.
just test-d1
```

The plugin runs Miniflare/workerd fully locally; no Cloudflare account,
remote D1 database, or network binding is used. Wrangler's registry and log
paths stay under the ignored `.cache`/`.wrangler` directories.

CI runs `just test-automerge` and `just test-d1` in the Linux job after the
Wrangler HTTP test. The sandboxed Nix checks still compile the spike from the
fixed Mooncakes closure, but run only the API/Web MoonBit tests; the FFI tests
need installed npm packages and a Node async runtime, so they run outside the
Nix build sandbox.

Phase 0 is complete: macOS development, Linux CI, the offline Nix release
build, the browser regression test, and both review spikes have runnable
evidence. Linux run
[39452587833](https://github.com/beso1225/tanikun/actions/runs/39452587833)
passed the browser, Workers runtime, S5, and S6 steps in 2m31s.

## Fresh-clone verification (2026-10-21)

A local clone of the pushed `main` branch was used to verify that no untracked
files are required. The development shell seeds the pinned Mooncakes registry,
so `just check` and `just test` work before any `moon update`.

```sh
git clone git@github.com:beso1225/tanikun.git
cd tanikun
nix develop path:.          # or direnv allow

just check
just test
just setup-web              # Warren into .direnv/moon/bin
pnpm install --frozen-lockfile
just test-css
just test-browser
just test-worker
just test-automerge
just test-d1
```

All commands passed in the clone. `just setup-web` and `pnpm install` are
required for the web and FFI/D1 tests respectively; the first one needs
network access. Without the registry seeding fix, the first `just check` in a
fresh clone failed with "module was not found in the registry".

## pnpm 12 migration (2026-10-21)

The flake now uses `pkgs.pnpm_12` (12.9.0), and `fetchPnpmDeps` uses fetcher
version 4 with a fixed-output hash per system. Fetcher version 4 keeps only the
build platform's optional packages in the store, so `nix/packages.nix` selects
the Darwin or Linux hash. `pnpm-lock.yaml` remains at `lockfileVersion: 9.0`
and its resolved dependency content is unchanged.

pnpm 12 required three configuration updates in `pnpm-workspace.yaml`:

- `allowBuilds` replaces the removed `onlyBuiltDependencies` list. The same
  three packages are approved explicitly: `@parcel/watcher`, `esbuild`, and
  `workerd`.
- pnpm 12 applies a release-age quarantine by default. This repository pins
  exact versions in the lockfile, so `minimumReleaseAge` is set to `0`.
- `pmOnFail: ignore` prevents pnpm from recording itself as an environment
  dependency in the lockfile. The Nix dev shell already pins pnpm exactly.

`just check`, all integration tests (CSS, browser, Workers, Automerge, and D1),
and `nix flake check` pass locally with pnpm 12.9.0. Linux CI (PR #1) also
passes with the Linux pnpm store hash.

## Lint and format (2026-10-21)

The repository now uses **oxlint 1.89.0** and **oxfmt 0.74.0**, installed as
exact pnpm dev dependencies. Nix additionally provides `nixfmt`, `statix`,
`deadnix`, `actionlint`, `shellcheck`, `zizmor`, `editorconfig-checker`,
`markdownlint-cli2`, and `stylelint` in the development shell. Neovim is the
primary editor; the repository relies on CLI tools rather than editor-specific
extensions.

- `.oxfmtrc.json`: 80-column formatting, import sorting enabled, package.json
  sorting disabled, prose wrapping preserved, and generated files ignored.
- `.oxlintrc.json`: correctness errors, suspicious warnings, Node/Worker/
  browser/Vitest environments, generated files ignored, and `--deny-warnings`
  enforced in CI.
- `.editorconfig` and `.editorconfig-checker.json`: UTF-8, LF, final newline,
  two-space indentation, four-space Just recipes, and Markdown indentation
  delegated to Markdown tooling.
- `.markdownlint-cli2.jsonc`: line-length disabled and generated directories
  ignored; the project documentation passes the remaining rules.
- `.stylelintrc.json`: a minimal Tailwind v4-aware rule set that allows
  `@theme`, `@source`, `@apply`, `@utility`, and `@variant`. The CSS entry
  point is expected to grow with design tokens and base-layer rules even if the
  number of CSS files stays small.
- `just lint` runs MoonBit formatting/checks, `nixfmt`, `statix`, `deadnix`,
  `just --fmt --check`, oxlint, oxfmt, editorconfig-checker,
  markdownlint-cli2, stylelint, `actionlint`, and `zizmor`.
- `just fmt` applies `moon fmt`, `nixfmt`, `just --fmt`, and oxfmt.

The initial adoption required:

- Formatting-only changes from oxfmt across Markdown, YAML, JSONC, CSS, HTML,
  JavaScript, and TypeScript.
- `nixfmt` formatting for the existing Nix files.
- Removing the unused `self` flake argument and using `inherit` where statix
  requested it.
- Setting `persist-credentials: false` on both checkout steps, as reported by
  zizmor.
- A new `lint` CI job that installs pnpm dependencies and runs `just lint`.

`just lint` and the existing test suite pass locally. The `lint` job is a
required status check on `main` together with `linux`. YAML uses `actionlint`
and oxfmt rather than a separate `yamllint`, and pre-commit hooks remain
optional. Node.js 26 is deferred until it becomes LTS.

## Node.js via fnm (2026-10-22)

The development shell no longer provides Node.js or pnpm from nixpkgs.
`.node-version` pins Node.js 24.22.1 (Krypton LTS). On the first interactive
shell entry, fnm downloads that version into `.direnv/fnm`, and corepack
installs pnpm 12.9.0 from the `packageManager` field.

- `FNM_DIR`, `XDG_STATE_HOME`, and `COREPACK_HOME` point into the repository's
  ignored `.direnv`/`.cache` directories, so no global Node.js installation is
  required or modified.
- `.envrc` watches `.node-version`, so direnv reloads the shell when the pin
  changes.
- CI installs the same version with `actions/setup-node` from
  `.node-version`, then enables corepack. The dev shell skips its fnm hook when
  `CI` is set.
- Nix build derivations still use a nixpkgs Node.js internally because they run
  in the Nix sandbox. Interactive and CI test commands use 24.22.1; the Nix
  build toolchain remains a separate reproducible environment and may lag
  behind the LTS patch level.
