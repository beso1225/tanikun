# Phase 4 results

Phase 4 adds HTTP delta sync between browser replicas through a Cloudflare
Worker and D1. It keeps the Phase 3 local source document as the planner source
and stores sync-only state beside it. This page records the implementation and
evidence at the `94a513f` baseline. The administrative milestone closeout is
separate and is described under [Baseline and closeout gate](#baseline-and-closeout-gate).

The implementation is for local development only. It does not provide
production authentication, end-to-end encryption (E2EE), automatic peer
discovery, snapshot compaction, or a production deployment.
[Phase 3 results](PHASE_3_RESULTS.md) remain the record of local persistence and
local replica convergence, with the Phase 3 local-only boundary unchanged.

## Done criterion

The [initial design](INITIAL_DESIGN.md#phase-4--workers--http差分同期) defines
Phase 4 Done as two browsers exchanging changes and converging, with duplicate
delivery and network interruption covered by tests. The harness below runs two
isolated Chromium contexts against the built page, the actual Worker bridge, and
a real local D1 database. It does not copy IndexedDB bytes between contexts.
Duplicate delivery, lost responses, interrupted local commits, D1 gaps, missing
dependencies, server failures, and foreign-document access run in the same
harness.

## Baseline and closeout gate

The implementation and evidence baseline is commit
[`94a513f`](https://github.com/beso1225/tanikun/commit/94a513f96db847594f16e9eda5d94bf8b008be31).
[CI run 42384580222](https://github.com/beso1225/tanikun/actions/runs/42384580222)
completed successfully on 2026-11-07 (UTC). Both the `lint` and `linux` jobs
passed. The run includes the packaged web and Worker checks, the 34-test
Chromium command, the 44-test sync harness, the D1 and API tests, the allocation
journey, and the mapped journeys.

The baseline left [#146](https://github.com/beso1225/tanikun/issues/146) as the
one open issue in [milestone #5](https://github.com/beso1225/tanikun/milestone/5).
Issues #138 through #145 were closed. This page does not assert that the
milestone is closed. Merging the documentation change closes #146. The remaining closeout gate is
to confirm a successful `main` CI run on that merge commit and then close the
milestone with zero open issues. The implementation baseline alone does not close the milestone.

## API and envelope contract

[ADR-0013](adr/0013-http-sync-protocol.md) owns the wire contract. The checked-in
[sync v1 fixture](contracts/sync-v1.json) is the shared contract artifact. All
sync routes use `/api/v1`, UTF-8 JSON, and `Cache-Control: no-store`.

| Operation | Route                                                  | Success body                                                       |
| --------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| Bootstrap | `GET /api/v1/sync/document`                            | The caller's `document_id` and current `cursor`                    |
| Append    | `POST /api/v1/sync/documents/:id/changes`              | `accepted` change IDs with `server_sequence`, and the log `cursor` |
| Pull      | `GET /api/v1/sync/documents/:id/changes?after=&limit=` | Ordered change envelopes, `next_cursor`, `has_more`, and `cursor`  |

The append envelope has `document_id`, `change_id`, `envelope_version`,
`payload_encoding`, `crypto_algorithm`, `key_version`, `nonce`, `aad`, and
`payload`. Version 1 fixes the envelope version and `base64` payload encoding.
A pull response adds `server_sequence`. The client uses the change hash as
`change_id`; the server validates its syntax but does not decode the payload to
prove that it matches the hash. The client checks the hash, dependencies,
merge result, and planner validation before it advances the pull cursor.

The limits are 4 MiB for a request, 256 KiB for one decoded payload, 20 changes
per append, 8 MiB for a pull response, and 100 changes per pull page. Errors use
stable codes and do not echo requests. [ADR-0013](adr/0013-http-sync-protocol.md)
owns the full error and retry matrix.

## D1 storage and commit semantics

The migration is
[`0001_sync.sql`](../apps/api/migrations/0001_sync.sql). It creates `users`,
`documents`, and `changes`. One owner can have one document, sequence values are
unique and contiguous per document, and a canonical envelope BLOB preserves the
exact bytes used for duplicate comparison. Every repository read and write is
scoped by owner and document. A missing document and a foreign document both
return `404 not_found`.

Bootstrap inserts the user and document with conflict handling and returns the
winning document, so concurrent bootstrap calls converge on one document.
Append runs its gap check, conflict guards, counter updates, inserts,
acknowledgements, and final cursor read in one `DB.batch()` transaction. An
identical envelope returns its existing sequence. A different envelope with the
same change ID returns `409 change_conflict` and rolls back the complete batch,
including earlier new entries. A failed batch consumes no sequence. A log gap
returns `409 log_gap`; a cursor ahead of the log returns `409 cursor_ahead`.

Pull reads its high-water mark, integrity state, and rows in one view. It
returns ascending sequences after `after`, defaults to `after=0` and `limit=100`,
and computes `next_cursor` and `has_more` from that view. The cursor is the log
high-water, not an acknowledgement that a client merged a page. Phase 4 does not
delete or compact log rows.

## Local-development authentication

[ADR-0014](adr/0014-local-development-auth.md) owns the temporary identity
boundary. Sync resolves identities only when all these conditions hold:

- `DEV_AUTH` is exactly `true`.
- `APP_ENV` is exactly `local`.
- The request URL is HTTP on `127.0.0.1` or `localhost`.
- The request has the exact Origin `http://127.0.0.1:4300`.
- `DEV_AUTH_IDENTITIES` is a valid, nonempty mapping of tokens to user IDs.

A failed environment or URL gate returns `404 not_found` before Origin, route,
identity, or D1 handling. A missing, malformed, or unknown bearer returns `401
unauthorized`. The server sends `WWW-Authenticate: Bearer` and never falls back
to an anonymous owner. A known foreign document and an unknown document both
return the same `404 not_found`, so the response does not disclose ownership.

CORS allows only the exact local web origin, adds `Vary: Origin`, exposes
`Retry-After`, and does not send credentials or cookies. The browser transport
uses `credentials: omit` and an explicit bearer header.

This is not production authentication. It has no passkeys, sessions, credential
storage, cookie CSRF protection, rate limiting, memberships, sharing, or roles.
Anyone with a mapped token can act as that development user. Use
fictional planner data only. Production, preview, and default configurations
omit the gate settings, and every non-local sync request is rejected even when
it carries an AES-shaped envelope.

## Browser sync client

The transport is
[`sync-transport.js`](../apps/web/public/sync-transport.js). It returns explicit
result variants for bootstrap, push, pull, offline, timeout, abort,
unauthorized, not found, malformed response, conflict, rejected request, and
server error. It does not read or write IndexedDB or mutate Automerge state.

[`sync-store.js`](../apps/web/public/sync-store.js) uses a separate
`tanikun-sync` database with `outbox` and `seen` stores. The outbox stores
unsynced local changes. Seen hashes mark remote and acknowledged changes, so a
reload does not upload them again. The seen set grows with retained history, and
each sync scans that history, so per-sync CPU work is linear. A persisted scan
boundary is future work.

[`sync-metadata.js`](../apps/web/public/sync-metadata.js) keeps the merged
cursor and observed high-water as a sibling record in the `tanikun-planner`
database. Sync metadata is not added to the Automerge source document, and the
planner remains `storageVersion: 2`.

[`sync-coordinator.js`](../apps/web/public/sync-coordinator.js) pulls before it
pushes. A fresh client must obtain the server history before uploading local
history. The coordinator fetches pages, checks cursors, hashes, dependencies,
and independent roots, merges the page, validates the planner, and commits the
planner and merged cursor together. It records the observed high-water before
page processing, so a failed page commit remains detectable. The merged cursor
advances only after the local commit succeeds.

Push batches contain at most 20 changes. An oversized batch is split and retried.
Transport failures, timeouts, and retryable `503` responses use up to five
retries with jitter and honor `Retry-After`; other errors are not retried
automatically. Retry exhaustion keeps the outbox.

Web Locks serialize sync per API origin and document when the browser provides
them. Without Web Locks, a single leader is required. The planner and metadata
compare-and-set checks reject a stale planner or a cursor rollback, but they do
not make multiple unsynchronized leaders safe. This is the Phase 4 multi-tab
limitation.

## Two-browser convergence

[`sync-convergence.test.mjs`](../tests/integration/sync-convergence.test.mjs)
uses two isolated browser contexts with the same development identity and
document. Browser B starts with API requests gated offline and has a seeded local
planner. The test clears B through the production `discard` API, so B starts with
no planner and no sync metadata. B then pulls from cursor 0 through HTTP and
converges without receiving bytes from A.

Both browsers edit while offline: A adds an offering, B adds a custom course.
Each reloads and keeps its offline edit. After reconnect, both retry and sync.
The test reloads both again and performs a second exchange. It compares the
canonical planner source and sorted Automerge heads, checks D1 sequence
uniqueness and count, checks both merged cursors against the server high-water,
and requires empty outboxes. A distinctive planner canary and the bearer token
are absent from the retained Worker log and sanitized traces.

[`sync-browser-faults.test.mjs`](../tests/integration/sync-browser-faults.test.mjs)
adds the browser fault cases. The lost-response case captures the actual Worker
response with `route.fetch()` and loses only the first delivery. It forwards
the retry to the Worker, captures that retry's actual response, and fulfills the
browser request with it unchanged. The retry still posts identical
envelopes and compares the D1 rows; the duplicate-row assertions are unchanged.
[#170](https://github.com/beso1225/tanikun/pull/170) fixed the earlier Chromium
response-capture flake on that path.

## Fault matrix

| Fault                       | What the test exercises                                                                                                           | Evidence                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Duplicate upload            | Same canonical envelope reaches the real Worker and D1 twice; one row and one sequence remain.                                    | [`sync-api-faults.test.mjs`](../tests/integration/sync-api-faults.test.mjs)                                                                                              |
| Conflicting duplicate       | Same change ID with different bytes returns `409` and rolls back new entries and the counter.                                     | [`sync-api-faults.test.mjs`](../tests/integration/sync-api-faults.test.mjs)                                                                                              |
| Lost push response          | The server commits, the browser loses the response, and the retry sends the same envelopes.                                       | [`sync-browser-faults.test.mjs`](../tests/integration/sync-browser-faults.test.mjs), [`browser-sync-status.test.mjs`](../tests/integration/browser-sync-status.test.mjs) |
| Interrupted page commit     | An IndexedDB put aborts after the pull; the merged cursor stays, high-water advances, and reload reapplies the page.              | [`sync-browser-faults.test.mjs`](../tests/integration/sync-browser-faults.test.mjs)                                                                                      |
| D1 gap and counter rollback | A deleted row yields `log_gap`; resetting `last_seq` to 0 yields API `log_gap` and client `rollback`, then recovers after repair. | [`sync-api-faults.test.mjs`](../tests/integration/sync-api-faults.test.mjs), [`sync-browser-faults.test.mjs`](../tests/integration/sync-browser-faults.test.mjs)         |
| Missing dependency          | A mutated pull page is rejected before advance and then recovers.                                                                 | [`sync-browser-faults.test.mjs`](../tests/integration/sync-browser-faults.test.mjs)                                                                                      |
| Server failure and offline  | A real renamed-table `503` and an offline gate retry without duplicate rows.                                                      | [`sync-api-faults.test.mjs`](../tests/integration/sync-api-faults.test.mjs), [`sync-browser-faults.test.mjs`](../tests/integration/sync-browser-faults.test.mjs)         |
| Foreign access              | A second identity cannot read, write, or distinguish a foreign document from a missing one.                                       | [`sync-api-faults.test.mjs`](../tests/integration/sync-api-faults.test.mjs)                                                                                              |
| Plaintext leakage           | The planner canary and bearer token are absent from Worker logs and sanitized traces.                                             | [`sync-convergence.test.mjs`](../tests/integration/sync-convergence.test.mjs)                                                                                            |

## Browser and accessibility evidence

The baseline Chromium command passes 34 tests across six files. Six of those
tests are the sync status suite in
[`browser-sync-status.test.mjs`](../tests/integration/browser-sync-status.test.mjs).
They assert the live status region, retry visibility, offline and error
recovery, the 390px layout without horizontal scroll, and focus after a
keyboard-triggered retry.

Chromium DOM assertions and keyboard checks do not establish spoken
screen-reader behavior. No screen-reader session is part of Phase 4. Actual
screen-reader verification of the requirement summary remains open in
[#103](https://github.com/beso1225/tanikun/issues/103). The five mapped journey
screenshots cover the broader planner UI, but they are not a visual regression
baseline. Chromium is the only browser target; there is no Firefox or Safari
evidence.

## Test evidence

The baseline CI run executed these suites:

- `nix flake check path:. -L` for the Nix checks and the 150-test pure package
  check.
- The six-file Chromium command for 34 browser tests.
- `TANIKUN_WEB_DIST="$PWD/result-web" TANIKUN_API_DIST="$PWD/result-api" just
  test-sync` for 44 sync harness tests. CI uses the Nix-built web and API
  artifacts, so a missing bridge module or migration fails before startup.
- `just test-worker`, `just test-automerge`, and `just test-d1`.
- The allocation journey and the five mapped journeys.

To reproduce the browser, sync, D1, and Worker checks locally:

```sh
nix develop -c just test-browser
nix develop -c just test-sync
nix develop -c just test-d1
nix develop -c just test-worker
```

| Evidence                       |                                                                         Count | How it was counted                                                          |
| ------------------------------ | ----------------------------------------------------------------------------: | --------------------------------------------------------------------------- |
| MoonBit package tests          | 289 total: 1 API, 74 domain, 76 requirements, 117 web app, 21 browser command | `moon test --outline` over the five packages in `just test` at the baseline |
| Nix pure package check         |                                                                           150 | CI log at `94a513f`                                                         |
| Chromium shell and sync status |                                                                            34 | CI log at `94a513f`                                                         |
| Sync harness                   |                                                             44 across 8 files | CI log at `94a513f`                                                         |
| D1 and API Vitest              |                                                            150 across 5 files | CI log at `94a513f`                                                         |
| Worker HTTP                    |                                                                 1 health case | CI log at `94a513f`                                                         |
| Automerge                      |                                                    3 MoonBit and 3 Node tests | CI log at `94a513f`                                                         |
| Allocation journey             |                                                                             1 | CI log at `94a513f`                                                         |
| Mapped journeys                |                                                                 5 screenshots | CI log at `94a513f`                                                         |

The 289 MoonBit figure is a source inventory from `moon test --outline`, not a
local test pass. The CI table records the suites that ran at the baseline. This
documentation change does not claim a local rerun of the full test command.

The test owners are:

- Worker HTTP boundary:
  [`worker.mjs`](../apps/api/bridges/worker.mjs),
  [`sync.mjs`](../apps/api/http/sync.mjs), and
  [`worker-sync.test.mts`](../apps/api/test/worker-sync.test.mts)
- D1 schema and repository:
  [`0001_sync.sql`](../apps/api/migrations/0001_sync.sql),
  [`changes.mjs`](../apps/api/repositories/changes.mjs), and
  [`sync-repository.test.mts`](../apps/api/test/sync-repository.test.mts)
- Shared contract:
  [`contract.mjs`](../packages/sync-contract/contract.mjs),
  [`sync-contract.test.mts`](../apps/api/test/sync-contract.test.mts), and the
  [golden fixture](contracts/sync-v1.json)
- Browser transport:
  [`sync-transport.js`](../apps/web/public/sync-transport.js) and
  [`sync-transport.test.mjs`](../tests/integration/sync-transport.test.mjs)
- Browser coordinator:
  [`sync-coordinator.js`](../apps/web/public/sync-coordinator.js) and
  [`sync-coordinator.test.mjs`](../tests/integration/sync-coordinator.test.mjs)
- Browser harness:
  [`sync-harness.mjs`](../tests/integration/sync-harness.mjs),
  [`sync-journey.test.mjs`](../tests/integration/sync-journey.test.mjs), and the
  [sync storage boundary](SYNC_STORAGE.md)

## Security checklist

The following items are verified at the baseline:

- The local-only gate rejects disabled or malformed environments, URLs, Origins,
  and identity mappings before identity resolution.
- Bearer identity is exact, owner scoping covers every repository operation, and
  foreign and missing documents share the same `404` response.
- CORS uses one exact local origin, varies on Origin, exposes `Retry-After`, and
  omits credentials and cookies.
- The HTTP boundary bounds the streamed body, batch count, payload, page size,
  and response before writing or returning data.
- Duplicate delivery is idempotent, conflicting bytes fail closed, and a failed
  batch consumes no sequence.
- Error bodies omit request values, SQL, tokens, and payloads. Tests check that a
  planner canary and bearer token do not reach Worker logs or sanitized traces.

The following protections are not provided:

- Production authentication, sessions, passkeys, CSRF cookies, or rate limiting.
- E2EE, key management, device enrollment, key rotation, or cryptographic
  blindness.
- A remote D1 database, a production deployment, or a remote sync service.
- Sharing, memberships, roles, or automatic peer discovery.

### Metadata leakage

The server can see the owner and document linkage, change hashes, payload
lengths, algorithm and key versions, sequence order, request timing, and IP
address. Hashes can reveal repeated changes and support correlation. Logs are
redacted, but redaction does not provide confidentiality.

The local browser coordinator currently sends `crypto_algorithm: "none"`.
Those payloads are Automerge change bytes, not ciphertext. The local server and
D1 have access to those bytes even though the transport code does not decode
planner content.
The AES-256-GCM envelope shape is validated by contract tests, but Phase 4 has no
key management, encryption, or tag verification. That fixture is synthetic. Do
not use real planner data, and do not describe Phase 4 as E2EE or as
cryptographically blind.

The local IndexedDB stores the planner source as plaintext. Local storage
access, malicious delivered JavaScript, XSS, and a compromised device are outside
the protection of the transport envelope. Phase 6 owns encryption, key transfer,
and the metadata review needed for a stronger boundary.

## Limitations

- Authentication is local development only. The gate is not a production
  security boundary for a non-browser caller that knows a mapped token.
- Payloads are plaintext in `none` mode. E2EE is not implemented, and the
  checked-in AES case does not prove encryption.
- There is no automatic peer discovery. A client needs a configured API origin,
  token, and document bootstrap.
- There is no snapshot, compaction, garbage collection, R2 backup, or restore.
  The full change log remains, and the seen set grows with retained history.
- Cross-tab safety depends on Web Locks. Without Web Locks, only one leader is
  supported; compare-and-set prevents cursor rollback but does not merge
  concurrent leaders.
- Browser evidence is Chromium only. Spoken screen-reader evidence is still
  open in #103, and there is no visual regression baseline.
- There is no production D1, deployment, sharing, membership, or role model.
  This page records local implementation evidence, not a production service.
