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
| Browser transport   | `apps/web/public/sync-transport.js`, `sync-session.js`                                         | `tests/integration/sync-transport.test.mjs`                                             |
| Outbox and seen     | `apps/web/public/sync-store.js`                                                                | `tests/integration/sync-coordinator.test.mjs`                                           |
| Metadata and commit | `apps/web/public/sync-metadata.js`, `sync-coordinator.js`                                      | `tests/integration/sync-coordinator.test.mjs`, `tests/integration/persistence.test.mjs` |
| Status shell        | `apps/web/public/sync-shell.js`                                                                | `tests/integration/browser-sync-status.test.mjs`                                        |
| Real convergence    | `tests/integration/sync-harness.mjs` and the sync fault suites                                 | `just test-sync` (Phase 4) and `just test-session-proof` (Phase 5)                      |

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
  numeric copies in production Worker or browser code. Tests may pin literal
  contract values and boundary sizes to detect accidental protocol changes.
- Pull reads the cursor, integrity state, and rows in one view. `cursor` is the
  log high-water, not an acknowledgement that a client merged a page.
- The client persists `observedHighWater` before page processing. It then
  commits the validated planner and merged cursor together with compare-and-set
  checks after verifying change hashes, dependencies, independent roots, and
  planner validity. See `sync-metadata.js` `applyPage` and
  `sync-coordinator.js` `pullPages`.
- Outbox and seen keys are scoped by `origin:document`. Pull before push.
  Retries send the exact saved envelope and change ID, so duplicate delivery
  stays idempotent. Session mode scopes them by
  `<handle>|<apiOrigin>|<documentId>` and gives metadata and the sync Web Lock
  the matching handle. Dev bearer keeps the Phase 4 keys on its separate
  origin.
- Session saves compare `auth:state` generation and handle in the same IndexedDB
  transaction as the planner write. Sync checks them before bootstrap, after
  bootstrap before binding, before pull, and before apply or acknowledgement.
  An unrelated root stops with `history_mismatch` and keeps both plans, outbox,
  seen, and cursors.
- An unbound `planner` is never uploaded automatically. Copying it to
  `account:<handle>:planner` is explicit, keeps the original, and sets
  `auth:upload:<handle>` until a separate first-upload consent. Copy, decline,
  and consent carry the expected generation and handle into the same local
  transaction.
- Delayed status, expiry, sign-in, and logout transitions compare the expected
  generation and handle in the same auth-state transaction. A mismatch is
  `stale_account`, never an overwrite of a newer account.
- Registration and sign-in use an AbortController. Dialog close, logout, an
  account switch, or an auth broadcast aborts the native ceremony before the
  verify request. A late server-committed cookie is an explicit mismatch, not
  a local adoption.
- Outbox, seen, and clear mutations use the shared auth lock and recheck the
  expected scope while holding it. This serializes the separate sync database;
  it is not a cross-database transaction.
- A session `401` keeps the generation and becomes `reauth_required`; the
  account plan remains locally editable and sync pauses without an automatic
  retry. Account-dialog retry and sign-in actions share the session
  `Retry-After` cooldown.
- Opening the account dialog from settings closes the settings modal first, so
  the generic focus trap owns exactly one modal.
- Web Locks serialize sync per API origin and document. Without Web Locks, one
  leader is required. Compare-and-set rejects cursor rollback, but it does not
  make concurrent leaders safe.
- Discard removes the planner first, drains pending enqueues, then clears sync
  state and metadata under the same lock.
- `AUTH_MODE` is exactly `dev_bearer` or `session`; absent, unknown, or
  conflicting configuration is `404` before auth, Origin, session, or D1.
  Dev bearer resolves an identity only when `DEV_AUTH` is exactly `true`,
  `APP_ENV` is exactly `local`, the URL is HTTP on `127.0.0.1` or `localhost`,
  the Origin is exactly `http://127.0.0.1:4300`, the identity mapping is valid
  and nonempty, and no session-only configuration is present. The browser uses
  an explicit dev mode with `credentials: "omit"`. There is no anonymous
  fallback.
- Session mode is same-origin `https://localhost:4300`, requires
  `X-CSRF-Token` for appends, uses `POST` bootstrap, and resolves the owner only
  from the session. The 120/minute session window is charged after ownership
  and request validation. Foreign and missing documents remain
  indistinguishable `404`.
  Session mode rejects `Authorization`; a failed session never falls back to
  dev bearer or a cookie from another mode.
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
`pnpm install --frozen-lockfile`. Before a source web build, run
`just setup-web` to install the repository-pinned Warren if it is absent.

