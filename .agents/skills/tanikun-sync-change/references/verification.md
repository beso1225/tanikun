# Verification

Read this when you run the sync checks, change the harness, or add a fault case.
The existing `SyncHarness` in `tests/integration/sync-harness.mjs`,
`just test-sync` for Phase 4, and `just test-session-proof` for Phase 5 own the
real runs. Do not add a second browser framework, a new endpoint, or a
standalone doctor command.

## Choose the layer

| Change                                        | Command                                                                                                                                    | What it proves                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Contract, transport, coordinator, persistence | `node --test tests/integration/sync-transport.test.mjs tests/integration/sync-coordinator.test.mjs tests/integration/persistence.test.mjs` | Pure JavaScript behavior against fake IndexedDB and a fake transport                     |
| D1 schema, repository, Worker HTTP            | `just test-d1`                                                                                                                             | Real Workers runtime and local D1, including auth, CORS, limits, ownership               |
| Worker health or bridge only                  | `just test-worker`                                                                                                                         | One health case. It does not prove sync auth or D1                                       |
| Static page status                            | `just test-browser`                                                                                                                        | Built page with a fake API. It does not prove real convergence                           |
| Real Worker, D1, and two browsers             | `just test-sync`                                                                                                                           | Phase 4 dev-bearer convergence and faults                                                |
| Real session proof                            | `just test-session-proof`                                                                                                                  | Phase 5 session replicas, ownership, CSRF/Origin, replay, expiry, evidence, and teardown |
| Nix checks                                    | `nix flake check path:. -L`                                                                                                                | Nix checks and packaged artifacts. It does not run the real sync harness                 |

Run commands inside `nix develop`. Install dependencies once with
`pnpm install --frozen-lockfile`. Before a source web build, run
`just setup-web` to install the repository-pinned Warren if it is absent. The sync harness needs `PLAYWRIGHT_CORE` from
`nix develop`.

## Source and packaged modes

Both real-session recipes have two modes:

- Source: leave both `TANIKUN_WEB_DIST` and `TANIKUN_API_DIST` unset. The recipe
  builds `apps/web/dist` and the MoonBit API first.
- Packaged: set both to the roots of the Nix outputs.

```sh
nix develop
nix build path:.#web --out-link result-web
nix build path:.#api --out-link result-api
TANIKUN_WEB_DIST="$PWD/result-web" \
  TANIKUN_API_DIST="$PWD/result-api" just test-session-proof
```

Setting only one variable is an error. Never set `TANIKUN_API_DIST="$PWD"` or
point it at the checkout root. The harness treats an API root equal to the
checkout as source mode, so that mistake hides the packaged check. A packaged
API config omits `build`, `watch_dir`, and `$schema`. The harness copies the
package to a writable temporary directory and uses that copy. The source config
keeps its build and watch hooks. Do not make the packaged path fall back to the
source tree.

## Launch and readiness

`SyncHarness.start()`:

1. Creates a run directory under `.cache/verify/sync/`.
2. Creates isolated home, config, cache, and persistence directories.
3. Reads the API config and artifact paths.
4. Applies the D1 migrations before the first Worker request.
5. Starts the static web server. Dev bearer uses `http://127.0.0.1:4300`;
   session mode uses `https://localhost:4300` with a disposable loopback
   certificate.
6. Starts Wrangler with `--port 0` and reads the actual origin from the
   `Ready on` line.
7. Waits for `GET /api/health`.

The API origin is never fixed at 8787. The web origin is fixed at 4300 because
ADR-0014 and ADR-0015 allow exactly those origins. If 4300 is occupied, the harness fails with
a clear message and does not touch the listener. Stop and coordinate. Do not
kill the process, reuse the listener, or change the CORS port.

The harness injects `globalThis["__TANIKUN_SYNC_CONFIG__"]` with
`page.addInitScript` before `page.goto`. Keep the API origin, token, and
optional retry limit in that config. Do not read them from a URL or a committed
file.

## Doctor

Use the harness's read-only `health()` for readiness. Do not call `bootstrap()`
as a doctor probe because bootstrap provisions a user and document. For an
ownership check, query `SELECT id, owner_id FROM documents` through
`harness.d1Query` or pull a known document with the expected identity. There is
no standalone sync doctor command.

A read-only one-off check can import the existing harness:

```sh
nix develop -c node --input-type=module -e '
const { SyncHarness } = await import("./tests/integration/sync-harness.mjs");
const harness = new SyncHarness({ serveWeb: false });
try {
  await harness.start();
  const health = await harness.health();
  console.log(health.status, health.text);
  const documents = await harness.d1Query("SELECT id, owner_id FROM documents");
  console.log(JSON.stringify(documents));
} finally {
  await harness.close();
}
'
```

This is a recipe over the existing API, not a new driver. In source mode, run
`just build` first so the Worker bridge can import the built MoonBit module, or
set `TANIKUN_API_DIST` to a packaged API root. It still applies migrations and
starts Wrangler. The `d1Query` line is a read-only ownership check; the recipe
does not write a planner or bootstrap a document.

