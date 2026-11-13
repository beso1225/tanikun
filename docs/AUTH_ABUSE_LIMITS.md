# Phase 5 authentication abuse limits

## Status

This page documents the implementation of
[issue #181](https://github.com/beso1225/tanikun/issues/181) for Phase 5. The
accepted contract is [docs/PHASE_5.md](PHASE_5.md), including its abuse-limit
table, error envelope, and rejection order. The production policy owner is
`apps/api/rate-limits/policy.mjs`; this page records the storage, trust,
normalization, concurrency, and failure behavior behind that table.

The work is local and test only. Session mode is not enabled in the default
Worker bridge. #182 still owns session-to-sync authorization and route
activation, and #184 still owns credential list and removal. No production
deployment, Durable Object, new service, or new framework is added here.

## Enforcement store

D1 is the admission authority. The new
`auth_rate_limit_counters` table stores one row per fixed-window bucket:

| Column         | Meaning                                                      |
| -------------- | ------------------------------------------------------------ |
| `bucket_key`   | Keyed HMAC-SHA-256 digest encoded as 43 base64url characters |
| `window_start` | Inclusive fixed-window start in epoch milliseconds           |
| `count`        | Admitted requests in this window, from 1 through the limit   |
| `expires_at`   | `window_start + windowMs + 1 hour`                           |

The primary key is `(bucket_key, window_start)`. An index on `expires_at`
supports bounded opportunistic cleanup. The table stores no address,
credential ID, session digest, token, CSRF value, challenge, assertion, PRF
output, planner content, or other scope value.

`AUTH_RATE_LIMIT_KEY` is a base64url 32-byte deployment secret. The session
configuration gate rejects a missing or malformed key before routing. Each
bucket key is:

```text
base64url(HMAC-SHA-256(
  AUTH_RATE_LIMIT_KEY,
  "tanikun-auth-rate-v1" || 0x00 || policy_id || 0x00 || scope || 0x00 || scope_value
))
```

The policy ID provides domain separation between limits, and the scope value is
canonicalized by type. Binding and session values are already SHA-256 digests.
The credential scope uses the submitted canonical credential ID without a
database lookup, so unknown and invalid credentials consume the same budget as
known ones. Address values use the trusted source described below.

## Fixed windows and concurrency

`window_start` is `floor(now / windowMs) * windowMs`. The counter row survives
its window for one additional hour. Enforcement does not depend on cleanup; a
bounded cleanup of at most 100 expired rows runs as the first statement of each
enforcement batch.

Each applicable bucket uses one conditional upsert on the D1 primary:

```sql
INSERT INTO auth_rate_limit_counters
  (bucket_key, window_start, count, expires_at)
VALUES (?1, ?2, 1, ?3)
ON CONFLICT(bucket_key, window_start) DO UPDATE
  SET count = count + 1
  WHERE count < ?4
RETURNING count;
```

The primary key and the `count < limit` predicate make the per-bucket decision
serial and exact. Concurrent requests cannot admit more than the fixed limit.
The losing upsert returns no row and does not increment that bucket.

A request can have several applicable buckets. All of its upserts, plus the
bounded cleanup, execute in one `DB.batch()` call. The batch is a SQL
transaction, but a conditional upsert that returns no row is not a SQL error.
Admission requires every applicable upsert to return a row. A denied request can
therefore still consume capacity from the other buckets in the same batch. This
is intentional and conservative: it may make a later legitimate request wait,
but it never bypasses a limit. Each auth request issues at most one bounded
cleanup and one upsert per applicable scope, which is at most three upserts for
the accepted table.

A blocked response is `429` with exactly `{"error":{"code":"rate_limited"}}` and
an integer `Retry-After` in seconds until the blocked window ends. When several
buckets are blocked, the response uses the longest wait. The minimum is one
second. A request at the last millisecond of a window receives `Retry-After: 1`,
and the next request at the next window start starts a new counter row.

The per-binding outstanding challenge cap of three remains in the challenge
repository. It runs after the fixed-window admission and returns `429` with
`Retry-After` until the oldest outstanding challenge expires. Fixed-window
counters and the outstanding cap are separate controls.

## Trusted client address

The only accepted client-address source is the Cloudflare-supplied
`CF-Connecting-IP` header on a request whose `request.cf` property is present as
an object. The Worker does not read `X-Forwarded-For`, `Forwarded`, `X-Real-IP`,
a query value, a body value, or any other client-controlled header for this
decision. Cloudflare documents that `request.cf` contains request metadata and
that `CF-Connecting-IP` is supplied by Cloudflare's edge. A same-zone Worker
subrequest can rewrite `x-real-ip`, so the Worker path does not use it.

If `request.cf` is absent, `CF-Connecting-IP` is absent, or the header is not a
single address-shaped value, the request uses one shared `unknown` address
bucket. This keeps the check fail-closed instead of turning a missing value into
a new bucket. The address value is rejected when it is empty, a comma-separated
list, longer than 45 characters, or contains characters outside IPv4 or IPv6
text. Any leading or trailing whitespace is rejected if the runtime preserves
it, and IPv6 hexadecimal text is lowercased. The Worker does not parse the value
to binary or resolve it. Other textual forms, such as expanded or compressed
IPv6 spellings, are not canonicalized to a shared form.

D1 counters are the admission authority. Cloudflare's
[Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
is explicitly approximate and applies separately in each Cloudflare location.
Phase 5 does not use that binding, does not claim that any per-location limit is
a globally exact quota, and does not add a Durable Object or a new service to
compensate. The cloud platform references were checked on 2026-11-13:

- [Workers Request and request.cf](https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties)
- [Cloudflare HTTP headers: CF-Connecting-IP](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip)
- [Cloudflare Workers Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

## Rejection order and composition

`handleSessionAuthRequest` is the composition point. It applies the session
boundary's mode, exact Origin, route, method, session, CSRF, recent-auth, media,
and body checks before the fixed-window check. The fixed-window check runs
before browser-binding verification, challenge consumption, WebAuthn parsing,
attestation parsing, signature verification, and the requested operation. A
request whose body is malformed, oversized, or has the wrong media type keeps
its existing `400`, `413`, or `415` response even when a bucket is exhausted.

A missing or invalid binding cookie cannot be used to skip the address or
session budget. On verification routes the read used for the rate key never
mints or rebinds a cookie. The route's normal binding check still returns the
documented `401`, and a rate-limited request returns `429` without a
`Set-Cookie` header.

The route mappings are:

| Route class         | Accepted scopes and limits                             |
| ------------------- | ------------------------------------------------------ |
| Challenge issuance  | trusted address, browser binding                       |
| Registration verify | trusted address, browser binding                       |
| Sign-in verify      | trusted address, browser binding, submitted credential |
| Step-up verify      | session                                                |
| Credential add      | account, plus challenge issuance on options            |
| Logout-all          | account                                                |
| Session status      | session                                                |
| Sync request        | session, prepared for #182                             |

Credential list and removal are not implemented here. The policy table already
maps credential removal to the account limit so #184 can reuse the limiter
without inventing a second policy.

The default Worker bridge still has no auth or session route. Session mode is
available only to local and test configuration with the exact origin, RP ID,
and rate key. #182 must route the session principal into sync, and #184 must add
credential management. Tests can call the composition directly, but there is no
test-only environment bypass or anonymous fallback.

## Failure behavior and diagnostics

A counter cleanup, upsert, or key operation failure returns the redacted
`503 temporarily_unavailable` envelope. It never bypasses a check, completes a
challenge, creates a session, or changes a cookie. A session that was valid at
admission keeps its cookie on a storage failure; a commit-time session
rejection still clears the cookie as documented for the session boundary.

The limiter emits no request logs. HTTP error bodies contain only the bounded
error code. Tests cover synthetic canaries in credential IDs, addresses,
cookies, and SQL trigger messages and assert that they do not appear in the
response, console output, or stored bucket keys. No raw session token, CSRF
token, challenge, assertion, PRF output, planner payload, or credential
response is accepted by the limiter's API or written to the counter table.

## Verification

Focused tests use the pinned Workers runtime and a real local D1 binding. They
cover exact limit and boundary recovery with a controlled clock, concurrent
requests, trusted and unknown addresses, forged forwarding headers, binding,
credential, session, and account isolation, each route class, the rejection
order, missing binding behavior, storage failure, redaction canaries, migration
forward compatibility, and the reusable #182 session-sync guard. The packaged
API test also enforces a fixed window through the self-contained `auth.js`
bundle.