| Change                                        | Command                                                                                                                                    | What it proves                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Contract, transport, coordinator, persistence | `node --test tests/integration/sync-transport.test.mjs tests/integration/sync-coordinator.test.mjs tests/integration/persistence.test.mjs` | Pure JavaScript behavior against fake IndexedDB and a fake transport                             |
| D1, repository, Worker HTTP                   | `just test-d1`                                                                                                                             | Real Workers runtime and local D1, including auth, CORS, limits, ownership                       |
| Worker health or bridge only                  | `just test-worker`                                                                                                                         | One health case. It does not prove sync auth or D1                                               |
| Static page status                            | `just test-browser`                                                                                                                        | Built page with a fake API. It does not prove real convergence                                   |
| Real Worker, D1, and two browsers             | `just test-sync`                                                                                                                           | Phase 4 dev-bearer convergence and faults. Read the run output for current totals.               |
| Real session proof                            | `just test-session-proof`                                                                                                                  | Phase 5 session replicas, ownership, CSRF/Origin, replay, expiry, evidence, and teardown         |
| Session auth and account switch               | `node --test tests/integration/session-account-journey.test.mjs`                                                                           | Real Worker, D1, loopback TLS, virtual authenticator, copy consent, switch, expiry, and multitab |
| Nix checks                                    | `nix flake check path:. -L`                                                                                                                | Nix checks and packaged artifacts. It does not run the real sync harness                         |

`just test-sync` and `just test-session-proof` share the same artifact mode.
Leave both `TANIKUN_WEB_DIST` and `TANIKUN_API_DIST` unset to build from source.
Set both to the roots of the Nix outputs to test packaged artifacts. Setting
only one is an error. The session proof starts its own
`SyncHarness({ mode: "session" })`; it does not reuse a source or packaged API
fallback:

```sh
nix build path:.#web --out-link result-web
nix build path:.#api --out-link result-api
TANIKUN_WEB_DIST="$PWD/result-web" \
  TANIKUN_API_DIST="$PWD/result-api" just test-session-proof
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

`SyncHarness({ mode: "session" })` is the Phase 5 path. It serves
`https://localhost:4300` from a disposable loopback certificate generated in
the harness temp directory, proxies `/api` to the ephemeral Wrangler origin, and
sets the exact session configuration (`AUTH_ORIGIN=https://localhost:4300`,
`RP_ID=localhost`, `APP_ENV=test`, and a test-only rate-limit key). Do not add a
public HTTP exception, change the RP ID, or reuse the user's browser profile.
The harness uses Chromium `ignoreHTTPSErrors` only inside its disposable
context, never an OS trust-store change. A virtual authenticator supplies the
resident ES256 passkey. This is synthetic browser automation, not a physical
provider proof.

`just test-session-proof` is the bounded #185 proof. It covers two Alice
replicas over session HTTP, Bob's foreign read and write denial, account-switch
outbox isolation, cookie flags, CSRF and Origin rejection, replayed and invalid
challenges, logout revocation, D1 expiry, response loss, sanitized evidence, and
owned teardown. It is separate from the Phase 4 dev-bearer `just test-sync`
suite. See [PHASE_5_SESSION_PROOF.md](../../../docs/PHASE_5_SESSION_PROOF.md).

If 4300 is occupied, the harness fails with a clear message and leaves the
listener alone. Stop and coordinate. Do not kill a process by name, reuse the
listener, or change the CORS port.

Every test owns its harness with `t.after(() => harness.close())`; other runs
use `try/finally`. `close()` closes contexts and the browser, terminates the
owned Wrangler process group, closes the web server, writes `cleanup.log`, and
removes the temporary directory. Evidence survives.

Evidence under `.cache/verify/sync/<run>/` includes `harness.log`,
`migration.log`, redacted `wrangler.log`, and `cleanup.log` as startup and
cleanup progress. Journey failures write a failure log. A screenshot requires
a page; a sanitized trace requires tracing to have started and sanitization
to succeed. Context-creation failures therefore leave only the failure log.
The raw trace stays in the temporary directory and is deleted. Do not attach
a raw trace, a full Wrangler debug log, a token, a document ID, or a payload to
a public report.

## Read next

- [Server boundary](references/server-boundary.md) for the contract, Worker,
  D1, auth, and cursor rules.
- [Browser client](references/browser-client.md) for transport, outbox,
  metadata, coordinator, locks, and discard.
- [Verification](references/verification.md) for the runnable ladder, harness
  lifecycle, fault recipes, and evidence rules.

For the current evidence and known limits, read
[Phase 4 results](../../../docs/PHASE_4_RESULTS.md) and
[Phase 5 real-session proof](../../../docs/PHASE_5_SESSION_PROOF.md). For the
historical local persistence boundary, read
[ADR-0012](../../../docs/adr/0012-automerge-planner-document.md).
