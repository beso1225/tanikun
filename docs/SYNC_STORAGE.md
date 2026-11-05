# D1 sync storage

This is the server storage boundary for Phase 4. The wire contract is
[ADR-0013](adr/0013-http-sync-protocol.md); temporary identity and HTTP gating
belong to [ADR-0014](adr/0014-local-development-auth.md). The storage layer
adds no browser code or IndexedDB changes. The Worker HTTP boundary that calls
it is described below.

## Migrations and local configuration

`apps/api/migrations/` is the single migration directory. `0001_sync.sql`
creates `users`, `documents`, and `changes`. A unique owner constraint permits
one document per user. Change rows have unique document/sequence and
document/change-ID pairs. Foreign keys link changes to documents and documents
to users. Sequence counters and row sequences remain safe integers.

Payload and nonce columns hold opaque bytes. The additional `envelope` BLOB
holds ADR-0013's canonical envelope array for full metadata-and-byte equality
on retry. Encoding is fixed to `base64`, and AAD is reconstructed from the
versioned public metadata. No planner fields are schema columns. `created_at`
uses server epoch milliseconds.

Both Wrangler configurations bind `DB` to this schema. The all-zero database ID
is a local placeholder; no remote database is provisioned. Apply locally inside
`nix develop`:

```sh
just migrate-local
```

