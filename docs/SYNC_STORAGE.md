# D1 sync storage

This is the server storage boundary for Phase 4. The wire contract is
[ADR-0013](adr/0013-http-sync-protocol.md); temporary identity and HTTP gating
belong to [ADR-0014](adr/0014-local-development-auth.md). Storage adds no HTTP
routes, authentication middleware, browser code, or IndexedDB changes.

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

`apps/api/repositories/changes.mjs` exports `createChangeRepository(DB)`.
Callers supply an already resolved owner ID. The repository enforces document
ownership, but it does not resolve tokens or accept an Origin. The future HTTP
boundary must apply ADR-0014's local gate before calling it, including for AES
and `none` envelopes.

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

Pull reads its cursor, integrity state, and rows in one batch. SQL first
limits candidates to `limit + 1` before calculating their sizes and retrieving
BLOBs; the repository then
counts each encoded envelope once to select the exact JSON byte-capped prefix. These binding
operations use D1's primary, without opting into read replicas. The separate full-log integrity check still
scans the document log; the candidate bound does not make that check constant-cost. No application
read-modify-write counter allocation or cross-await transaction is used.

`packages/sync-contract/contract.mjs` owns envelope validation, byte limits,
canonical encoding, and stored-envelope conversion. It has no platform or
planner dependencies. Server tests consume the same
[golden fixture](contracts/sync-v1.json) selected for future browser tests.
HTTP parsing, duplicate JSON keys, streamed request limits, Origin, and bearer
headers remain responsibilities of the later HTTP implementation.

Failures expose only `SyncError.code` and, for gap/rollback errors, `cursor`.
The repository does not log payloads, metadata, identities, SQL errors, or their
causes. NOT NULL failures on the integrity counter and envelope distinguish
`log_gap` and `change_conflict`. The named safe-range CHECK distinguishes
`sequence_exhausted`; unclassified database failures become
`temporarily_unavailable`. No automatic server retry changes the submitted
batch; callers follow ADR-0013's exact-envelope retry policy.

## Local evidence

`just test-d1` builds the API and runs the repository and shared-contract suites
inside the Workers runtime with a real local D1 binding. Each test resets
storage and applies the production migration with Cloudflare's migration helper.
The suites cover fresh/repeat migration, recorded schema version, concurrent
bootstrap, concurrent append, exact mixed acknowledgements, duplicate/conflict
handling, an injected mid-batch SQL failure, retry without consumed sequence,
owner isolation and a changed-owner race, gap rejection including duplicate-only
append, multiple cursor pages, cursor rollback, AES byte/metadata round trips,
and the 8 MiB response cap with lossless continuation. A trigger moves the
counter to its upper boundary inside a test transaction to exercise the real
CHECK and its rollback without manufacturing quadrillions of log rows.

The golden fixture's malformed envelopes and encoded-size boundaries also run
through the shared validator. CLI verification applies `0001_sync.sql` to an
empty local database, repeats it as a no-op, and reads the recorded filename.
This establishes local D1 behavior, not production deployment, HTTP auth,
cryptographic protection, or browser synchronization.
