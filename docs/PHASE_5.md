# Phase 5 authentication, session, and account-boundary contract

## Status

proposed

This contract is the implementation target for
[issue #177](https://github.com/beso1225/tanikun/issues/177). It is not accepted
and no implementation is authorized by this page. Acceptance requires evidence
from [issue #176](https://github.com/beso1225/tanikun/issues/176) in the pinned
Workers runtime and final review. [ADR-0014](adr/0014-local-development-auth.md)
remains the current credential boundary until then. The proposed decision is
[ADR-0015](adr/0015-passkey-session-account-boundary.md).

Phase 5 will implement passkey authentication locally with fictional accounts. It
does not enable public plaintext planner sync. [ADR-0013](adr/0013-http-sync-protocol.md)
continues to own the sync envelope, sequence, cursor, retry, and error contract.
This page adds only the identity, session, CSRF, provisioning, and local account
boundaries around it. Do not restate the envelope here.

## Scope and invariants

- Keep one owner and one server-generated document. Preserve ADR-0013's owner
  scoping, append idempotency, limits, cursor high-water, and foreign/missing
  `404 not_found` response.
- A real session resolves exactly one server-owned account. No caller supplies
  an owner, user ID, or document ID during provisioning.
- A failed real session never falls back to a dev bearer, a cookie from another
  mode, an anonymous account, or a default owner.
- Dev bearer remains an explicit local test mode. It is not a real-account
  migration path.
- Phase 5 does not implement encryption, document keys, device enrollment,
  backups, sharing, account recovery, or deployment.
- Authentication recovery is not document-key recovery. A new passkey or a new
  account does not decrypt an old document.

## Terms

| Term               | Meaning in this contract                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| Account            | The authentication principal. It is not the planner `AcademicProfile`.                                  |
| Account handle     | A server-owned, random, public WebAuthn user handle. It is not the internal owner ID.                   |
| Owner ID           | The internal `users.id` used by `documents.owner_id`.                                                   |
| Credential         | A WebAuthn public key credential belonging to one account.                                              |
| Challenge          | A one-time, purpose-bound, browser-bound value that authorizes one ceremony.                            |
| Session            | A server row keyed by a digest of an opaque cookie token.                                               |
| Recent auth        | A successful assertion for the current session within the last five minutes.                            |
| Browser binding    | The `__Host-tanikun_binding` cookie value, digested into each challenge row.                            |
| Account generation | A local random value that changes on sign-in, sign-out, and account switch. It fences stale local work. |

## RP ID, origins, and topology

Phase 5 real authentication uses one same-origin HTTPS topology. The web app and
`/api` share one origin. There is no session CORS path.

| Environment            | Exact origin             | RP ID       | Transport                                        |
| ---------------------- | ------------------------ | ----------- | ------------------------------------------------ |
| Local real auth and CI | `https://localhost:4300` | `localhost` | Loopback TLS with a browser-trusted test cert    |
| Production             | Not enabled in Phase 5   | Not enabled | Phase 8 only, after the Phase 6 review           |
| Dev bearer             | `http://127.0.0.1:4300`  | not used    | HTTP on loopback; API at `http://127.0.0.1:8787` |

Rules:

- The RP ID is the exact host `localhost`. It has no scheme, port, path, or
  trailing dot. `127.0.0.1` is not used as a WebAuthn RP ID because an IP
  literal is not a valid RP ID.
- The local TLS terminator serves the built app and forwards `/api` to the
  Worker. The test browser trusts the certificate. Do not depend on the
  `http://localhost` Secure-cookie exception.
- The Worker reads `AUTH_ORIGIN` and `RP_ID` from configuration. It does not
  derive them from a forwarded host or an internal request URL.
- A production deployment must use exactly one HTTPS origin whose host equals
  the RP ID, with no wildcard, parent-domain, alias, or related-origin path.
  That deployment is not part of Phase 5.
- WebAuthn runs in a top-level same-origin document. Iframes, related origin
  requests, and cross-origin credential creation are not supported.
- `expectedOrigin` is exactly `AUTH_ORIGIN`. `expectedRPID` is exactly `RP_ID`.
  The server verifies both values, the ceremony type, the challenge, and the
  RP ID hash.
- The dev bearer mode keeps ADR-0014's exact origins, CORS, preflight,
  `credentials: "omit"`, and bearer header. Session mode emits no CORS
  credentials and accepts no `Authorization` header.

The local real-auth setup is a test harness, not a public listener. It must bind
only to loopback, must not be exposed through a tunnel, and must use fictional
planner data. The real-auth app origin differs from the Phase 4 dev origin, so
its IndexedDB is a separate browser storage partition.

## Authentication modes and configuration

`AUTH_MODE` is exactly `dev_bearer`, exactly `session`, or absent. The modes are
mutually exclusive.

| Mode         | Required configuration                                                                                                | Forbidden configuration                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `dev_bearer` | `APP_ENV=local`, `DEV_AUTH=true`, valid nonempty `DEV_AUTH_IDENTITIES`, exact HTTP URL                                | `AUTH_MODE=session`, session cookies, real accounts                  |
| `session`    | `APP_ENV=local` or `test`, exact `AUTH_ORIGIN=https://localhost:4300`, `RP_ID=localhost`, valid `AUTH_RATE_LIMIT_KEY` | `DEV_AUTH=true`, dev mappings, public origin or `APP_ENV=production` |
| absent       | none                                                                                                                  | all auth and sync routes                                             |

Additional rules:

- A missing, malformed, incomplete, or ambiguous configuration returns
  `404 not_found` for every auth and sync route before routing, Origin, session,
  or D1 access. The health endpoint is unchanged.
- Session mode requires `AUTH_RATE_LIMIT_KEY`, a base64url 32-byte deployment
  secret used for keyed rate-limit digests. Its absence is a configuration
  failure.
- Phase 5 will add `AUTH_MODE=dev_bearer` to the existing local development
  and test configuration. The mode is explicit, not inferred from `DEV_AUTH`. The default
  `wrangler.jsonc` remains without a mode and therefore fails closed.
- Session mode rejects any `Authorization` header with `400 malformed_request`.
  Dev bearer mode ignores cookies. A cookie cannot rescue a failed bearer.
- Default, preview, and production configurations omit both modes. A
  deployment check rejects `DEV_AUTH=true`, any dev mapping, `AUTH_MODE=session`,
  `TEST_NEW_DOCUMENT_ID`, and any public plaintext sync setting until Phase 6
  and Phase 8 review.

## Accounts, handles, and credentials

### Account creation

An account has an internal owner ID, a public user handle, a display name, a
creation time, and a credential set. Real owner IDs use a distinct opaque
namespace, for example `acct_` followed by random data. Dev user IDs are never
reused, linked, or converted.

The user handle is 32 random bytes encoded as 43 base64url characters. It is
unique, immutable, non-PII, and never derived from a display name or email. The
display name is optional at registration, 1 to 80 Unicode scalar values, has no
control characters, is not unique, and is not used for lookup. If it is absent,
the server uses `Tanikun user`. Both WebAuthn `user.name` and `user.displayName`
use the display name.

The `users` table keeps existing dev rows. The forward migration adds nullable
`handle` and `display_name` columns plus a unique partial index on non-null
handles. Real accounts require both values. Existing dev rows remain without
handles and are unreachable through session authentication. Existing documents,
changes, sequences, and owner uniqueness are preserved.

### Credentials

| Field            | Rule                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Credential ID    | 1 to 1023 bytes, base64url on the wire, globally unique, immutable                       |
| Public key       | COSE public key bytes from verified registration; never a private key                    |
| Owner            | One account; foreign and missing credential IDs both return `404 not_found`              |
| Counter          | Nonnegative safe integer; policy below                                                   |
| Backup eligible  | Boolean flag from the verified authenticator data                                        |
| Backup state     | Boolean flag from the verified authenticator data; rejected when true while not eligible |
| Created and used | Server epoch milliseconds                                                                |
| Limit            | At most 20 credentials per account                                                       |

No credential stores an attestation chain, an AAGUID-derived provider identity,
transports as a trust input, a private key, a PRF result, or a user handle
separate from its account.

### Ceremony policy

| Setting                   | Value                                  | Reason                                                          |
| ------------------------- | -------------------------------------- | --------------------------------------------------------------- |
| Discoverable credential   | `residentKey: "required"`              | Sign-in needs no username or account list                       |
| User presence             | Required                               | WebAuthn ceremony requirement                                   |
| User verification         | `userVerification: "required"`         | Passkey-only accounts require a user gesture and local check    |
| Attestation               | `attestation: "none"`                  | No provider policy, privacy loss, or attestation storage        |
| Supported algorithm       | ES256, COSE `-7`, provisional          | Smallest defensible allowlist until #176 proves runtime support |
| Registration exclude list | Current credential IDs for the account | Prevent duplicate registration on the same authenticator        |
| Sign-in allow list        | Empty                                  | Discoverable credentials only                                   |
| Authenticator attachment  | Omitted                                | Allow platform, synced, security-key, and hybrid providers      |

ES256-only is a policy choice, not a proven runtime fact. #176 must verify that
the selected verifier and the pinned Workers runtime can process ES256 and that
the selected library can run within the Worker limits. Adding any other COSE
algorithm requires an updated contract and new evidence. No algorithm fallback,
version pin, or dependency is selected by this page.

### Counter and backup policy

- A verification result with backup state 1 and backup eligibility 0 is invalid
  authenticator data and fails authentication.
- A backup-eligible credential may report zero, repeat, or lower counters
  because it can be copied or synchronized. Accept the assertion, store the
  maximum observed counter, and do not reject on a counter comparison.
- A non-backup-eligible credential with a stored positive counter and a new
  positive counter less than or equal to the stored value fails authentication.
  A zero counter is accepted, and the stored maximum is preserved.
- The counter update is a conditional compare-and-set or a `MAX` update under
  this policy. A concurrent stale update must not lower the stored value, and a
  failed non-backup-eligible guard must abort the authentication transaction.
- Counter values are not replay protection. Challenge consumption is.
- Backup state changes do not revoke sessions. They are recorded on the
  credential and are not used to identify a provider.

## Ceremonies and one-time challenges

Every options endpoint performs these steps in one D1 batch:

1. Delete expired challenge rows opportunistically in a bounded batch.
2. Count unconsumed, unexpired challenges for the browser binding. If three
   exist, return `429` with `Retry-After` until the oldest expires.
3. Insert a challenge row with a random 16-byte ID, a digest of the 32-byte
   challenge, a digest of the browser binding cookie, the purpose, the pending
   account or session binding, and an expiry.
4. Return the raw challenge and `challenge_id`.

The client receives a `challenge_id` and the public key options. It sends the
same `challenge_id` with the allowlisted credential response. The raw challenge
is not stored.

| Property        | Value                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| Purposes        | `register`, `sign_in`, `add_credential`, `step_up`                          |
| Challenge       | 32 random bytes, base64url on the wire                                      |
| Challenge ID    | 16 random bytes, base64url on the wire                                      |
| Binding cookie  | `__Host-tanikun_binding`, 32 random bytes, one-day lifetime                 |
| Lifetime        | 300 seconds                                                                 |
| Per binding cap | 3 outstanding unconsumed challenges                                         |
| Consumption     | One conditional `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now` |
| Failure         | Generic `401`; the challenge is burned even when verification fails         |

The server parses `clientDataJSON`. Its type is exactly `webauthn.create` for
registration or `webauthn.get` for an assertion. Its challenge digest matches
the row, its origin is exactly `AUTH_ORIGIN`, `crossOrigin` is false, and
`topOrigin` is absent. The server checks the RP ID hash, verifies the signature
with the stored public key, and checks the user presence and user verification
flags. For registration it verifies the attestation object and derives the
public key. Any attestation statement is parsed only as required by the
verifier and then discarded. For sign-in it requires a non-null user handle and
checks it against the credential's account. For step-up and credential addition
it requires the current session and account.

Concurrent verification has one winner because the conditional update changes
exactly one row. A second concurrent request gets the same generic failure. An
expired, consumed, unknown, wrong-purpose, or wrong-binding challenge never
creates an account, authenticates a user, or adds a credential.

### Ceremony option fields

Every options response is `{"challenge_id":"<base64url 16 bytes>","publicKey":{...}}`.
The `publicKey` object is projected from the verifier's output and contains only
the fields below.

| Ceremony       | Required `publicKey` fields                                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration   | `rp` with exact `id` and `name`; `user` with the account handle and display name; `challenge`; `pubKeyCredParams` with exactly ES256; `timeout`; `excludeCredentials`; `authenticatorSelection`; `attestation: "none"` |
| Sign-in        | `challenge`; `timeout`; exact `rpId`; empty `allowCredentials`; `userVerification: "required"`                                                                                                                         |
| Add credential | Same as registration, with `excludeCredentials` set to the account's current credential IDs                                                                                                                            |
| Step-up        | Same as sign-in, with `allowCredentials` set to the account's current credential IDs                                                                                                                                   |

Registration values:

- `rp` is `{"id":"<RP_ID>","name":"Tanikun"}`.
- `user` is `{"id":"<handle>","name":"<display_name>","displayName":"<display_name>"}`.
- `pubKeyCredParams` is exactly `[{"type":"public-key","alg":-7}]`.
- `excludeCredentials` is an array of `{"type":"public-key","id":"<credential id>"}`.
- `authenticatorSelection` is `{"residentKey":"required","requireResidentKey":true,"userVerification":"required"}`.
- `attestation` is exactly `"none"`.
- `timeout` is `120000` milliseconds. The server challenge expires after 300
  seconds, so a slow network still has a short grace period.
- `extensions` is absent. Phase 5 does not request PRF, `credProps`, or any other
  extension.

The server does not pass through arbitrary verifier option fields. Additional
fields require a contract update.

## Endpoints

All JSON requests use `Content-Type: application/json`. All auth and sync
responses use `Cache-Control: no-store`. Every auth body is limited to 32 KiB.
All state-changing requests use `POST` except the explicit dev-bearer GET below.

| Method and path                                       | Authentication                 | CSRF            | Recent auth | Success                                         |
| ----------------------------------------------------- | ------------------------------ | --------------- | ----------- | ----------------------------------------------- |
| `POST /api/v1/auth/register/options`                  | Public; valid session is `409` | no              | no          | `200` options and `challenge_id`                |
| `POST /api/v1/auth/register/verify`                   | Public challenge               | no              | no          | `200` account, session, and CSRF token          |
| `POST /api/v1/auth/sign-in/options`                   | Public                         | no              | no          | `200` options and `challenge_id`                |
| `POST /api/v1/auth/sign-in/verify`                    | Public challenge               | no              | no          | `200` account, session, and CSRF token          |
| `GET /api/v1/auth/session`                            | Session, optional              | no              | no          | `200 {"session":null}` or `200` session         |
| `POST /api/v1/auth/logout`                            | Session                        | yes             | no          | `204`; clears the session cookie                |
| `POST /api/v1/auth/logout-all`                        | Session                        | yes             | yes         | `204`; revokes all account sessions             |
| `POST /api/v1/auth/step-up/options`                   | Session                        | yes             | no          | `200` assertion options and `challenge_id`      |
| `POST /api/v1/auth/step-up/verify`                    | Session challenge              | yes             | no          | `200` recent-auth result                        |
| `GET /api/v1/auth/credentials`                        | Session                        | no              | no          | `200` minimal credential metadata               |
| `POST /api/v1/auth/credentials/options`               | Session                        | yes             | yes         | `200` registration options and `challenge_id`   |
| `POST /api/v1/auth/credentials/verify`                | Session challenge              | yes             | yes         | `200` added credential metadata                 |
| `POST /api/v1/auth/credentials/{credentialId}/remove` | Session                        | yes             | yes         | `204`; revokes all account sessions             |
| `POST /api/v1/sync/document`                          | Session                        | yes             | no          | `200 {document_id, cursor}`; idempotent         |
| `GET /api/v1/sync/document`                           | Dev bearer only                | no              | no          | `200 {document_id, cursor}`; session mode `405` |
| `POST /api/v1/sync/documents/{id}/changes`            | Session or dev bearer          | yes for session | no          | ADR-0013 append response                        |
| `GET /api/v1/sync/documents/{id}/changes`             | Session or dev bearer          | no              | no          | ADR-0013 pull response                          |

Endpoint notes:

- Registration is only for an unauthenticated browser. Both registration
  endpoints return `409 already_authenticated` when a valid session is present;
  use credential addition instead. An invalid or expired session cookie on a
  public options request is ignored and cleared.
- Sign-in replaces the session presented by the browser, if any. Other sessions
  for the old account remain valid unless the user chooses logout-all.
- Step-up keeps the session token. It updates recent-auth time and returns the
  remaining recent-auth window. It does not rotate the session.
- Adding a credential keeps existing sessions. Removing any credential revokes
  all sessions for the account, including the current session, and clears the
  cookie. A lost remove response therefore requires sign-in with a remaining
  credential.
- Removing the last credential returns `409 last_credential`. Adding beyond 20
  credentials returns `409 credential_limit`.
- `GET /api/v1/sync/document` is never cookie-authenticated. Session mode
  returns `405` with `Allow: POST`.
- Session mode returns `405` for `OPTIONS`; it has no CORS preflight. Dev bearer
  mode keeps ADR-0014's preflight contract.
- `POST /api/v1/sync/document` has no body and no query. It provisions or reads
  the one document for the session owner. Concurrent calls return the winner.
- The two changes routes keep ADR-0013's methods and semantics. Session mode
  adds the session cookie and CSRF header to append. Dev bearer mode keeps the
  bearer header and no cookies.
- `GET /api/v1/auth/session` with no cookie returns `200 {"session":null}`. An
  invalid, expired, revoked, duplicate, or malformed cookie returns `401` and
  clears the cookie.
- Logout with no valid session clears the cookie and returns `204` without a
  CSRF check. Logout with a valid session requires the CSRF token. Logout-all
  with no valid session returns `401`.

### Response bodies

The session object has exactly these fields:

```json
{
  "session": {
    "account": {
      "handle": "<base64url 32 bytes>",
      "display_name": "<1 to 80 characters>"
    },
    "expires_at": 1760000000000,
    "idle_expires_at": 1760001800000,
    "recent_auth": true,
    "recent_auth_expires_at": 1760000300000,
    "csrf_token": "<base64url 32 bytes>"
  }
}
```

`expires_at`, `idle_expires_at`, and `recent_auth_expires_at` are nonnegative
safe-integer epoch milliseconds. `recent_auth` is false when the recent-auth
window has passed; `recent_auth_expires_at` remains the time of the last
assertion plus five minutes. Registration and sign-in verify return the same
`session` object with a new cookie. Step-up returns
`{"recent_auth":true,"recent_auth_expires_at":<epoch milliseconds>}` without a
new session cookie.

The credential list body is:

```json
{
  "credentials": [
    {
      "id": "<base64url credential id>",
      "created_at": 1760000000000,
      "last_used_at": 1760000100000,
      "backup_eligible": true,
      "backup_state": true
    }
  ]
}
```

The added credential response is `{"credential":{...}}` with the same metadata
shape. No response contains a public key, an AAGUID, an attestation object, a
user handle beyond the account's own handle, a session digest, or a PRF result.

Every error body is exactly `{"error":{"code":"CODE"}}`. `429` adds the
`Retry-After` response header. `405` adds `Allow`. No error body echoes a
credential, challenge, cookie, header, database message, or planner value.

## Rejection order

Session mode evaluates a request in this order. The first matching failure wins.

1. Mode and configuration gate: `404`.
2. Origin: state-changing request requires exactly one `Origin` equal to
   `AUTH_ORIGIN`; a safe GET with an Origin header must match. Failure is `403`.
3. Route existence: `404`.
4. Method: known route, wrong method, `405` with `Allow`. Session mode has no
   `OPTIONS` preflight.
5. Session resolution: reject any `Authorization` header with `400
   malformed_request`; require exactly one syntactically valid session cookie,
   matching digest, not revoked, absolute and idle expiry valid. Failure is
   `401`.
6. CSRF: required state-changing route, exactly one valid `X-CSRF-Token`.
   Failure is `403`.
7. Recent auth: sensitive route, fresh enough assertion. Failure is `403`.
8. Media type and body: `415`, `413`, duplicate-key or shape `400`.
9. Coarse and challenge-specific rate limits: `429`.
10. Challenge or ceremony validation and the operation: generic `401`, `409`,
    or the success shape.
11. Storage or unexpected failure: redacted `503`.

Public options and verify endpoints have no session step. They apply the mode,
Origin, route, method, media, size, rate, challenge, and ceremony checks. Login
and registration verify use the browser binding instead of a CSRF token.

Dev bearer mode keeps ADR-0014's existing order exactly: environment and URL
gate, Origin, route, preflight, bearer, method, owned resource, media type, size
and syntax, semantic validation, operation.

The client sends `Sec-Fetch-Site: same-origin` where the browser supplies it. If
the header is present and is not `same-origin` or `none`, the request fails
`403`. It is defense in depth, not the CSRF check.

## Errors

| Status | Code                      | Condition                                                                                     | Client action                                      |
| ------ | ------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 400    | `malformed_request`       | Invalid JSON, shape, key, base64url, ID, query, header count, or algorithm                    | Fix the request; do not retry unchanged            |
| 401    | `unauthorized`            | Missing, duplicate, malformed, expired, or revoked session; wrong auth mode                   | Treat as signed out; refresh session or sign in    |
| 401    | `authentication_failed`   | Challenge, binding, ceremony, signature, handle, counter, or attestation verification failed  | Start a new options ceremony                       |
| 403    | `origin_forbidden`        | Missing, duplicate, or mismatched Origin, or a cross-site fetch metadata value                | Stop; fix the origin or client                     |
| 403    | `csrf_forbidden`          | Missing, duplicate, or mismatched CSRF token on a cookie-authenticated state-changing request | Refresh session status and retry once              |
| 403    | `recent_auth_required`    | Sensitive route needs a fresh assertion                                                       | Run step-up, then retry the operation              |
| 404    | `not_found`               | Disabled mode, unknown route, or missing or foreign document or credential                    | Stop; never auto-rebind or create a fallback owner |
| 405    | `method_not_allowed`      | Known route with an unsupported method                                                        | Use the route's `Allow` methods                    |
| 409    | `already_authenticated`   | Registration requested while a valid session exists                                           | Use credential addition instead                    |
| 409    | `credential_conflict`     | Credential ID already exists or belongs to another account                                    | Do not attach or reassign it                       |
| 409    | `credential_limit`        | Account already has 20 credentials                                                            | Remove one after recent auth                       |
| 409    | `last_credential`         | Removal would leave no credential                                                             | Add another passkey first                          |
| 413    | `request_too_large`       | Auth body exceeds 32 KiB, or an existing sync limit is exceeded                               | Split or fix the request                           |
| 415    | `unsupported_media_type`  | Non-JSON auth request or non-identity content encoding                                        | Fix the headers                                    |
| 429    | `rate_limited`            | A fixed window or outstanding challenge cap is exceeded                                       | Wait for `Retry-After`, then retry                 |
| 503    | `temporarily_unavailable` | D1, rate-limit, session, or unexpected server failure                                         | Retry with bounded backoff; never bypass security  |

Session mode does not send `WWW-Authenticate`. Dev bearer mode keeps ADR-0014's
`WWW-Authenticate: Bearer` response. An unexpected exception maps to the
redacted `503` shape; raw messages, SQL, stack traces, and bound values never
cross the HTTP boundary.

## Sessions, cookies, CSRF, and expiry

### Constants

| Constant                 | Value                   |
| ------------------------ | ----------------------- |
| Session token            | 32 random bytes         |
| Session token format     | 43 base64url characters |
| Stored session value     | SHA-256 digest only     |
| Absolute lifetime        | 12 hours                |
| Idle lifetime            | 30 minutes              |
| Last-seen write interval | 60 seconds              |
| Recent-auth window       | 5 minutes               |
| CSRF token               | 32 random bytes         |
| Recovery bypass          | none                    |

### Cookies

```http
Set-Cookie: __Host-tanikun_session=<43 base64url>; Secure; HttpOnly; SameSite=Lax; Path=/
Set-Cookie: __Host-tanikun_binding=<43 base64url>; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400
```

Both cookies have no Domain and no `Partitioned` attribute. The session cookie
has no Max-Age. Deletion uses the same name, Path, Secure, HttpOnly, and
SameSite values with `Max-Age=0`. The binding cookie is not authentication; it
only binds a challenge to the browser that requested it.

`SameSite=Lax` is intentional and is not the CSRF contract. Lax permits the
cookie on a top-level navigation to the app. State-changing requests are still
protected by the exact Origin, the JSON content type, the CSRF token, and the
challenge binding.

### CSRF and login protection

- The CSRF token is returned in the session status and authentication response
  body. The client keeps it in memory only. It is never a cookie, a URL value, or
  a local-storage value.
- State-changing cookie-authenticated requests require exactly one
  `X-CSRF-Token` header. The server compares its digest with the session row in
  constant time.
- Logout requires the token. A request with no valid session returns `204` and
  clears the cookie without requiring a token. A valid session without a token
  returns `403`.
- Login and registration verification do not use a session CSRF token. They
  require the exact Origin, JSON content type, and the one-time browser binding.
  An attacker cannot make the victim's browser send the attacker's binding
  cookie because it is HttpOnly and host-bound. An attacker's own assertion
  cannot authenticate the victim.
- Registration in a valid session returns `409 already_authenticated`, so a
  login CSRF cannot silently create a second session for an existing account.
- `GET` is read-only. The session status, credential list, and pull routes do
  not mutate state. Provisioning is `POST` in session mode.

### Session lifecycle

| Event                   | Session row result                                       | Cookie result                   |
| ----------------------- | -------------------------------------------------------- | ------------------------------- |
| Registration verify     | Insert a new session in the account creation transaction | Set new session and binding     |
| Sign-in verify          | Revoke the presented session, insert a new session       | Set a new session               |
| Step-up verify          | Keep the session, update recent-auth time                | No new session cookie           |
| Current logout          | Set `revoked_at` on the presented session                | Clear                           |
| Logout-all              | Set `revoked_at` on every account session                | Clear                           |
| Credential removal      | Set `revoked_at` on every account session                | Clear                           |
| Absolute or idle expiry | Reject; cleanup may mark the row later                   | Clear on the next auth response |
| Session storage failure | `503`; no anonymous fallback                             | No change                       |

A request that has already passed session admission may complete after a
concurrent revocation. Revocation prevents new admissions; it does not cancel
in-flight work. Auth mutations recheck the session in the same D1 batch as the
mutation. Sync append uses the principal resolved at admission and keeps
ADR-0013's retry semantics. This race window is explicit.

Session rows contain only:

| Field             | Meaning                                                              |
| ----------------- | -------------------------------------------------------------------- |
| `digest`          | SHA-256 of the session token; primary key                            |
| `user_id`         | Account owner                                                        |
| `csrf_digest`     | SHA-256 of the CSRF token                                            |
| `created_at`      | Sign-in time                                                         |
| `last_seen_at`    | Last authenticated request, written at most once per minute          |
| `expires_at`      | Absolute expiry, created time plus 12 hours                          |
| `idle_expires_at` | Last seen time plus 30 minutes                                       |
| `recent_auth_at`  | Last successful assertion for this session                           |
| `revoked_at`      | Nullable revocation time                                             |
| `revoke_reason`   | Bounded enum such as `logout`, `logout_all`, or `credential_removed` |

The table never stores a raw session token, a raw CSRF token, a challenge, a
credential response, or planner data.

The client serializes sign-in, sign-out, account switch, and step-up with local
locks and aborts background sync first. If a step-up response is lost, the
session remains valid and the recent-auth window may already be raised; retry
the sensitive operation or refresh session status. If a registration or sign-in
response is lost, do not retry the same challenge. Read session status. If a
valid new session is already present, continue. Otherwise start a new ceremony.
Any orphaned session expires.

## Provisioning and sync authorization

| Operation              | Session mode principal                    | Dev bearer mode principal              |
| ---------------------- | ----------------------------------------- | -------------------------------------- |
| Bootstrap              | `POST`; owner from session; CSRF required | `GET`; owner from exact bearer mapping |
| Append                 | `POST`; owner from session; CSRF required | `POST`; owner from bearer              |
| Pull                   | `GET`; owner from session                 | `GET`; owner from bearer               |
| Foreign or missing doc | `404 not_found` after authentication      | `404 not_found` after authentication   |
| Caller owner field     | None; ignored or rejected as malformed    | None; never supported                  |

The session owner is the internal owner ID. The server never accepts a
`user_id`, `owner_id`, `account_handle`, or document owner from an auth request.
The document is always server-generated.

`POST /api/v1/sync/document` is idempotent:

- Insert the document with `ON CONFLICT(owner_id) DO NOTHING`.
- Read the winner on the primary in the same transaction.
- Return the winner's `document_id` and current `last_seq`.
- If the session's user row is missing, fail `503`; do not create an
  unauthenticated user.

The old `GET` bootstrap remains for dev bearer only. It is not a cookie-
authenticated write. A browser with a bound document must not call bootstrap
after a `404` from append or pull; it stops and retains local data.

### Browser transport selection

The browser selects one transport from explicit configuration. It does not
infer session mode from a missing token, and it does not fall back to a dev
bearer.

| Mode         | Configuration                                   | Requests                                                                                   |
| ------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `dev_bearer` | Absolute API origin and nonempty bearer token   | `credentials: "omit"`, `Authorization: Bearer`, GET bootstrap, ADR-0013 preflight and CORS |
| `session`    | Same-origin app; no token in page configuration | `credentials: "same-origin"`, no `Authorization`, POST bootstrap, CSRF header on writes    |

In session mode, the shell first reads `GET /api/v1/auth/session`. It keeps the
CSRF token in memory and uses the session account and document binding. Before
bootstrap and at the start of each sync, the coordinator reads session status
and compares the returned handle with the bound account. A mismatch or `401`
aborts with `account_changed` or `reauth_required`; it never binds the returned
document. A missing or invalid session shows sign-in or `reauth_required`; it
never creates a coordinator with a dev token. The current `sync-shell`
configuration that requires `apiOrigin` plus `token` is therefore split into two
explicit modes, not extended with a cookie fallback.

### Transaction and response-loss matrix

| Operation           | Commit sequence                                                                        | Before commit                                      | After commit, response lost                                                                               |
| ------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Registration verify | Consume and verify first; insert user, credential, document, and session in one batch  | No user, credential, document, or session row      | Check session status; if valid, continue; otherwise sign in with the passkey. Do not reuse the challenge. |
| Bootstrap           | Insert document on owner conflict and read the winner                                  | `503`; no partial document                         | Retry the same `POST`; it returns the same document                                                       |
| Sign-in verify      | Revoke the presented session, conditionally update the counter, insert the new session | Old session remains; challenge is already consumed | Check session status; if valid, continue; otherwise start a new sign-in ceremony.                         |
| Step-up verify      | Update recent-auth time                                                                | Recent auth unchanged; challenge is consumed       | Recent auth may be raised; retry the sensitive operation                                                  |
| Add credential      | Insert the credential after challenge consumption and verification                     | No credential row                                  | Check the credential list; do not reuse the challenge                                                     |
| Remove credential   | Delete the credential and revoke all account sessions                                  | No deletion and no revocation                      | Removed; next request is `401`; sign in with a remaining passkey                                          |
| Append              | ADR-0013's single D1 batch                                                             | No sequence consumed                               | Retry the exact saved envelopes                                                                           |

Challenge consumption is intentionally outside the final account transaction.
A verification failure or a later transaction failure burns the challenge. This
is the safe choice against replay. The user starts a new ceremony, and the
client must not retry the same challenge.

If the final transaction fails after the authenticator created a credential, the
server has no user, credential, document, or session row. The authenticator may
still hold a passkey for the RP. The user retries with new options and may
remove the orphaned passkey in the provider. The server never attaches an
orphaned credential later.

A duplicate credential ID maps to `409 credential_conflict`. A handle,
document-owner, or session-digest collision maps to `503`. A failed counter
guard maps to `401`. No failed batch leaves a partial account, credential,
document, or session.

## Local state, account switch, and stale work

### Storage layout

The planner database stays `tanikun-planner`, version 1, store `documents`. The
planner record format stays `storageVersion: 2`.

| Data            | Key or scope, session mode                                  | Dev bearer mode                       |
| --------------- | ----------------------------------------------------------- | ------------------------------------- |
| Unbound plan    | `planner`                                                   | `planner`                             |
| Account plan    | `account:<handle>:planner`                                  | not used                              |
| Auth state      | `auth:state`                                                | not used                              |
| Metadata        | `sync:` + `JSON.stringify([handle, apiOrigin, documentId])` | ADR-0013's `[apiOrigin, documentId]`  |
| Outbox and seen | handle, apiOrigin, and documentId joined by a vertical bar  | ADR-0013's `<apiOrigin>:<documentId>` |
| Sync Web Lock   | `tanikun-sync:<handle>:<apiOrigin>:<documentId>`            | ADR-0013's existing lock              |
| Auth Web Lock   | `tanikun-auth-v1`                                           | not used                              |
| Auth broadcast  | `tanikun-auth-v1`                                           | not used                              |

`auth:state` is `{"authVersion":1,"generation":"<128-bit base64url>","accountHandle":"<handle>"|null,"sessionState":"active"|"signed_out"|"reauth_required"}`.
It contains no session token, CSRF token, challenge, or credential response.
The account handle is public metadata, not a credential.

The new keys are a local compatibility decision. The wire protocol and the
Automerge source format do not change. Dev bearer mode keeps the Phase 4 keys
and scopes on its own browser origin. The session origin's IndexedDB is a
separate origin partition.

### Account switching matrix

| Event                         | Server session                  | Local auth state                          | Planner and sync state                                              |
| ----------------------------- | ------------------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| Signed out before first login | none                            | `signed_out`, null handle                 | `planner` is unbound; no sync                                       |
| Sign in Alice                 | new Alice session               | new generation, Alice handle, `active`    | Alice keys created or reused; unbound plan not copied automatically |
| Import unbound plan           | Alice session                   | generation unchanged                      | Explicit copy to Alice key; no upload until explicit consent        |
| Switch Alice to Bob           | new Bob session                 | new generation, Bob handle, `active`      | Bob keys only; Alice keys untouched; in-flight Alice work fenced    |
| Logout Alice                  | presented Alice session revoked | new generation, null handle, `signed_out` | Alice plan remains stored but hidden; no sync                       |
| Session expiry or 401         | cannot authenticate             | generation unchanged, `reauth_required`   | Alice plan remains editable locally; sync paused; no fallback       |
| Last passkey lost             | no sign-in possible             | local state remains                       | Local plan remains; no server access or key recovery                |
| Dev bearer                    | no session                      | no auth state                             | Separate origin and Phase 4 keys                                    |

### Pre-login offline plans

A pre-login plan is saved at `planner`. It is never uploaded automatically. On
sign-in, the user can keep it separate or explicitly copy it to the new account.
An explicit copy is a local transaction, does not delete the unbound plan, and
sets a local pending-upload marker. The first upload still needs an explicit
confirmation. Import is offered only when the account has no local account plan;
if one exists, the unbound plan stays separate unless the user explicitly
exports or discards it.

If the account's server history has a different Automerge root, sync fails with
`history_mismatch`. The client preserves the unbound plan, the account plan, and
both cursors, and shows an explicit recovery choice. It never merges unrelated
roots automatically.

If the user declines the copy, the account starts from its own local and server
state. The unbound plan remains available while signed out. No dev plan, dev
account, or dev credential is ever imported into a real account.

### Stale save and sync fencing

- A local save checks the current `auth:state` generation and account handle in
  the same IndexedDB transaction that writes the planner. A mismatch aborts the
  save with `stale_account`; the edited text stays visible for copy or export.
- A sync operation captures the generation and account handle. It checks them
  before bootstrap, after bootstrap before binding the document, before pull,
  and again before applying a page or acknowledging a push. It also compares the
  session status handle with the bound account before bootstrap and at the start
  of each sync. A mismatch aborts without writing metadata or planner bytes.
- Sign-in, sign-out, and account switch acquire the auth lock, abort background
  sync, write a new generation, and announce it on `BroadcastChannel`. Other
  tabs re-read state and lock their editors. The IndexedDB generation check
  remains authoritative if the broadcast is unavailable.
- The existing planner compare-and-set still rejects a stale tab that races
  another save within the same account.
- An in-flight response that arrives after a switch is discarded. It cannot
  apply the old or new account's page to the wrong scope.

## Last passkey and account recovery

An account must keep at least one credential. The following are explicit:

- Removing the last credential returns `409 last_credential`.
- Adding a second passkey is supported after recent auth and CSRF.
- Removing a credential revokes all sessions, including the current one. A
  removed credential cannot authenticate.
- Adding or removing a credential requires recent authentication. A stolen
  session cookie cannot pass step-up after the five-minute window.
- If every passkey is lost, no Phase 5 path restores the account. There is no
  password, email link, recovery code, support override, or admin bypass.
- A new account gets a new server document. It is not linked to the old account
  or old document.
- Authentication does not recover a document key. Phase 6 owns encryption and
  key transfer. Phase 7 owns backup and recovery UX.
- The UI must state the all-passkeys-lost limitation and the last-credential
  rule before registration and in account settings.

A synced passkey is not a guarantee of recovery: the provider account, the
device, and the synchronization service can all be lost. The contract does not
claim otherwise.

## Abuse limits

The limits are fixed values in this contract. Changing them requires a contract
update and tests. D1 is the authoritative counter store. The trusted client
address is the Cloudflare-supplied `CF-Connecting-IP` on a request that also has
Cloudflare `request.cf` metadata. `X-Forwarded-For`, `Forwarded`, `X-Real-IP`,
and request-body values are never trusted. If the trusted address is absent,
requests share an `unknown` bucket. Bucket keys are keyed digests, not raw
addresses.

| Class                    | Key             | Limit | Window |
| ------------------------ | --------------- | ----- | ------ |
| Challenge issue          | Browser binding | 5     | 10 min |
| Challenge issue          | Trusted address | 30    | 10 min |
| Registration verify      | Trusted address | 10    | 1 hour |
| Registration verify      | Browser binding | 5     | 10 min |
| Sign-in verify           | Trusted address | 60    | 10 min |
| Sign-in verify           | Browser binding | 10    | 10 min |
| Sign-in verify           | Credential      | 10    | 10 min |
| Step-up verify           | Session         | 10    | 10 min |
| Credential add or remove | Account         | 10    | 1 hour |
| Logout-all               | Account         | 5     | 1 hour |
| Session status           | Session         | 120   | 1 min  |
| Sync request             | Session         | 120   | 1 min  |

Rules:

- Limits apply before cryptographic verification and before expensive parsing
  where the key is available.
- A blocked request returns `429` with `Retry-After` seconds and the exact error
  body. It does not reveal whether an account, credential, or challenge exists.
- The per-binding challenge cap is three. A fourth options request returns `429`
  until the oldest unconsumed challenge expires. Expired rows are unusable and
  are cleaned opportunistically.
- Rate-limit rows are deleted after the window plus one hour. Cleanup is not
  required for enforcement.
- A counter, challenge, or session storage failure returns `503`; it never
  bypasses a check.
- Each rate-limit counter is a fixed-window row keyed by
  `(bucket_key, window_start)` with a count and an expiry. Increments use one
  conditional upsert on the D1 primary.
- Cloudflare per-location rate limits may be added as coarse defense. They are
  not described as a globally exact quota, and they do not replace D1 checks.
- No Durable Object, new service, or new framework is introduced by this policy.

## PRF and authenticator verification allowlist

Phase 5 does not request the `prf` extension, require PRF support, or use it for
login, recovery, or encryption. PRF support is never a condition for
registration or sign-in. [Issue #186](https://github.com/beso1225/tanikun/issues/186)
evaluates physical providers separately. It uses disposable credentials and
synthetic inputs, records observed, failed, and untested cells separately, and
never sends PRF output to the server. The operator can assist with a Mac and an
iPhone, normally with 1Password; iCloud registration is also possible; a
Chrome-managed credential is uncertain. No physical result is claimed here.

### Client serialization

The browser must build the request from the exact fields below. It must not call
`credential.toJSON()`, use object spread on the credential or response, use
`JSON.stringify(credential)`, or pass `clientExtensionResults` through.

Registration verification body:

```json
{
  "challenge_id": "<base64url 16 bytes>",
  "credential": {
    "id": "<base64url credential id>",
    "rawId": "<same base64url bytes>",
    "type": "public-key",
    "response": {
      "clientDataJSON": "<base64url>",
      "attestationObject": "<base64url>"
    }
  }
}
```

Assertion verification body:

```json
{
  "challenge_id": "<base64url 16 bytes>",
  "credential": {
    "id": "<base64url credential id>",
    "rawId": "<same base64url bytes>",
    "type": "public-key",
    "response": {
      "clientDataJSON": "<base64url>",
      "authenticatorData": "<base64url>",
      "signature": "<base64url>",
      "userHandle": "<base64url account handle>"
    }
  }
}
```

Allowlist rules:

- Top-level keys are exactly `challenge_id` and `credential`.
- Credential keys are exactly `id`, `rawId`, `type`, and `response`.
- Registration response keys are exactly `clientDataJSON` and
  `attestationObject`.
- Assertion response keys are `clientDataJSON`, `authenticatorData`,
  `signature`, and optional `userHandle`; no other keys are allowed.
  `userHandle` is a base64url string or null. It is required and non-null for
  discoverable sign-in. It may be absent or null for step-up; when present and
  non-null it must match the session account.
- `type` is exactly `public-key`. `id` and `rawId` decode to the same bytes.
- Unknown keys at any depth, duplicate keys, mixed registration and assertion
  fields, and non-base64url values are rejected with `400 malformed_request`.
- `clientExtensionResults` is never an allowed key. A client that sends it gets
  `400 malformed_request`, not a silently ignored field.
- `authenticatorAttachment`, `transports`, `getPublicKey`,
  `getPublicKeyAlgorithm`, and any `prf` field are not allowed.
- The server never echoes a received credential field in an error, log, metric,
  or trace. It never stores the assertion or attestation object after
  verification.

### PRF leakage tests

Each implementation issue that touches the auth client or verifier adds these
tests with its code, not only at closeout:

1. A synthetic credential with a unique PRF canary in
   `clientExtensionResults.prf.results.first` is passed through the production
   serializer. The serialized body contains no `clientExtensionResults`, no
   `prf`, and no canary.
2. The production Worker receives a superset body with the canary. It returns
   `400 malformed_request`; the response body, headers, Worker log, retained
   trace archive, and failure log contain no canary.
3. A positive control with exactly the allowlisted fields still verifies. This
   proves that rejecting extras did not remove a required verification input.
4. The retained evidence test covers the same canary in the sync browser
   harness. No raw trace, request body, or header containing the canary is
   uploaded.

The tests use synthetic bytes only. They never persist real PRF output or a
hash of it.

## Deployment gates and phase boundaries

| Phase | Boundary                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------- |
| 5     | Local passkey auth, sessions, CSRF, ownership, and fictional planner tests only                |
| 6     | Encryption, document keys, device enrollment, key transfer, and authenticated key distribution |
| 7     | Backup, snapshot, restore, and key-loss recovery UX                                            |
| 8     | Production deployment, public origin, operations, and telemetry                                |

Until Phase 6 and Phase 8 review:

- Session mode is local and test only.
- `none` envelopes remain local-development data only.
- No public plaintext sync, sharing, membership, or account recovery is enabled.
- No production D1, public Worker, or public origin is provisioned.
- No claim of end-to-end encryption or cryptographic blindness is made.
- No PRF or document-key recovery claim is made.

The default, preview, and production deployment checks reject session mode, dev
auth, dev mappings, test document IDs, and public plaintext sync settings. The
check runs before deployment, in addition to the request-time `404` gate.

## Threat and test matrix

| Threat                                     | Contract control                                                               | Test owner       |
| ------------------------------------------ | ------------------------------------------------------------------------------ | ---------------- |
| Phishing origin or wrong RP ID             | Exact Origin and RP ID, client data check, RP ID hash check                    | #179, #185       |
| Challenge replay or concurrent verify      | Atomic conditional consumption, one-time purpose and binding                   | #178, #179, #185 |
| Cross-browser challenge theft              | HttpOnly `__Host-` binding cookie digest in the challenge row                  | #179, #180, #185 |
| Account enumeration                        | Discoverable-only sign-in, generic verify failures, no username lookup         | #179, #185       |
| Session theft or token in JavaScript       | Opaque digest-only server row, HttpOnly cookie, no token in JSON or storage    | #180, #185       |
| Session fixation                           | Server-generated token at sign-in, old presented session revoked               | #180, #185       |
| Login CSRF                                 | Browser-bound challenge, exact Origin, JSON, no existing-session registration  | #180, #185       |
| Logout or bootstrap CSRF                   | CSRF token, exact Origin, POST-only provisioning                               | #180, #182, #185 |
| Foreign document or credential             | Owner-scoped queries, indistinguishable `404`                                  | #178, #182, #185 |
| Dev fallback after failed real session     | Mutually exclusive modes, no anonymous or header owner, fail closed            | #180, #182, #185 |
| Account switch leaks planner or outbox     | Account-scoped keys, generation fencing, pull-before-push                      | #183, #185       |
| Stale tab saves after switch               | Generation check in the save transaction, auth broadcast, CAS                  | #183, #185       |
| Pre-login plan lost or uploaded silently   | Unbound key retained, explicit copy, explicit first upload, root mismatch stop | #183, #185       |
| Last credential removed                    | `409 last_credential`, all-session revocation on any removal                   | #184, #185       |
| All passkeys lost                          | No recovery bypass; limitation stated; no account linking                      | #184, #187       |
| PRF output reaches the network or evidence | Exact client projection, strict server allowlist, canary absence tests         | #179, #185, #186 |
| Abuse or unbounded challenge rows          | D1 fixed windows, per-binding cap, expiry, `429` and `Retry-After`             | #181, #185       |
| Storage outage or misconfiguration         | `503` or `404` fail closed; no security bypass                                 | #180, #181, #185 |
| Response loss                              | Idempotent bootstrap, one-time challenge, documented re-ceremony behavior      | #179, #180, #185 |
| Backup-eligible zero or reset counter      | Backup-aware counter policy, no strict positivity requirement                  | #179, #185       |

## Implementation issues and acceptance mapping

Implementation order follows the issue dependencies. Do not implement or close
these issues from this contract.

| Issue                                                  | Work                                                      | Depends on                          |
| ------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------- |
| [#176](https://github.com/beso1225/tanikun/issues/176) | Prove a WebAuthn verifier in the pinned Workers runtime   | none; currently pending             |
| [#178](https://github.com/beso1225/tanikun/issues/178) | D1 storage for passkeys, challenges, sessions, and limits | #177, #176 evidence                 |
| [#179](https://github.com/beso1225/tanikun/issues/179) | Registration and authentication ceremonies                | #177, #178, #176 evidence           |
| [#180](https://github.com/beso1225/tanikun/issues/180) | Opaque cookie sessions, CSRF, and revocation              | #177, #178                          |
| [#181](https://github.com/beso1225/tanikun/issues/181) | Abuse limits and safe diagnostics                         | #177, #179, #180                    |
| [#182](https://github.com/beso1225/tanikun/issues/182) | Session identity in sync and preserved dev gate           | #177, #179, #180, #181              |
| [#183](https://github.com/beso1225/tanikun/issues/183) | Sign-in UI and local account isolation                    | #177, #179, #180, #182              |
| [#184](https://github.com/beso1225/tanikun/issues/184) | Passkey management and account-access loss handling       | #177, #179, #180, #181, #183        |
| [#185](https://github.com/beso1225/tanikun/issues/185) | Real session sync and authorization proof in Linux CI     | #179, #180, #181, #182, #183, #184  |
| [#186](https://github.com/beso1225/tanikun/issues/186) | Physical-device PRF evaluation                            | #177; independent of the auth chain |
| [#187](https://github.com/beso1225/tanikun/issues/187) | Evidence and milestone closeout, later                    | all above; closeout only            |

| #177 acceptance criterion                                                            | Contract section                                               | Proof owner            |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ---------------------- |
| RP ID, origins, topology, local HTTPS, handles, UV, attestation, counters, challenge | RP ID and origins; Accounts; Ceremonies                        | #178, #179, #185       |
| Endpoints, rejection order, provisioning transactions, errors, session lifetime      | Endpoints; Rejection order; Sessions                           | #179, #180, #182, #185 |
| Cookie attributes, CSRF and Origin, login and logout, provisioning GET, rate limits  | Sessions; Provisioning; Abuse limits                           | #180, #181, #182, #185 |
| Account switch, local plans and outboxes, last passkey, no bypass                    | Local state; Last passkey                                      | #183, #184, #185       |
| Auth recovery separated from key recovery, gates, threat matrix                      | Last passkey; Deployment gates; Threat matrix                  | #184, #185, #187       |
| Verification allowlist and PRF absence                                               | PRF and allowlist                                              | #179, #185, #186       |
| Implementation links and current doc indexes                                         | This page; [docs index](README.md); [ADR index](adr/README.md) | #187                   |

## Inputs pending #176

These decisions remain provisional until #176 records its runtime evidence:

1. The selected server verifier library and exact version.
2. Whether ES256 verification works in the pinned Workers runtime; if not, the
   final algorithm allowlist and fallback.
3. The verifier's exact output fields for counter, backup eligibility, backup
   state, user presence, user verification, origin, RP ID, and credential type.
4. Whether the verifier accepts the exact allowlisted JSON without
   `clientExtensionResults`, `transports`, or `authenticatorAttachment`, and
   whether it needs `response.userHandle` for discoverable assertions.
5. The verifier's dependencies on Node built-ins, CBOR, Web Crypto, bundle size,
   CPU time, and remaining Workers limits.
6. The maximum registration and assertion payload sizes the verifier accepts,
   and whether the 32 KiB auth bound is sufficient.
7. The exact expected-origin and RP-ID option names, and whether the verifier
   accepts one value only.
8. Whether a browser helper library is needed or native option parsing and
   explicit projection are sufficient. The allowlist does not change either way.

The local TLS, cookie, WebAuthn, and CI mechanics belong to #185, not #176. The
physical-provider matrix and its untested cells belong to #186.

## References

Primary sources were checked on 2026-11-12. Version-specific conclusions remain
provisional.

- W3C, [Web Authentication: An API for accessing Public Key Credentials Level 3](https://www.w3.org/TR/2026/REC-webauthn-3-20260825/),
  Recommendation, 25 August 2026. See
  [RP ID and registration](https://www.w3.org/TR/webauthn-3/#sctn-registering-a-new-credential),
  [assertion verification](https://www.w3.org/TR/webauthn-3/#sctn-verifying-assertion),
  [signature counter](https://www.w3.org/TR/webauthn-3/#sctn-sign-counter),
  [credential backup state](https://www.w3.org/TR/webauthn-3/#sctn-credential-backup),
  [user handle privacy](https://www.w3.org/TR/webauthn-3/#sctn-user-handle-privacy),
  [credential loss and key mobility](https://www.w3.org/TR/webauthn-3/#sctn-credential-loss-key-mobility),
  [PRF extension](https://www.w3.org/TR/webauthn-3/#prf-extension), and
  [virtual authenticators](https://www.w3.org/TR/webauthn-3/#sctn-automation-virtual-authenticators).
- SimpleWebAuthn, [@simplewebauthn/server 14.1.x](https://simplewebauthn.dev/docs/packages/server),
  accessed 2026-11-12. The documentation is library guidance, not a Tanikun
  runtime proof.
- SimpleWebAuthn, [@simplewebauthn/browser 14.1.x](https://simplewebauthn.dev/docs/packages/browser),
  accessed 2026-11-12.
- SimpleWebAuthn, [PRF](https://simplewebauthn.dev/docs/advanced/prf), accessed
  2026-11-12.
- MDN, [Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie),
  accessed 2026-11-12. See cookie prefixes, Secure, and HttpOnly.
- MDN, [Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts),
  accessed 2026-11-12.
- Cloudflare, [Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/),
  last updated 2026-10-28, accessed 2026-11-12. See `CF-Connecting-IP`.
- Cloudflare, [D1 Database batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch),
  last updated 2026-06-22, accessed 2026-11-12.