Wrangler records applied filenames in `d1_migrations`. Repeating the command
applies no further migrations. Migration application is separate from requests;
repository methods never run migrations. See
[Cloudflare's migration contract](https://developers.cloudflare.com/d1/reference/migrations/).

## Repository boundary

`apps/api/repositories/changes.mjs` exports
`createChangeRepository(DB, {newDocumentId, now})`. The optional
`newDocumentId` and `now` injections let tests choose deterministic document
IDs and timestamps. Callers supply an already resolved owner ID. The repository
enforces document ownership, but it does not resolve tokens or accept an
Origin. The Worker HTTP boundary applies ADR-0014's local gate before calling
it, including for AES and `none` envelopes.

| Method                                        | Result                                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap(ownerId)`                          | Atomically creates the user/document when absent and returns `{document_id, cursor}`. Concurrent callers read the winning document. |
| `findOwnedDocument(ownerId, documentId)`      | Returns `{id, last_seq}` or fails with `not_found` for missing or foreign documents.                                                |
| `append(ownerId, documentId, changes)`        | Returns the wire `accepted` entries and cursor for one atomic batch, including identical repeats.                                   |
| `lookupChange(ownerId, documentId, changeId)` | Returns a stored envelope with `server_sequence`, or null for an absent change within an owned document.                            |
| `pull(ownerId, documentId, {after, limit})`   | Returns a sequence-ordered wire page. Defaults are `after: 0` and `limit: 100`.                                                     |

Every read and write includes the owner/document constraint. Append checks
ownership before envelope validation and again within its batch. A gap guard,
per-change conflict guard, counter updates, inserts, acknowledgement reads, and
the final cursor read all share one `DB.batch()` transaction. An identical
canonical envelope returns its sequence. A differing envelope fails the whole
transaction. A later statement failure rolls back earlier rows and counters.

Pull reads its cursor, integrity state, and rows in one batch. SQL first limits
candidates to `limit + 1` before calculating their sizes and retrieving BLOBs;
the repository then counts each encoded envelope once to select the exact JSON
byte-capped prefix. These binding operations use D1's primary, without opting
into read replicas. The separate full-log integrity check still scans the
document log; the candidate bound does not make that check constant-cost. No
application read-modify-write counter allocation or cross-await transaction is
used.

`packages/sync-contract/contract.mjs` owns envelope validation, byte limits,
canonical encoding, and stored-envelope conversion. It has no platform or
planner dependencies. Server tests consume the same
[golden fixture](contracts/sync-v1.json) selected for future browser tests.
HTTP parsing, duplicate JSON keys, streamed request limits, Origin, and bearer
headers are owned by the Worker HTTP boundary described below.

Failures expose only `SyncError.code` and, for gap/rollback errors, `cursor`.
The repository does not log payloads, metadata, identities, SQL errors, or their
causes. NOT NULL failures on the integrity counter and envelope distinguish
`log_gap` and `change_conflict`. The named safe-range CHECK distinguishes
`sequence_exhausted`; unclassified database failures become
`temporarily_unavailable`. No automatic server retry changes the submitted
batch; callers follow ADR-0013's exact-envelope retry policy.

## Worker HTTP boundary

`apps/api/bridges/worker.mjs` keeps the existing `/api/health` behavior and
dispatches `/api/v1` sync requests to `apps/api/http/`. The boundary implements
ADR-0014's environment, URL, Origin, and bearer checks before it calls the
repository. Sync routes stay disabled unless `DEV_AUTH` is `true`, `APP_ENV` is
`local`, the request URL is HTTP on `127.0.0.1` or `localhost`, and the
identity mapping is valid and nonempty. `just dev-api` supplies the fixture
identities for local development; the test Wrangler configuration supplies
them to `SELF`.

The fixture harness may set `TEST_NEW_DOCUMENT_ID` only to make the
`bootstrap-new` fixture case deterministic; default, preview, and production
configurations must omit it.

`apps/api/http/json.mjs` bounds the streamed body before parsing and rejects
duplicate object keys at every depth. The HTTP layer also enforces the ADR
media type, batch, payload, query, method, and owned-resource rules. It maps
expected failures to stable status codes and redacted JSON bodies.
`apps/api/http/respond.mjs` adds `Vary: Origin` to every sync response and the
exact allow origin only for `http://127.0.0.1:4300`; allowed origins also expose
`Retry-After` for the browser transport. Gate failures keep their 404 status.
Error bodies and diagnostics never include SQL, exception messages,
tokens, or payload bytes; operation bodies carry only the contract-defined
envelope fields.

## Client sync coordinator

`apps/web/public/sync-coordinator.js` owns the browser-side order:

- `sync-store.js` uses a separate `tanikun-sync` database with `outbox` and
  `seen` stores. Outbox entries are `none` envelopes of local Automerge
  changes. Seen hashes mark remote changes and acknowledged local changes so a
  reload does not re-upload either kind. Entries are scoped by
  `origin:document`, so a document rebind cannot push another document's
  envelopes. The seen set is deduplicated by change ID and grows with retained
  history; the outbox itself holds only unsynced local changes. Each sync scans
  retained local history to build the seen and outbox sets, so per-sync CPU work
  is linear in retained history; a persisted scan-boundary optimization is
  future work. The outbox and push batches stay bounded.
- `sync-metadata.js` keeps ADR-0013's `sync:<origin>:<document>` record in
  `tanikun-planner`/`documents`. It records the observed server high-water
  before a pull, then writes the merged planner and merged cursor in one
  transaction. The write compares the planner bytes with the snapshot the
  coordinator validated and fails with `stale_planner` if another tab changed
  or replaced the planner. The planner record stays `storageVersion: 2`.
- `persistence.js` exposes `validateText`, `onLocalChange`, `snapshot`, and
  `discard`. A successful local save passes its new Automerge change to the
  listener; remote merges do not enter the outbox. `snapshot` provides the
  planner CAS input; `discard` removes the planner for an explicit reset.
- The coordinator pulls before it pushes, so a fresh client adopts the server
  history before uploading local history. It rejects independent Automerge
  roots with `history_mismatch`, checks dependencies, marks remote hashes, and
  commits the page atomically. It then pushes local changes in batches of at
  most 20; an oversized batch is split recursively before it is treated as a
  terminal error.
- Retryable transport results use bounded jitter and `Retry-After`. The
  coordinator exposes a narrow status callback and uses Web Locks when
  available. Without Web Locks, a single leader is required; metadata
  transactions still reject cursor rollback.
- `discard()` clears the planner, outbox, seen hashes, and sync metadata for
  the current scope under the same per-document lock. The shell integration
  and visible status are #143; this module has no UI.

`tests/integration/sync-coordinator.test.mjs` runs the production modules
against `fake-indexeddb` and a fake transport. It covers local-save enqueueing,
batch push and prune, duplicate delivery after prune failure, dependency-valid
pull, fresh-client history adoption, independent-root rejection, missing
dependencies, cursor rollback, page-commit failure and retry, stale-planner
CAS, oversized-batch splitting, server gaps, discard, Web Lock use, retry and
`Retry-After`, bootstrap, and status callbacks.

## End-to-end sync harness

`nix develop -c just test-sync` builds the static page and API, applies the D1
migrations to an isolated temporary persistence directory, starts the real
Worker bridge with Wrangler on an ephemeral port, serves the built page on
`http://127.0.0.1:4300`, and runs the harness self-tests and browser journey. The
API URL from Wrangler readiness and the selected Alice or Bob dev identity are
injected before page modules load through
`globalThis["__TANIKUN_SYNC_CONFIG__"]`.

The page origin is fixed at `http://127.0.0.1:4300` because ADR-0014 allows
exactly that Origin. The harness fails with a clear message when the port is
occupied and never reuses or stops the existing listener. The API port is never
hardcoded.

Set both `TANIKUN_WEB_DIST` and `TANIKUN_API_DIST` to run the same harness
against prebuilt artifacts. The values are roots of the Nix `web` and `api`
outputs. `TANIKUN_API_DIST` must contain `wrangler.jsonc`, the Worker bridge and
HTTP modules, all migrations, the shared sync contract, and the built MoonBit
module. When both variables are set, the command does not rebuild from source.
Setting only one is an error.

The packaged `api` output contains a runtime `wrangler.jsonc` derived from the
source configuration without `build`, `watch_dir`, or the source schema path.
The harness copies the packaged API into the run's writable temporary directory
and consumes that copy of `wrangler.jsonc` directly: it does not synthesize a
replacement config or fall back to the repository root. The copy is required
because Wrangler creates `.wrangler/tmp` beside the config, and a Nix store
output is read-only. A package that still
contains source build hooks is rejected before startup. The source
`wrangler.jsonc` keeps its Moon build and watch settings for local development.
The release test checks the packaged config and a writable copy of the artifact
passes `wrangler deploy --dry-run`; CI also starts the real Worker and D1 from
the same packaged config.

`just test-sync` runs three fault-focused suites after the harness self-tests
and the single-document journey.

- `sync-api-faults.test.mjs` starts the harness with `serveWeb: false` and
  exercises the real Worker and D1 without the fixed browser origin. It covers
  identical duplicate append, same-hash/different-bytes rejection with batch
  rollback, a response lost after the server commits, an actual 503 caused by
  renaming the isolated `changes` table, a real log gap and counter rollback,
  and foreign versus missing document reads and writes for Bob. This suite
  does not bind the browser origin, so it can run while another local server
  owns `127.0.0.1:4300`.
- `sync-convergence.test.mjs` uses two isolated browser contexts with the same
  Alice identity and document. Browser B starts with API requests gated
  offline, clears its seeded planner through the production `discard` API, and
  pulls from cursor 0 without receiving bytes from browser A. Both browsers
  then edit with API requests gated offline, reload, reconnect, exchange
  changes, reload again, and run a second exchange. The test compares
  normalized source and sorted Automerge heads, checks D1 sequence uniqueness,
  cursor equality, and an empty outbox, and asserts a distinctive planner
  string never appears in the retained Wrangler log or sanitized traces.
- `sync-browser-faults.test.mjs` uses the same two-context shape for a lost
  push response after `route.fetch()` reaches the real commit, a planner
  transaction abort at the IndexedDB `put` boundary followed by a duplicate
  page reload, an actual D1 gap and counter rollback, a mutated pull page with
  a missing dependency, and an actual 503 plus offline recovery. Each step
  asserts D1 rows, sequences, cursors, and local metadata rather than only an
  HTTP status.

The harness supports these suites with `runJourneyGroup`, which gives each
isolated context its own trace, screenshot, and failure log, and with
`d1`/`d1Query`, which run Wrangler against the same isolated persistence
directory. A browser journey declares each expected injected fault with its
kind, exact text or pattern, count, and reason. The harness accepts only those
records and still fails on an unaccounted page error or console error. The
retained log includes the raw error array and the accepted fault reasons. D1
mutation is limited to fault setup; normal reads and writes still go through
the production Worker bridge and request path.

Each run writes Wrangler, migration, and harness evidence under
`.cache/verify/sync/<run>/`. Wrangler output is redacted and its stdout/stderr
drain before the log stream closes, including a delayed final line. A browser
journey retains a redacted trace archive; a failed journey also writes a
screenshot and failure log. The raw Playwright
trace stays in the temporary directory and is deleted. The retained archive is
rebuilt from an allowlist: it keeps the action timeline and sanitized network
method/status/timing metadata, but no request or response headers, cookies,
bodies, document identifiers, init-script arguments, console text, DOM
snapshots, screencast frames, or source stacks. This tradeoff intentionally
drops Playwright's DOM time travel and visual network detail; the failure log
and screenshot remain the human-readable evidence. The rebuild is bounded by
entry size and event count. If trace sanitization fails or exceeds a bound, the
raw trace is not retained and the failure log records the error. Page
creation, initialization, and navigation failures follow the same failure-log,
screenshot (when a page exists), and trace path. The temporary persistence
directory and owned process group are removed after success or failure;
evidence is kept. Linux CI runs the same command against Nix-built artifacts
and uploads this directory when the job fails.

## Local evidence

`just test-d1` builds the API and runs the repository, shared-contract, and
Worker HTTP suites inside the Workers runtime with a real local D1 binding.
Each test resets storage and applies the production migration with Cloudflare's
migration helper. The storage suites cover fresh/repeat migration, recorded
schema version, concurrent bootstrap, concurrent append, exact mixed
acknowledgements, duplicate/conflict handling, an injected mid-batch SQL
failure, retry without consumed sequence, owner isolation and a changed-owner
race, gap rejection including duplicate-only append, multiple cursor pages,
cursor rollback, AES byte/metadata round trips, and the 8 MiB response cap with
lossless continuation. A trigger moves the counter to its upper boundary inside
a test transaction to exercise the real CHECK and its rollback without
manufacturing quadrillions of log rows.

The Worker HTTP suites use `SELF` with the production bridge and local D1. They
cover bootstrap, append, duplicate retry, conflict rollback, cursor pagination,
foreign and missing documents, malformed bodies and duplicate JSON keys,
request and payload limits, media types, method and route errors, the
exact-Origin CORS contract, the local gate variants, and redacted error bodies.
The golden fixture's malformed envelopes and encoded-size boundaries also run
through the shared validator. CLI verification applies `0001_sync.sql` to an
empty local database, repeats it as a no-op, and reads the recorded filename.
This establishes local D1 and local Worker behavior, not production deployment,
production identity, cryptographic protection, or browser synchronization.
