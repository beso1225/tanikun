# Exchange opaque changes through a versioned HTTP sync log

## Status

accepted

## Context and decision

[Issue #138](https://github.com/beso1225/tanikun/issues/138) defines the
Phase 4 contract before Worker, D1, or browser sync implementation.
[ADR-0012](0012-automerge-planner-document.md) covers local change exchange
only. Keep its source-only boundary, local `storageVersion: 2`, and validation.
Use HTTP batch append and cursor pull with one owner and one document per user.
The server stores envelopes without decoding Automerge or planner content.
[ADR-0014](0014-local-development-auth.md) defines the temporary identity boundary.

A shared JavaScript ES module owns wire validation and constants. Its future
source path is `packages/sync-contract/contract.mjs`; it has no MoonBit domain,
browser, Worker, database, or Automerge imports. The Worker imports this source.
The web build copies the same file to `apps/web/dist/sync-contract.mjs`, where
the browser adapter imports it. No manually maintained second copy is allowed.
This avoids duplicating JSON parsing across MoonBit FFI and the Worker.
The pure domain and requirements packages do not depend on this module.

The checked-in [golden fixture](../contracts/sync-v1.json) is the current
contract artifact. Both future Worker integration and browser adapter tests
must load that exact file and assert its request, response, and failure cases.
The fixture contains synthetic opaque bytes, not valid Automerge history.
Protocol tests use it without a planner decoder; merge tests need separate
valid Automerge fixtures. Fixture response bodies are exact JSON values, not
subset matches. Required and forbidden response headers are asserted separately.
`raw_body` denotes literal UTF-8 request bytes instead of JSON serialization.
Large-body cases use the deterministic `request.body_generator` recipes described
in the fixture, so the repository does not store megabytes of repeated bytes.
`sequence_allocation_cases` exercise the counter's arithmetic boundary in model
or SQL unit tests without materializing quadrillions of log rows.
This decision adds no product module or route.

## Wire types and envelope

All routes use `/api/v1`. Requests and responses use UTF-8 JSON with
`Content-Type: application/json`; errors use the same type. Every response has
`Cache-Control: no-store`. JSON objects reject unknown and duplicate keys.
JSON key order and whitespace do not affect equality. No request compression
is accepted. Query keys must occur once and unknown keys are invalid.

A document ID is a server-generated lowercase UUID v4. The client never chooses
an owner or document at bootstrap. `change_id` is a lowercase 64-character hex
Automerge change hash, supplied by the client. The server validates its syntax
but cannot verify its relationship to encrypted bytes. Clients verify that
relationship after decoding. IDs are scoped to a document.

| Field              | Append envelope         | Meaning                                                                                  |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------------------- |
| `document_id`      | UUID string             | Must equal the route document                                                            |
| `change_id`        | Hash string             | Stable identity of the decoded change                                                    |
| `envelope_version` | Integer `1`             | Envelope format, independent of API and local storage versions                           |
| `payload_encoding` | String `base64`         | Canonical padded RFC 4648 standard base64, no whitespace                                 |
| `crypto_algorithm` | `none` or `AES-256-GCM` | `none` is permitted only by ADR-0014's local gate                                        |
| `key_version`      | Integer                 | `0` for `none`; positive safe integer for AES                                            |
| `nonce`            | String or null          | null for `none`; base64 of 12 random bytes for AES                                       |
| `aad`              | Object                  | Exactly `api_version`, `document_id`, `change_id`, `envelope_version`, and `key_version` |
| `payload`          | Base64 string           | Opaque bytes, including the 16-byte authentication tag for AES                           |
| `server_sequence`  | Absent on append        | Positive safe integer assigned by the server and added on pull                           |

`aad.api_version` is the integer `1`; other AAD values must equal the envelope.
AES authenticates the UTF-8 bytes of
`JSON.stringify([1, document_id, change_id, 1, key_version])` as additional data.
The algorithm and encoding are fixed by envelope version 1's AES variant.
Sequence is excluded because the client encrypts before allocation.
The client uses a fresh nonce for every encryption under a document key.
It persists the finished envelope before upload and retries those exact bytes.
Re-encryption under the same change ID is a conflict, even if plaintext matches.
Key rotation and envelope replacement require a later contract.

For `none`, payload bytes are the raw Automerge change. For AES, they are
ciphertext and tag. Server equality compares every validated envelope field,
including decoded payload and nonce bytes; it never compares planner content.
Canonical base64 and the fixed AAD shape make this equality unambiguous.
Empty payloads, invalid base64, AES payloads shorter than 17 bytes, and extra
metadata fields are rejected. No course, grade, requirement, display value,
client timestamp, or dependency list belongs in the envelope.

Phase 4 provides an opaque transport and a local-development restriction.
It does not provide cryptographic blindness: algorithm `none` exposes payloads
to the local server, and no Phase 6 key management or encryption is implemented.
No production plaintext is permitted. Phase 4 rejects every non-local sync
request, including an AES envelope. The local gate accepts both `none` and syntactically valid `AES-256-GCM`
envelopes. The server validates metadata and lengths but never decrypts or
verifies the tag. The AES fixture is synthetic opaque data, not a working
cryptographic example. Accepting an algorithm name is not evidence that
end-to-end encryption works.

## HTTP operations

`D` below denotes the authenticated caller's document. Exact examples and
statuses are in the golden fixture. All sync operations require authorization,
including bootstrap. Preflight checks Origin without resolving a bearer.

| Method and path                                          | Request                      | Success body and status                                                                             |
| -------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /api/v1/sync/document`                              | No body or query             | `200 {"document_id":D,"cursor":0}` for a new document; existing log high-water replaces `0`         |
| `POST /api/v1/sync/documents/D/changes`                  | `{"changes":[envelope,...]}` | `200 {"document_id":D,"accepted":[{"change_id":H,"server_sequence":1},...],"cursor":1}`             |
| `GET /api/v1/sync/documents/D/changes?after=0&limit=100` | No body                      | `200 {"document_id":D,"changes":[stored_envelope,...],"next_cursor":1,"has_more":false,"cursor":1}` |

Bootstrap atomically provisions the dev user and its server-generated document
when absent. Unique owner and document constraints make concurrent bootstrap
return the same document. Use an idempotent insert-on-owner-conflict operation
and read the winner on the primary inside the bootstrap transaction. A losing
concurrent bootstrap still returns `200` with that winner's document ID; it does
not return a conflict. Transient database failures use the normal `503` retry
policy. Concurrent append transactions serialize on D1; each returns `200` for
its committed result, `409` for a conflicting envelope, or `503` for a transient
failure. They never expose a uniqueness error as a new wire status.
Bootstrap does not create an Automerge seed. A first client
must pull existing history before uploading its local history. A new replica
must obtain the original Automerge history, not recreate the same JSON.
Phase 4 requires replicas to branch from that shared history as in ADR-0012.
If independent roots produce an invalid planner, preserve both local histories
and report merge failure; do not silently replace either plan.

Append validates the entire request before writing. Inside its atomic transaction,
it rejects an existing gap with `409 log_gap` before assigning any sequence.
That rejection also applies to an all-duplicate batch and consumes no sequence.
Each new distinct change
gets the next per-document sequence in request order. Identical repeats within
the request return the same sequence in each corresponding `accepted` entry.
An existing identical envelope returns its existing sequence. A differing
envelope with the same change ID returns `409 change_conflict` and rolls back
the entire batch, including earlier new entries. A failed batch consumes no
sequence. A lost response is retried with the exact saved envelopes. No batch
idempotency token is needed. `cursor` is the log high-water in that operation's
consistent view, not an acknowledgement that the client merged any changes.
An upload acknowledgement never advances the client's pull cursor.

## Cursor and client commit rules

`after` defaults to `0`; `limit` defaults to `100`. Both are decimal integers
without a sign, fraction, exponent, whitespace, or leading zeroes except `0`.
`after` ranges from `0` through `9007199254740991`; `limit` ranges from `1`
through `100`. JSON cursors and sequences use safe integers in the same range.
Sequence exhaustion returns `503 sequence_exhausted` without a write.

Pull reads the high-water, rows, and lookahead in one consistent database view,
using the primary or a D1 session that cannot move behind a previously observed
cursor. It returns ascending sequences strictly greater than `after`, bounded
by that view's `cursor`. Fetch up to the limit plus one to compute `has_more`.
The response is also capped at 8 MiB of UTF-8 JSON. Return the largest prefix
that fits both limits, and set `has_more` when rows remain. The maximum single
envelope always fits this cap.

`next_cursor` is the final returned sequence, or `after` on an empty page.
`has_more` is true exactly when the view contains later rows. A normal empty
page has `next_cursor == after == cursor` and `has_more: false`. Later appends
can appear in a later pull. A client continues pulling after an empty page
when it next syncs.

There is no deletion or compaction in Phase 4, so sequences are contiguous
starting at 1. If rows skip a sequence, or the counter claims a missing tail,
return `409 log_gap`. If `after > cursor`, return `409 cursor_ahead` with the
current high-water. Clients also reject gaps or inconsistent cursor fields in
an otherwise `200` response. Never skip the gap or reset the cursor silently.

The client persists two distinct values per server and document: the merged
pull cursor and the maximum server high-water it has observed. A bootstrap,
append, pull, or error response whose cursor is lower than that local maximum
stops sync as a rollback suspicion. Keep unsent changes, local history, and
both counters. Do not upload into the regressed log. The first observed value
establishes the maximum, not the merged cursor. Serialize sync operations per server and document so delayed concurrent
responses cannot look like rollback. A new browser without that local evidence
cannot detect an older server view.

Before advancing the merged cursor, the client decrypts when applicable,
checks each change hash, validates dependencies, applies the entire page to a
candidate Automerge document, and validates the materialized planner through
ADR-0012's boundary. Keep IndexedDB database `tanikun-planner` at version 1,
object store `documents`, and the planner at key `planner`. Sync metadata uses
the sibling key `"sync:" + JSON.stringify([apiOrigin, document_id])`, where
`apiOrigin` is the API URL's normalized origin without a trailing slash.
Its value is exactly
`{"syncVersion":1,"mergedCursor":0,"observedHighWater":0}` initially.
Both counters must be safe nonnegative integers, with `mergedCursor` no greater
than `observedHighWater`. Missing metadata starts both counters at zero; invalid
or future versions stop
sync without replacing the stored value. Do not alter the `storageVersion: 2`
planner envelope or add sync fields to planner source.

For a response containing `cursor`, first re-read metadata and check for
rollback in a read/write transaction. Then commit
`observedHighWater = max(stored, response.cursor)` in a read/write transaction
on `documents`, preserving `mergedCursor`. If that write fails, stop processing
and report persistence failure. Do not merge, acknowledge the page, or start
another network operation. A crash before this commit cannot be made durable;
no later merge or upload is permitted before the commit completes.

Only after that commit succeeds may the candidate planner and `mergedCursor`
commit together in a second transaction on the same object store. Re-read both
the planner and sibling metadata there. Apply ADR-0012's planner CAS check and
compare the merged cursor with the request's starting cursor. Preserve the
maximum stored high-water when replacing metadata. If another tab changed the
planner or cursor, reject the whole candidate commit and reload before retrying.
Serialize network sync across tabs per API origin and document, not only within
one tab. UI saves retain ADR-0012's CAS rule and leave sibling metadata intact.
A failed decode, dependency check, merge, validation, or second transaction
leaves the previous planner and merged cursor intact while retaining the first
transaction's observed high-water. After a crash, re-fetching the page is safe.

The server cannot enforce dependency order without inspecting content.
The client uploads changes in topological dependency order, with prerequisites
in earlier accepted batches or earlier in the same batch. A missing dependency
stops the page. Re-fetch from the last committed cursor, then replay from zero
into a separate candidate if necessary; do not advance past the unmerged page
while searching later pages for dependencies. A permanently malformed order
requires explicit recovery and is not silently treated as convergence.

## Errors, limits, retries, and logs

Every error body has exactly `{"error":{"code":"CODE"}}`, except `cursor_ahead`
and `log_gap`, which also have a top-level `cursor`. No errors echo request
values, SQL, payloads, tokens, or exception messages.

| Status | Code                      | Condition                                                    | Client action                                                      |
| ------ | ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| 400    | `malformed_request`       | Invalid JSON, field, ID, AAD, query, base64, or empty batch  | Fix request; retain pending changes                                |
| 401    | `unauthorized`            | Missing or invalid dev bearer                                | Stop until identity configuration is fixed                         |
| 403    | `origin_forbidden`        | Disallowed, null, or missing Origin                          | Stop; fix local origin                                             |
| 404    | `not_found`               | Missing or foreign document, disabled sync, or unknown route | Stop; never auto-rebind the local document                         |
| 405    | `method_not_allowed`      | Wrong method on a known enabled route                        | Fix request; include route-specific `Allow`                        |
| 409    | `change_conflict`         | Same change ID with a different envelope                     | Stop; preserve local bytes                                         |
| 409    | `cursor_ahead`            | Requested cursor exceeds server high-water                   | Stop and investigate rollback                                      |
| 409    | `log_gap`                 | Required log sequence is absent                              | Stop and preserve cursor                                           |
| 413    | `request_too_large`       | Request, decoded change, or batch count exceeds a limit      | Split pending batch; a single large change needs explicit recovery |
| 415    | `unsupported_media_type`  | Non-JSON content type or non-identity Content-Encoding       | Fix headers                                                        |
| 503    | `temporarily_unavailable` | Database or unexpected server failure                        | Retry exact request                                                |
| 503    | `sequence_exhausted`      | No safe integer remains                                      | Stop; requires a new contract                                      |

Limits are 4 MiB for the complete request body, 256 KiB for each decoded payload,
and 20 envelopes per append, counting repeated entries. Enforce body size while
streaming even without Content-Length. Reject before writes. Envelope version
or algorithm values outside the table return `400 malformed_request`.
The 4 MiB limit still applies when 20 individually valid envelopes exceed it.

Retry network failures, timeouts, and `503 temporarily_unavailable` with full
jitter exponential backoff: a random delay from zero to
`min(30000, 500 * 2^attempt)` ms, starting at attempt 0. Stop after five retries
and expose retry to the caller. Honor `Retry-After` seconds when present as a
minimum delay. Do not automatically retry other errors. A new user-triggered
sync resets the retry budget. Retry exhaustion never discards pending data.

Breaking field, algorithm, or semantic changes require a new API version.
Envelope versions do not alter `/api/v1` silently. Local storage and Automerge
schema versions remain governed by ADR-0012.

Logs contain only route templates, method, status, error code, duration, and
aggregate byte and change counts. Never log request bodies, headers, URL query
strings, document/change/user IDs, payloads, nonces, AAD, or raw exceptions.
Disable automatic request capture for these routes. This also applies to local
`none` traffic and development error handling.

## D1 atomic append decision

Choose a document counter-row fallback now; do not depend on a global
AUTOINCREMENT ID or allocating numbers in JavaScript before insertion.
[Cloudflare's D1 batch contract](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
states that failed statements roll back the transaction. This is upstream
documentation, not a completed Tanikun D1 spike. The concrete fallback is:

- One document row has a non-null `last_sequence` integer with a safe-integer CHECK.
- Log rows have unique `(document_id, change_id)` and `(document_id, sequence)`
  constraints, a positive safe-integer sequence CHECK, and a non-null canonical envelope BLOB.
- Canonical envelope bytes are UTF-8 JSON of the ordered array
  `[document_id, change_id, envelope_version, payload_encoding, crypto_algorithm, key_version, nonce, [1, document_id, change_id, 1, key_version], payload]`.
- For each envelope, bind document `?1`, change `?2`, and canonical BLOB `?3`
  where referenced. The counter UPDATE takes only the first two bindings.
  Execute the four per-envelope statements below, including its sequence SELECT.
  Each SELECT supplies that input entry's `accepted` result, including repeated
  and previously stored changes. Preserve input order when reading batch results.
  Submit the integrity guard, all envelopes' statements, and the final
  high-water SELECT in one
  `env.DB.batch()`. Never split the transaction between await calls.

The batch starts with this integrity guard, binding only the document ID.
Unique positive sequences, a count equal to the counter, and no sequence above
the counter establish a contiguous prefix. A violation sets the non-null counter
to NULL to abort before append. Do not check integrity in a separate transaction.

```sql
UPDATE sync_documents SET last_sequence = NULL
WHERE document_id = ?1 AND (
  last_sequence != (SELECT COUNT(*) FROM sync_changes WHERE document_id = ?1)
  OR EXISTS (
    SELECT 1 FROM sync_changes
    WHERE document_id = ?1 AND sequence > sync_documents.last_sequence
  )
);
```

For each input envelope, the batch then executes:

```sql
UPDATE sync_changes SET envelope = NULL
WHERE document_id = ?1 AND change_id = ?2 AND envelope != ?3;

UPDATE sync_documents SET last_sequence = last_sequence + 1
WHERE document_id = ?1
  AND NOT EXISTS (
    SELECT 1 FROM sync_changes WHERE document_id = ?1 AND change_id = ?2
  );

INSERT INTO sync_changes (document_id, change_id, sequence, envelope)
SELECT ?1, ?2, last_sequence, ?3 FROM sync_documents
WHERE document_id = ?1
  AND NOT EXISTS (
    SELECT 1 FROM sync_changes WHERE document_id = ?1 AND change_id = ?2
  );

SELECT change_id, sequence AS server_sequence FROM sync_changes
WHERE document_id = ?1 AND change_id = ?2;
```

The batch finishes with this read, binding only the document ID:

```sql
SELECT last_sequence AS cursor FROM sync_documents WHERE document_id = ?1;
```

The first per-envelope statement deliberately violates NOT NULL on a conflicting envelope.
That aborts the entire batch. An identical duplicate leaves both counter and
row unchanged. A new change increments the document's counter and inserts at
that number inside the transaction. A later failure rolls both back.
Ownership is resolved before constructing these statements, and every statement
is constrained to that resolved document. The actual table names and migration
remain #139's responsibility; this is a transaction design, not a migration.

Before shipping #139, the local D1 test must prove concurrent bootstrap returning
the same document, a two-change append,
identical replay, a mixed new/previously-stored/repeated batch with exact
`accepted` sequences, rejection of append into a gapped log, a new change
followed by a conflicting duplicate, rollback of
counter and rows, successful retry at the unconsumed next sequence, concurrent
append, and isolation across two owners. Classify constraint errors without
exposing raw database messages. On a failed batch, classify by both constraint
kind and guarded column, then recheck the relevant state on the primary.
`sync_documents.last_sequence` NOT NULL is `log_gap`, while its safe-range CHECK
is `sequence_exhausted`. `sync_changes.envelope` NOT NULL is `change_conflict`.
A column name alone cannot distinguish gap rejection from counter exhaustion.
The #139 implementation must test both constraint kinds and their wire errors.
Read the current primary counter for the `log_gap` error body after rollback.
Counter range overflow is `sequence_exhausted`; other failures are
`temporarily_unavailable`. A missing document remains `not_found`.
Do not label this fallback as runtime-proven
until that evidence exists. No claim of production D1 execution is made here. #139's pull tests must also
verify ascending order across multiple rows, byte-capped page truncation at
8 MiB with correct `has_more` and `next_cursor`, and fetching the remaining
rows without gaps. Its raw HTTP harness must reject duplicate Authorization
header lines on every operation, which object-valued fixture headers cannot
represent.

Local implementation evidence for this decision is recorded in
[D1 sync storage](../SYNC_STORAGE.md). The SQL names `documents.last_seq`
and `changes.seq` implement the counter and sequence used in this design.

## Snapshots, recovery, and threat model

Phase 4 retains the complete log and has no snapshot API, compaction, GC,
R2, or restore. Full resync means pulling from `after=0` into a separate
candidate, validating all pages, then explicitly adopting it. It must retain
unsent local changes and never lower the persisted observed high-water to hide
rollback. A changed document ID needs explicit rebind, not automatic reset.

A future snapshot must cover a complete dependency-closed prefix through a
specific server sequence `S`, identify that document and `S`, and be created
and authenticated by a client. Replay starts strictly after `S`. Publishing a
snapshot must not renumber the log or make older clients silently skip rows.
Phase 7 must version an explicit full-resync response before removing history.
No Phase 4 endpoint returns that future response.

A faulty or malicious server can omit, reorder, replay, fork, or roll back
records, lie about a cursor, deny access, and observe traffic. Contiguous
sequences, hashes, dependencies, and local high-water checks detect some faults;
they do not prove completeness or prevent a consistent fork. In Phase 4, `none`
provides no payload confidentiality or authentication. Even Phase 6 encryption
alone cannot prove server freshness. A fresh device lacks rollback evidence.

Public metadata exposes owner-to-document linkage to the server, change hashes,
lengths, algorithm and key versions, sequence/order, and request timing and IP.
Hashes can reveal repeated changes and enable correlation. Phase 6 must review
this leakage and authenticated key distribution. Local IndexedDB plaintext,
malicious delivered JavaScript, XSS, and compromised devices are outside a
transport envelope's protection.

Phase 5 owns passkeys, sessions, credentials, cookie CSRF, and rate limiting.
Phase 6 owns encryption, document/device keys, key transfer, rotation, and
cryptographic blindness. Phase 7 owns R2 snapshots, compaction, GC, and restore.
Sharing, memberships, roles, automatic peer discovery, and production deployment
are outside Phase 4.