## Own and close resources

Every test owns its harness:

```js
const harness = new SyncHarness();
t.after(() => harness.close());
await harness.start();
```

Use `try/finally` when the run is not a test. `close()` waits for in-flight
work, closes contexts and the browser, terminates the owned Wrangler process
group, closes the web server, writes `cleanup.log`, and removes the temporary
directory. Never kill by process name. Never stop a listener you did not start.
If a run is interrupted, close only the harness from that run.

## Fault cases

`runJourneyGroup` keeps evidence per page. On failure it writes a failure
log, attempts a screenshot when a page exists, and sanitizes a trace if
recording started. A journey declares each expected fault with:

- `kind`: `pageerror` or `console`.
- Exact text or a regular expression.
- Positive count.
- Reason.

`acceptBrowserFaults` accepts only declared faults. An unaccounted page error or
console error fails the run. Do not broaden a pattern to absorb an unexpected
error.

The lost-push case in `sync-browser-faults.test.mjs` captures the actual Worker
response with `route.fetch()` and aborts the first delivery. On the retry, it
captures the new actual response with `route.fetch()` and fulfills the browser
request with that response unchanged. Keep that shape. Reconstructing the body
or using a cached response can produce the recurring Chromium CDP body error.
The test also keeps the retry POST identical and checks the D1 rows and the
local outbox.

The convergence case in `sync-convergence.test.mjs` starts browser B with API
requests gated offline, clears its seeded planner through the production
`discard`, and pulls from cursor 0. It does not copy IndexedDB bytes from A to
B. It compares normalized source, sorted heads, merged cursors, observed
high-water, outbox emptiness, and D1 sequence uniqueness. It then reloads both
browsers and exchanges again to prove idempotency. Keep those assertions.
`session-replica-proof.test.mjs` repeats the replica shape over real session
cookies, CSRF, and discoverable passkey sign-in. It must keep the server
history pull, duplicate append, and reload checks.

## Session proof

`just test-session-proof` is the bounded Phase 5 gate. It runs:

- `session-sync-packaged.test.mjs` and `webauthn-packaged.test.mjs` for Nix
  artifact wiring;
- `session-account-journey.test.mjs` and
  `session-credential-journey.test.mjs` for copy consent, account switch,
  multi-tab fencing, reauthentication, second passkeys, and revocation;
- `session-replica-proof.test.mjs` for two Alice replicas over session HTTP;
- `session-account-proof.test.mjs` for Bob's foreign read/write denial and the
  Alice-to-Bob outbox fence;
- `session-auth-faults.test.mjs` for replay, invalid challenge, wrong binding,
  cookie flags, CSRF/Origin rejection, logout revocation, and D1 expiry;
- `session-response-loss.test.mjs` for a lost session push response;
- `session-failure-evidence.test.mjs` for sanitized failure logs, screenshots,
  traces, and owned cleanup.

The new tests use `session-proof-helpers.mjs` to inspect Chromium's cookie jar,
send an exact hostile Origin from the context request API, count D1 writes, and
assert sanitized evidence and owned teardown. Do not replace the page fetch or
context cookie jar with a manual Cookie header. Page fetch cannot set Origin, so
the Origin-negative case deliberately uses the context request API with the
browser's cookie store.

## Evidence

Each run writes to `.cache/verify/sync/<run>/`:

- `harness.log`
- `migration.log`
- `wrangler.log` (redacted)
- `cleanup.log`
- on journey failure, `<journey>-failure.log`
- `<journey>-failure.png` when a page exists and screenshot capture succeeds
- sanitized `<journey>-trace.zip` or `<journey>-failure-trace.zip` when tracing
  started and sanitization succeeds

Context-creation failure leaves only the failure log. A failed trace rebuild is
reported in the failure log; it never causes the raw trace to be retained.

The raw Playwright trace stays in the temporary directory and is deleted after
sanitization. The retained trace keeps the action timeline and sanitized network
method, status, and timing metadata. It omits headers, cookies, bodies, document
identifiers, init-script arguments, console text, DOM snapshots, screencast
frames, and the `trace.stacks` source-stack entry. Action errors contain only a fixed marker. Error
messages, assertion diffs, and error stacks are omitted. Journey failure logs
retain that marker and error counts, without raw browser error text.

Do not attach a raw trace, a full Wrangler debug log, a token, a document ID, or
a payload to a public report. Use the redacted evidence under
`.cache/verify/sync/`. Cleanup removes the temporary directory and owned
processes, not the evidence. The new session tests call
`assertEvidenceSanitized` and `assertHarnessCleaned` after `close()`. Keep those
checks when adding a journey.

## Handoff

Report the commands you ran, their results, and whether the run was source or
packaged. Say which layers were not run. Do not claim that a health case proves
sync auth, that the fake API status suite proves convergence, or that Chromium
proves screen-reader behavior.

CI uploads only retained `*.log` files and sanitized `*trace.zip` archives on
failure. Screenshots remain local: their pixels can include planner contents,
so they are excluded from the upload allowlist.
