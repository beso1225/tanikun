---
name: tanikun-sync-change
description: "Change Tanikun's Phase 4 HTTP sync across the shared contract, Worker HTTP, D1, local development auth, and browser coordinator. Use for sync, Worker, D1, or convergence work; use tanikun-planner-change for planner UI and tanikun-moonbit-change for pure packages."
---

# Tanikun sync change

Phase 4 sync is local development only. Read
[ADR-0013](../../../docs/adr/0013-http-sync-protocol.md),
[ADR-0014](../../../docs/adr/0014-local-development-auth.md),
[D1 sync storage](../../../docs/SYNC_STORAGE.md), and
[Phase 4 results](../../../docs/PHASE_4_RESULTS.md) before changing a route,
envelope, storage rule, or client commit order. Those documents own the
contract. This skill does not authorize a production deployment, real
credentials, end-to-end encryption claims, or GitHub writes.

Use this skill for the shared contract, Worker HTTP, D1, local development
auth, browser transport, outbox, metadata, coordinator, sync status, and the
real sync harness. Route a planner model or view change to
`tanikun-planner-change` and a pure package change to `tanikun-moonbit-change`.
The static [verify](../verify/SKILL.md) driver proves the planner page and local
persistence, not sync.

## Find the owner

| Layer               | Owner                                                                                          | Focused proof                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Wire contract       | `packages/sync-contract/contract.mjs`, `docs/contracts/sync-v1.json`                           | `apps/api/test/sync-contract.test.mts`                                                  |
| Worker HTTP         | `apps/api/http/sync.mjs`, `auth.mjs`, `json.mjs`, `respond.mjs`, `apps/api/bridges/worker.mjs` | `apps/api/test/worker-sync.test.mts`                                                    |
| D1 storage          | `apps/api/migrations/0001_sync.sql`, `apps/api/repositories/changes.mjs`                       | `apps/api/test/sync-repository.test.mts`                                                |
| Browser transport   | `apps/web/public/sync-transport.js`                                                            | `tests/integration/sync-transport.test.mjs`                                             |
| Outbox and seen     | `apps/web/public/sync-store.js`                                                                | `tests/integration/sync-coordinator.test.mjs`                                           |
| Metadata and commit | `apps/web/public/sync-metadata.js`, `sync-coordinator.js`                                      | `tests/integration/sync-coordinator.test.mjs`, `tests/integration/persistence.test.mjs` |
| Status shell        | `apps/web/public/sync-shell.js`                                                                | `tests/integration/browser-sync-status.test.mjs`                                        |
| Real convergence    | `tests/integration/sync-harness.mjs` and the sync fault suites                                 | `just test-sync`                                                                        |

## Keep these invariants

- Append runs its integrity guard, per-change conflict guard, counter update,
  insert, per-change `SELECT`, and final cursor `SELECT` in one `DB.batch()`.
  A failed batch consumes no sequence. See `append` in
  `apps/api/repositories/changes.mjs`.
- Scope every document read and write by owner and document. A missing
  document and a foreign document both return `404 not_found`. See `owned` and
  the owner predicates in `apps/api/repositories/changes.mjs`.
- `SYNC_LIMITS` is the only owner of 20 append changes, 100 pull changes,
  256 KiB payloads, 4 MiB requests, and 8 MiB responses. Import it. Do not add
  numeric copies in the Worker, browser, or tests.
- Pull reads the cursor, integrity state, and rows in one view. `cursor` is the
  log high-water, not an acknowledgement that a client merged a page.
- The client persists `observedHighWater` before page processing. It then
  commits the validated planner and merged cursor together with compare-and-set
  checks after verifying change hashes, dependencies, independent roots, and
  planner validity. See `sync-metadata.js` `applyPage` and
  `sync-coordinator.js` `pullPages`.
- Outbox and seen keys are scoped by `origin:document`. Pull before push.
  Retries send the exact saved envelope and change ID, so duplicate delivery
  stays idempotent.
- Web Locks serialize sync per API origin and document. Without Web Locks, one
  leader is required. Compare-and-set rejects cursor rollback, but it does not
  make concurrent leaders safe.
- Discard removes the planner first, drains pending enqueues, then clears sync
  state and metadata under the same lock.
- Local development auth resolves an identity only when `DEV_AUTH` is exactly
  `true`, `APP_ENV` is exactly `local`, the URL is HTTP on `127.0.0.1` or
  `localhost`, the Origin is exactly `http://127.0.0.1:4300`, and the identity
  mapping is valid and nonempty. The browser uses `credentials: "omit"`. There
  is no anonymous fallback.
