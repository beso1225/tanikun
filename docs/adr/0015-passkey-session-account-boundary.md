# Use passkey accounts and opaque cookie sessions at one HTTPS origin

## Status

proposed

This is the draft decision for [issue #177](https://github.com/beso1225/tanikun/issues/177).
The [issue #176](https://github.com/beso1225/tanikun/issues/176) verifier spike
merged in `6bc6535` and selected `@simplewebauthn/server@14.1.0`. The required
main CI gate
[43262536319](https://github.com/beso1225/tanikun/actions/runs/43262536319)
succeeded at that merge SHA. ADR-0015 becomes current after final review.
[ADR-0014](0014-local-development-auth.md) remains the current local-bearer
contract; ADR-0015 replaces only its deferred
real-identity boundary, not the separate dev-bearer mode. This proposal adds no
production route, migration, or deployment. The endpoint, state, error, and
test matrices are in [docs/PHASE_5.md](../PHASE_5.md).

## Context

Phase 4 has one owner and one server-generated document per authenticated
principal. [ADR-0013](0013-http-sync-protocol.md) owns the opaque change log and
its wire contract. [ADR-0014](0014-local-development-auth.md) provides a local
bearer mapping and rejects every non-local sync request. The browser planner
record is shared, while outbox and metadata are scoped by API origin and
document. A real identity cannot replace the resolver safely until the contract
defines origin topology, account handles, one-time challenges, sessions, CSRF,
provisioning, local account switching, abuse limits, and authenticator
serialization. This decision defines those boundaries.

## Decision

Use passkey-only accounts, discoverable credentials with required user
verification, server-owned opaque user handles, one-time browser-bound
challenges, and opaque cookie sessions with an explicit CSRF token. Serve the
web app and auth API from one HTTPS origin. Keep the Phase 4 bearer mode as a
separate local test mode. Partition local planner state by account and fence
stale work with an account generation. Do not use WebAuthn PRF in the Phase 5
authentication flow.

### Origin and credentials

- The local and CI origin is `https://localhost:4300`, and the RP ID is
  `localhost`. A loopback TLS terminator serves the app and forwards `/api`.
- Production uses one configured HTTPS origin whose host equals the RP ID. No
  production origin is enabled or committed in Phase 5.
- No wildcard origin, parent-domain RP ID, IP literal, alias origin,
  related-origin request, or iframe ceremony is accepted.
- The Worker verifies the configured origin and RP ID, not a forwarded host or
  internal request URL.
- `AUTH_MODE` is exactly `dev_bearer` or `session`; the modes are mutually
  exclusive and an absent or ambiguous value fails closed. The Phase 4
  dev-bearer mode keeps its exact origins `http://127.0.0.1:4300` and
  `http://127.0.0.1:8787`, CORS, `credentials: "omit"`, and bearer header.
  Session mode is same-origin, sends no CORS credentials, and rejects an
  `Authorization` header.
- `localhost` is the Mac or CI loopback origin. An iPhone browser's
  `localhost` is the iPhone. The supported iPhone role is a hybrid or roaming
  authenticator for the Mac-origin ceremony, not a direct iPhone-browser page.
  A direct iPhone-browser cell needs a separately approved origin, RP ID, and
  certificate path; no tunnel or silent RP ID change is allowed. #186 records
  an unavailable cell as untested or blocked.

### Accounts and credentials

- An account is the authentication principal, not the planner
  `AcademicProfile`.
- The internal owner ID stays server-owned. The public WebAuthn user handle is
  32 random bytes encoded as base64url, unique, immutable, and non-PII.
- Registration inserts the user, credential, document, and session in one D1
  batch. No user row exists before verified registration.
- Real account IDs use a distinct opaque namespace. Dev account IDs are never
  linked or migrated.
- Credentials store a public key, counter, backup eligibility, backup state,
  and owner. They never store a private key, attestation chain, provider
  identity, or PRF result.
- Registration and sign-in use discoverable credentials. User presence and user
  verification are required.
- The selected verifier is `@simplewebauthn/server@14.1.0`. ES256 registration
  and assertion verification were proved in source workerd `1.20261019.1` and
  packaged workerd `1.20261012.1`, without `nodejs_compat`. The Nix API bundle
  is 683,804 bytes. Packed self-attestation in the spike is synthetic and is not
  a real-provider interoperability proof.
- Registration requests `attestation: "none"`, and the server accepts only
  `fmt: "none"` with an empty attestation statement. It parses the attestation
  object with the library's `decodeAttestationObject` before verification and
  rejects every other format with a generic `401`. It does not initialize
  metadata services and performs no MDS, CRL, OCSP, or HTTP verification. It
  adds no hand-written CBOR or WebAuthn cryptography.
- Backup eligibility is immutable and signed. Store it from registration. On
  every assertion, compare `credentialDeviceType`; a change fails
  authentication. Reject backup state 1 with backup eligibility 0.
- For a non-backup-eligible credential, pass the stored counter to the library
  and keep its strict check. A stored positive counter followed by a new zero
  counter is rejected, as is any new positive counter less than or equal to a
  stored positive counter.
- For a backup-eligible credential, pass `counter: 0` to the library to suppress
  its single-device check, then accept the assertion and store
  `max(stored, newCounter)`. This is an explicit normalized input for signed
  multi-device credentials, not a claim that the library accepts resets.
- Counters are clone-detection aids, not replay protection. Challenge
  consumption is replay protection.

### Challenges and sessions

- Every ceremony uses a one-time challenge with a 300-second lifetime, a
  purpose, and a digest of the `__Host-tanikun_binding` cookie. The raw
  challenge is never stored.
- Verification passes the library's `expectedChallenge` callback, which decodes
  and hashes the submitted challenge and compares the digest in constant time.
  It passes exact single origin and RP ID strings, requires user presence and
  user verification, and checks `crossOrigin` false and `topOrigin` absent
  before the registration verifier, which does not check those fields itself.
- One conditional database update consumes the challenge. Concurrent requests
  cannot both succeed. A failed verification burns the challenge.
- Session tokens are 32 random bytes. Only their SHA-256 digests are stored.
- The session cookie is `__Host-tanikun_session`, with `Secure`, `HttpOnly`,
  `SameSite=Lax`, `Path=/`, no Domain, and no Max-Age.
- Sessions have a 12-hour absolute lifetime and a 30-minute idle lifetime.
  Last-seen time is written at most once per minute.
- Sign-in rotates the session and revokes the presented session. Registration
  creates a new session. Step-up does not rotate. It only raises recent auth to
  avoid response-loss and in-flight failures.
- Every cookie-authenticated state-changing request requires an
  `X-CSRF-Token` header. Login and registration use the browser-bound challenge
  and exact Origin instead. SameSite is not the CSRF contract.
- The CSRF token is HMAC-SHA-256 of `tanikun-csrf-v1`, keyed by the decoded
  session token. D1 stores only its digest. Session status derives the same
  token from the HttpOnly cookie after reload; rotation creates a new token.
  GET routes may update session and rate-limit bookkeeping, but never provision
  resources or change account, credential, document, or planner content.
- Current logout revokes the presented session. Logout-all, credential addition,
  and credential removal require recent auth. Logout-all and credential removal
  revoke all sessions for the account.
- Invalid, expired, or revoked sessions return `401` and never fall back to a
  dev bearer, anonymous account, or caller-supplied owner.

### Provisioning and sync

- Session mode provisions with `POST /api/v1/sync/document`, with a valid
  session and CSRF token. The response shape is unchanged.
- The old `GET /api/v1/sync/document` remains only in dev-bearer mode. It is not
  a cookie-authenticated write.
- Pull and append keep ADR-0013's envelope, sequence, idempotency, limits,
  cursor, and error contract. Append adds session auth and CSRF.
- The owner always comes from the session. Foreign and missing documents remain
  indistinguishable `404 not_found`.

### Local state

- The wire protocol does not change.
- The unbound pre-login plan stays at `planner`. A real account plan uses
  `account:<handle>:planner`.
- Outbox, seen, metadata, and sync locks include the account handle, origin, and
  document. Dev mode keeps the Phase 4 keys on its own origin.
- `auth:state` stores an account generation, the current handle, and a local
  session state. It never stores a session token or CSRF token.
- A save checks the generation in the same IndexedDB transaction as the plan
  write. Sync checks it before bootstrap, before pull, and before applying a
  page. It also confirms the session account handle with the server before
  bootstrap and at the start of each sync.
- Sign-in, sign-out, and account switch increment the generation and announce
  it across tabs. The IndexedDB check remains authoritative.
- A pre-login plan is never uploaded automatically. The user explicitly copies
  it and explicitly allows the first upload.
- If the server history has a different Automerge root, sync stops with
  `history_mismatch` and preserves both histories.
- Dev plans and accounts are never imported into real accounts.

### Recovery and abuse

- An account must keep at least one credential. Removing the last one returns
  `409 last_credential`.
- Losing every passkey means losing account access. Phase 5 has no password,
  email, recovery-code, support, or admin bypass.
- A new account is not linked to an old document. Authentication recovery and
  document-key recovery are separate.
- Rate limits are D1-backed fixed windows. They use `CF-Connecting-IP` only, and
  never trust `X-Forwarded-For` or another client-controlled address header.
- D1 is authoritative. Cloudflare per-location limits may be coarse defense,
  but they are not a globally exact quota.
- A rate-limit or session storage failure returns `503`; it never bypasses a
  check.
- Logs never contain bodies, headers, cookies, tokens, CSRF values, challenge
  values, credential IDs, assertions, user handles, PRF output, or planner
  content.

### PRF

- Phase 5 does not request, require, or use PRF. PRF support is not a signup
  requirement.
- [Issue #186](https://github.com/beso1225/tanikun/issues/186) evaluates physical
  providers separately with disposable credentials and synthetic inputs. An
  unsupported result is valid spike completion.
- Generic `credential.toJSON()`, `JSON.stringify(credential)`, object spread, or
  `clientExtensionResults` pass-through is forbidden. PRF output can be attached
  to a legitimate assertion.
- The browser projects only the allowlisted verification fields. The server
  rejects unknown fields. Tests use a synthetic PRF canary and assert its
  absence from requests, logs, traces, and evidence.

### Gates

- Session mode is local and test only until Phase 6 encryption and Phase 8
  deployment review.
- Default, preview, and production configurations reject session mode,
  `DEV_AUTH=true`, dev mappings, test document IDs, and public plaintext sync.
- A missing, incomplete, or ambiguous mode returns `404` before routing or D1.
- Phase 5 does not enable public plaintext sync, sharing, account recovery,
  E2EE, backups, or production deployment.

## Consequences

- The production web and API must share one origin. A separate API hostname
  needs a later decision.
- Passkey-only accounts have no self-service recovery when every passkey is
  lost. The UI must state this before registration.
- Backup-eligible credentials weaken clone detection because their counters can
  repeat or reset.
- Account-scoped local storage needs a migration and explicit import flow.
- D1-backed limits add writes to authentication paths.
- An XSS or malicious delivered script can still act as the signed-in user even
  though it cannot read the HttpOnly session cookie.

## Alternatives

- A JWT in JavaScript storage: harder revocation and rotation, and a direct
  token-theft path.
- Username-first authentication: adds enumeration and does not use discoverable
  credentials.
- Cross-origin cookie sessions: complicates `__Host-`, SameSite, CSRF, and
  WebAuthn origin checks. Same-origin is the Phase 5 choice.
- Broader attestation-format allowlists: add privacy loss and provider lock-in
  without a Phase 5 authorization need. Phase 5 accepts only `none`.
- Strict counter enforcement for every credential: rejects legitimate
  multi-device resets. The contract normalizes only credentials whose signed
  backup-eligibility flag is 1.
- Step-up session rotation: adds response-loss and in-flight failures without
  fixing session fixation at sign-in.
- Generic credential serialization: can forward PRF output.

## References

The contract lists the primary sources and access dates. See also the merged
[#176 verifier spike](../PHASE_5_WEBAUTHN_SPIKE.md). The main sources are the
[W3C WebAuthn Level 3 Recommendation](https://www.w3.org/TR/2026/REC-webauthn-3-20260825/),
the [SimpleWebAuthn server documentation](https://simplewebauthn.dev/docs/packages/server),
[MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie),
and [Cloudflare's D1 batch contract](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
