# Server boundary

Read this when you change the wire contract, Worker HTTP boundary, D1
repository, or local development auth. The canonical contracts are
[ADR-0013](../../../../docs/adr/0013-http-sync-protocol.md),
[ADR-0014](../../../../docs/adr/0014-local-development-auth.md), and
[D1 sync storage](../../../../docs/SYNC_STORAGE.md). This reference points to
the owners and the rules that are easy to break. It does not copy the SQL or
the envelope.

## Contract and limits

`packages/sync-contract/contract.mjs` owns `SYNC_LIMITS`, envelope validation,
canonical envelope bytes, and the wire JSON parser. The checked-in
[golden fixture](../../../../docs/contracts/sync-v1.json) is the shared
contract artifact. `apps/api/test/sync-contract.test.mts` and the Worker suites
consume it.

- Limits are 4 MiB for the request, 256 KiB for one decoded payload, 20
  changes per append, 8 MiB for a pull response, and 100 changes per pull page.
- Canonical envelope order is fixed by `validateEnvelope`. Equality uses the
  canonical bytes, not planner content.
- Do not add a second constants table in `apps/api/http/` or the browser.
  Import `SYNC_LIMITS`.
- A breaking field, algorithm, or semantic change needs an ADR or a new API
  version. Do not edit the fixture to match a drifted implementation.

## Worker order

`apps/api/http/sync.mjs` implements ADR-0014's order: local gate, Origin,
route, preflight, bearer, method, owned document, media type, size and syntax,
then operation. `apps/api/bridges/worker.mjs` keeps `/api/health` and sends
`/api/v1` to this boundary. `apps/api/http/json.mjs` bounds the streamed body
and uses the shared parser, which rejects duplicate keys at every depth.
`apps/api/http/respond.mjs` maps codes, adds `Vary: Origin`, and sends the
exact allow origin only for `http://127.0.0.1:4300`. It never sends credentials.

- Health is not sync. `just test-worker` proves the health endpoint only. It
  does not prove sync auth, D1, or convergence.
- Keep the gate before Origin and identity. A disabled or malformed local
  configuration returns `404 not_found` before identity resolution or D1.
- Do not add a route or a new port to make a test pass. The CORS origin is
  fixed by ADR-0014.

## Append transaction

`apps/api/repositories/changes.mjs` `append` builds one `DB.batch()` per
request:

1. The integrity guard nulls `documents.last_seq` when the contiguous log is
   broken.
2. For each envelope, the conflict guard nulls a differing stored envelope, the
   counter update increments only for a new change, the insert takes the new
   counter value, and the per-change `SELECT` returns the accepted sequence.
   Repeated entries in the request reuse their sequence.
3. The final `SELECT` reads the log high-water for the response cursor.

A failed batch rolls back rows and counter and consumes no sequence. `log_gap`
re-reads the current primary counter after rollback. `change_conflict` comes
from the deliberate NOT NULL on `changes.envelope`; `sequence_exhausted` comes
from the named range CHECK; anything else is `temporarily_unavailable`.

- Do not split the transaction across awaits or move the integrity guard into a
  separate transaction.
- Do not allocate a sequence in JavaScript before the insert.
- Keep every statement scoped to the resolved document and owner.

## Owner scope

`owned()` in `changes.mjs` selects `id` and `last_seq`, filtered by document ID
and `owner_id`. Every document
method calls it or repeats the owner and document predicate. `bootstrap` is the
provisioning exception: it inserts the user and document with conflict handling
and reads the winner in the same batch.

- Missing and foreign documents both return `404 not_found` after
  authentication. Do not reveal ownership.
- Never choose the owner or document from the request body. The envelope
  `document_id` must equal the route document.
- Keep `bootstrap` as the only provisioning path. Other sync requests do not
  auto-create documents.

## Pull view and cursor

`pull` reads the document cursor, the count and maximum sequence, and the
candidate rows in one `DB.batch()`. It checks `count === cursor` and
`maximum === cursor`, then `after > cursor`. It returns ascending sequences
after `after`, computes `has_more` from that view, and caps the JSON response at
8 MiB. `next_cursor` is the final returned sequence, or `after` on an empty
page.

- `cursor` is the log high-water. It is not an acknowledgement that a client
  merged a page.
- An upload acknowledgement never advances the client's pull cursor.
- Do not skip a gap or reset a cursor silently. `log_gap` and `cursor_ahead`
  are `409` with the current cursor.

## Local development auth

`apps/api/http/auth.mjs` owns the dev-bearer gate. Identity resolves only when
all of these are true:

- `AUTH_MODE` is exactly `dev_bearer`.
- `DEV_AUTH` is exactly `true`.
- `APP_ENV` is exactly `local`.
- The request URL is `http` on `127.0.0.1` or `localhost`.
- The Origin is exactly `http://127.0.0.1:4300`.
- `DEV_AUTH_IDENTITIES` is a valid, nonempty mapping with nonempty tokens and
  IDs.
- No session-only `AUTH_ORIGIN`, `RP_ID`, or `AUTH_RATE_LIMIT_KEY` is present.

A failed environment, URL, mode, or mapping gate returns `404 not_found`. A
missing, malformed, or unknown bearer returns `401 unauthorized` with
`WWW-Authenticate: Bearer`.
There is no anonymous fallback. The browser transport uses an explicit
`mode: "dev_bearer"` with `credentials: "omit"`. `just dev-api` supplies the
local variables. Default, preview, and production configurations must omit
them.

## Session sync

`AUTH_MODE=session` resolves the principal only from the HttpOnly cookie through
the shared session admission and rate-limit guards. The exact
`https://localhost:4300` Origin is required, session appends require
`X-CSRF-Token`, and the 120/minute session fixed window is charged after
ownership and request validation. Bootstrap is
`POST /api/v1/sync/document`; `GET` returns `405 Allow: POST`. The owner is the
server-resolved user ID. Foreign and missing documents are indistinguishable
`404`, and append/pull never create or rebind a document. Provisioning accepts no
caller owner. Session errors have no CORS or `WWW-Authenticate` header and clear an invalid presented
session cookie.

A `401` is not a dev fallback: session mode rejects any `Authorization` header
with `400 malformed_request`, and an absent or invalid cookie returns `401`.
The Phase 4 dev-bearer harness remains a separate explicit mode.

- Do not add a query, cookie, body, or user-ID header as an identity source.
- Do not log tokens, identities, envelopes, payloads, or raw SQL errors.
- `none` payloads are plaintext. This is not production authentication or
  end-to-end encryption.

## Focused proofs

- `apps/api/test/sync-contract.test.mts` for shared validation and limits.
- `apps/api/test/sync-repository.test.mts` for the D1 schema, append, pull,
  ownership, concurrency, and byte caps.
- `apps/api/test/worker-sync.test.mts` for the HTTP boundary, CORS, local gate,
  query and body rejection, and redaction.
- `just test-d1` runs the repository, contract, and Worker HTTP suites in the
  Workers runtime with a real local D1 binding.
- `just test-worker` is only the health case.
