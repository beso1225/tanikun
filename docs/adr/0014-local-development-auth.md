# Restrict temporary sync identities to local development

## Status

accepted

## Context and decision

Phase 4 needs authenticated owner scoping before Phase 5 implements real
identity. Use an explicit local-only bearer mapping, with one user and one
server-generated document per identity. This keeps resource authorization in
the Worker while allowing the credential resolver to be replaced later.
[ADR-0013](0013-http-sync-protocol.md) owns the sync wire protocol.

## Provisioning and local gate

The developer configures a local secret `DEV_AUTH_IDENTITIES` containing a
JSON object mapping opaque bearer tokens to stable dev user IDs, for example
`{"local-fixture-token-alice":"dev-alice"}`. That token is public test data
only. Real local tokens are random values with at least 128 bits of entropy.
Do not commit local mappings or inject the whole mapping into browser assets.
The developer supplies one token to each test client through local runtime
configuration. Different clients may intentionally use the same identity.
Changing a token retains identity only when the mapping retains the same user ID.

The resolver operates only when all these conditions hold:

- `DEV_AUTH` is exactly the string `true`.
- `APP_ENV` is exactly `local`.
- The request URL has scheme `http` and hostname exactly `127.0.0.1` or `localhost`.
- The request has the allowed Origin described below.
- The local identity mapping is valid, nonempty, and has nonempty tokens and IDs.

The Wrangler local configuration enables these settings explicitly. Default,
preview, and production configurations omit them. A production deployment
check must reject `DEV_AUTH=true`, any dev identity mapping, and sync enablement
before Phase 5 and Phase 6 provide the production boundary. Host headers and
Origin are additional local checks, not a way to establish trust on a public
server. Never expose the local Worker through a tunnel or public listener.

A failed environment or URL gate returns `404 not_found` before resolving
identity, provisioning, or accessing D1. This includes all production sync
requests, even if the caller supplies AES payloads or a dev bearer. Invalid
mapping configuration also fails closed with `404 not_found`; diagnostics
must not expose the mapping. The health endpoint retains its existing behavior.

For enabled sync, require exactly one
`Authorization: Bearer <token>` header and an exact mapping match. No query,
cookie, request-body, or user-ID header can supply identity. Missing, malformed,
and unknown tokens return `401 unauthorized` with
`WWW-Authenticate: Bearer`. Never fall back to an anonymous or default owner.

A valid bootstrap auto-provisions the user and its document atomically.
Enforce unique user identity and unique document owner. Other sync requests
do not auto-create documents. Foreign and nonexistent document IDs both return
`404 not_found`, after authentication. Do not reveal whether a foreign document
exists. No memberships, roles, sharing grants, or caller-selected owner fields
exist in Phase 4. Bind every D1 lookup and write to the resolved owner/document.

## Origin, CORS, and rejection order

The only allowed browser Origin is exactly `http://127.0.0.1:4300`.
`localhost:4300`, different ports, HTTPS, `null`, and a missing Origin are
rejected with `403 origin_forbidden`. CLI and integration clients must also
supply the exact allowed Origin. It is a cross-origin local web/API setup,
with the API normally at `http://127.0.0.1:8787`.

For allowed origins, responses include
`Access-Control-Allow-Origin: http://127.0.0.1:4300` and `Vary: Origin`,
including error responses. Disallowed origins receive no allow-origin header.
Never send `Access-Control-Allow-Credentials`; browser fetch uses
`credentials: "omit"` and an explicit bearer header. Cookies are ignored.

An enabled known route accepts an `OPTIONS` preflight without a bearer because
browser preflight does not carry it. It requires the allowed Origin and an
`Access-Control-Request-Method` supported by that route. Requested headers must
be a case-insensitive subset of `Authorization` and `Content-Type`.
Valid preflight returns `204`, no body, route-specific
`Access-Control-Allow-Methods` (`GET` or `POST`),
`Access-Control-Allow-Headers: Authorization, Content-Type`, and
`Access-Control-Max-Age: 0`. It never provisions an identity or touches D1.
Invalid preflight method or headers return `403 origin_forbidden`.

Evaluate requests in this order: environment/URL/configuration gate, Origin,
route existence, preflight, bearer, method, owned resource lookup, media type,
size and syntax, then semantic validation and operation. An unparseable route
ID is `400 malformed_request` after bearer/method checks; a valid foreign ID
is `404 not_found`. Known paths with unsupported methods return `405` with
`Allow: GET, OPTIONS` or `Allow: POST, OPTIONS`. Unknown paths are `404`.
This order fixes ambiguous combinations, such as a foreign document plus an
invalid body, without disclosing ownership.

The [shared fixture](../contracts/sync-v1.json) includes unauthorized, foreign,
Origin, preflight, and production rejection cases. Tests must assert status,
body, headers, and absence of database writes for rejected requests.

## Replacement and limits

Phase 5 replaces only the credential resolver with passkey-backed identity
and sessions, preserving the resolved principal, single owner, document scoping,
and indistinguishable foreign/missing resource responses. Public enablement
also requires Phase 6's encryption and production deployment review.
Any cookie-based session must define a new CSRF and Origin contract before use.
Dev identities are not production accounts; this ADR specifies no automatic
migration or binding of dev plans to real accounts.

Bearer mapping is a development convenience. Anyone with a mapped token can
act as that dev user. Origin checks cannot stop a non-browser caller that knows
the token, and `none` payloads remain readable locally. Test with fictional
plans only. Never inspect or log tokens, identities, envelope metadata, or
planner payloads. Use ADR-0013's restricted logging fields.

Passkeys, sessions, credential storage, account recovery, sharing, cookie CSRF,
and rate limiting are explicitly deferred to later phases. This decision
adds no production authentication, product route, D1 binding, or migration.