- `none` payloads are plaintext Automerge changes. Do not describe the
  transport as end-to-end encrypted, production authenticated, or ready to
  deploy.

## Change and prove

Change the owning layer first. Keep the shared contract as one source and do
not copy validation or limits into a second module. For a protocol change,
update the golden fixture only with a contract decision, not to match an
implementation drift.

Add or extend the focused test in the same layer. For a fault test, declare the
exact expected fault kind, text or pattern, count, and reason. Let an
unexpected page error or console error fail the run. Reuse `SyncHarness` and
`just test-sync`. Do not add a second browser framework, a new endpoint, a
standalone doctor command, or a mock that replaces the real Worker and D1 path.

Choose the lowest layer that can fail, then broaden when the change crosses a
boundary. A docs-only change needs `just lint`, not `just test-sync`.

## Verification ladder

Run commands inside `nix develop`. Install dependencies once with
`pnpm install --frozen-lockfile`.

| Change                                        | Command                                                                                                                                    | What it proves                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Contract, transport, coordinator, persistence | `node --test tests/integration/sync-transport.test.mjs tests/integration/sync-coordinator.test.mjs tests/integration/persistence.test.mjs` | Pure JavaScript behavior against fake IndexedDB and a fake transport                  |
| D1, repository, Worker HTTP                   | `just test-d1`                                                                                                                             | Real Workers runtime and local D1, including auth, CORS, limits, ownership            |
| Worker health or bridge only                  | `just test-worker`                                                                                                                         | One health case. It does not prove sync auth or D1                                    |
| Static page status                            | `just test-browser`                                                                                                                        | Built page with a fake API. It does not prove real convergence                        |
| Real Worker, D1, and two browsers             | `just test-sync`                                                                                                                           | The full harness (44 cases at the Phase 4 baseline), including convergence and faults |
| Nix checks                                    | `nix flake check path:. -L`                                                                                                                | Nix checks and packaged artifacts. It does not run the real sync harness              |

`just test-sync` has two modes. Leave both `TANIKUN_WEB_DIST` and
`TANIKUN_API_DIST` unset to build from source. Set both to the roots of the Nix
outputs to test packaged artifacts:

```sh
nix build path:.#web --out-link result-web
nix build path:.#api --out-link result-api
TANIKUN_WEB_DIST="$PWD/result-web" \
  TANIKUN_API_DIST="$PWD/result-api" just test-sync
```

Setting only one variable is an error. Never point `TANIKUN_API_DIST` at the
checkout root. The packaged config omits `build`, `watch_dir`, and `$schema`,
and the harness copies the package to a writable temporary directory. The
source config keeps its build and watch hooks. Do not add a source fallback.

## Run the real harness

`SyncHarness.start()` applies the migrations before the first Worker request,
starts the web server on `http://127.0.0.1:4300`, starts Wrangler on an
ephemeral port, reads the actual API origin from the readiness line, and waits
for `GET /api/health`. The API origin is never fixed at 8787. The web origin is
fixed because ADR-0014 allows exactly that Origin.

If 4300 is occupied, the harness fails with a clear message and leaves the
listener alone. Stop and coordinate. Do not kill a process by name, reuse the
listener, or change the CORS port.

Every test owns its harness with `t.after(() => harness.close())`; other runs
use `try/finally`. `close()` closes contexts and the browser, terminates the
owned Wrangler process group, closes the web server, writes `cleanup.log`, and
removes the temporary directory. Evidence survives.

Each run writes under `.cache/verify/sync/<run>/`: `harness.log`,
`migration.log`, redacted `wrangler.log`, `cleanup.log`, and on failure a
screenshot, failure log, and sanitized trace. The raw trace stays in the
temporary directory and is deleted. Do not attach a raw trace, a full Wrangler
debug log, a token, a document ID, or a payload to a public report.

## Read next

- [Server boundary](references/server-boundary.md) for the contract, Worker,
  D1, auth, and cursor rules.
- [Browser client](references/browser-client.md) for transport, outbox,
  metadata, coordinator, locks, and discard.
- [Verification](references/verification.md) for the runnable ladder, harness
  lifecycle, fault recipes, and evidence rules.

For the current evidence and known limits, read
[Phase 4 results](../../../docs/PHASE_4_RESULTS.md). For the historical local
persistence boundary, read
[ADR-0012](../../../docs/adr/0012-automerge-planner-document.md).
