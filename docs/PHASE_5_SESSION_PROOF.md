# Phase 5 real-session proof

## Status

This page records the implementation proof for
[#185](https://github.com/beso1225/tanikun/issues/185). It does not close Phase 5. [#187](https://github.com/beso1225/tanikun/issues/187) owns the final evidence
and milestone closeout. [#186](https://github.com/beso1225/tanikun/issues/186)
owns physical-device PRF evaluation, and
[#103](https://github.com/beso1225/tanikun/issues/103) owns spoken
screen-reader evidence.

The proof runs the production Worker, D1 migrations, same-origin HTTPS topology,
WebAuthn verifier, cookie session, CSRF check, Origin check, and browser client.
The passkeys come from Chromium's virtual authenticator. The accounts, planner
records, TLS certificate, and passkeys are synthetic. No public deployment,
production credential, or production origin is used.

## Bounded command

```sh
nix develop -c just test-session-proof
```

The recipe builds the source web and API artifacts unless both packaged roots
are set:

```sh
nix build path:.#web --out-link result-web
nix build path:.#api --out-link result-api
TANIKUN_WEB_DIST="$PWD/result-web" \
  TANIKUN_API_DIST="$PWD/result-api" \
  nix develop -c just test-session-proof
```

The same recipe runs in Linux CI against the Nix-built web and Worker artifacts.
It is separate from `just test-sync`, which is the Phase 4 dev-bearer convergence
and fault suite. The session recipe applies the production migrations to an
isolated temporary D1 directory, starts Wrangler on an ephemeral port, serves
the built page at `https://localhost:4300` with a disposable loopback
certificate, and drives Chromium. Each test owns its harness and closes the
browser, Worker process group, web server, and temporary persistence directory
in `t.after()`.

## Acceptance mapping

| Acceptance criterion                                                                                                           | Automated proof                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Bounded local and CI path, migrations, isolated storage, real origins and cookies, packaged artifacts, owned teardown          | `just test-session-proof`, `session-sync-packaged`, `webauthn-packaged`, `justfile.test.mjs` |
| Register and sign in with two accounts, second passkey, expiry, logout, revocation, invalid and replayed challenges            | `session-account-journey`, `session-credential-journey`, `session-auth-faults`               |
| Two Alice replicas over session HTTP, Bob read/write denial, account-switch outbox isolation, duplicate, response loss, reload | `session-replica-proof`, `session-account-proof`, `session-response-loss`                    |
| Cookie flags, CSRF and Origin rejection, no unauthorized account, document, credential, session, or change writes              | `session-auth-faults`, `session-account-proof`                                               |
| Sanitized failure evidence and owned cleanup                                                                                   | `session-failure-evidence`, `assertEvidenceSanitized`, `assertHarnessCleaned`                |
| Virtual-auth properties and physical limits documented                                                                         | This page                                                                                    |

### Replica and account boundary

`session-replica-proof.test.mjs` registers a fictional Alice in one Chromium
context, exports the virtual credential, imports it into a second isolated
context, and signs in through the real discoverable-credential endpoint. The
second replica discards its seeded local root through the production discard
API, pulls the server history, edits while the API is gated offline, reloads,
reconnects, and merges again. The test compares normalized planner sources and
Automerge heads, checks D1 sequence uniqueness, and retries a client-generated
envelope twice to prove idempotent append under the session cookie and CSRF
header.

`session-account-proof.test.mjs` registers Bob in a separate context and uses
Bob's real session and CSRF token to read and append to Alice's document. Both
requests return the indistinguishable `404 not_found`, and D1 counts and Alice's
committed planner bytes do not change. Bob's own queued outbox entry remains.

The same file switches from Alice to Bob while Alice has a pending outbox entry.
Bob's sync does not upload or delete Alice's change. After Alice signs in again,
the retained entry drains to Alice's document, not Bob's.

`session-response-loss.test.mjs` commits a browser push through the real Worker,
loses the response, keeps the exact envelope in Alice's session-scoped outbox,
and retries. The second response is identical, the D1 rows and sequences are
unchanged, and the outbox drains after the pull cursor advances.

### Authentication and authorization faults

`session-auth-faults.test.mjs` replays the captured registration verification
body after its one-time challenge was consumed and submits a tampered challenge
ID. It tests a wrong binding separately, before the original signed registration
request is sent: the unused challenge is rejected under a different binding,
then the identical signed request succeeds after restoring the original cookie.
Each rejected request returns the generic `401 authentication_failed`, sets no
session, and leaves user, credential, session, document, and change counts
unchanged.

The test inspects Chromium's cookie jar for both `__Host-` cookies. The session
cookie is `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, host-only, and has no
persistent expiry. The binding cookie has the same flags and a one-day lifetime.
Page script sees neither cookie.

The test sends a missing and a wrong CSRF header on a valid append and receives
`403 csrf_forbidden`. It sends an exact hostile Origin from the browser
context's own cookie jar and receives `403 origin_forbidden` on registration
options and on the same append. A valid CSRF header and Origin then appends the
same envelope, proving the rejected requests differed only in the security
headers. D1 changes and document sequences stay unchanged after each rejection.

Logout revokes the session row. Replaying the server-issued cookie after logout
returns `401 unauthorized` and clears the browser cookie. The test then forces
the D1 absolute and idle expiry into the past, reloads, observes the `401` status
response and `reauth_required` local state, confirms the cookie is gone, and
confirms the account planner remains locally readable with no new writes.

### Evidence and cleanup

`session-failure-evidence.test.mjs` fails a real session journey on purpose
after registration with an actual `assert.deepEqual` failure whose values
include planner text and a URL-safe token. The retained failure log and sanitized trace must not
contain the session token, CSRF token, credential ID, display name, or credential
response fields. The screenshot remains a human-readable UI capture and can show
fictional planner text and the account display name; automated absence checks
apply to logs and sanitized traces, not screenshot pixels. The test also checks
that the harness removes its process group and temporary storage. Journey
failure logs and trace error events keep a fixed error marker instead of
messages, actual/expected diffs, or stacks. URL-safe binary strings are also
covered by log redaction. Successful group logs retain only per-page error and
accepted-fault counts; neither fault text nor reasons are retained.

The new tests close their harness, then read every retained evidence file and
every sanitized trace entry. They assert the raw session token, CSRF token,
credential ID, challenge ID, planner canary, credential response field names,
PRF fields, and request header names are absent. The harness retains only
`trace.trace` and `trace.network` built from its allowlist. Raw traces stay in
the deleted temporary directory.

Cleanup assertions require the Worker process group to be gone, the temporary
persistence directory to be removed, the web server to be null, no context to
remain, the 4300 listener to be closed, and `cleanup.log` to report no problems.
CI uploads only logs and sanitized `*trace.zip` archives from
`.cache/verify/sync` on failure. Screenshots stay local because their pixels
can contain planner text; they are excluded from CI uploads.

## Virtual authenticator properties

Chromium's virtual authenticator is a synthetic CTAP2 authenticator. It
implements the browser WebAuthn API, resident credentials, user presence and
verification flags, and ES256 key generation. It produces real signatures over
the exact `clientDataJSON` and authenticator data. The production Worker and
`@simplewebauthn/server@14.1.0` verify the challenge digest, RP ID hash, origin,
ceremony type, signature, algorithms, flags, and credential shape through the
same code path used for a physical credential.

The test can therefore establish:

- The same-origin HTTPS page and RP ID topology is accepted by the browser and
  the production verifier.
- The server rejects replayed, expired, wrong-purpose, and wrong-binding
  challenges.
- Session cookies, CSRF, Origin, ownership, account scope, revocation, and idle
  and absolute expiry behave as the contract describes.
- Two browser replicas of one synthetic account can converge through real HTTP
  session requests and D1.

## Limits

The virtual authenticator does not establish:

- physical authenticator, platform biometric, secure-element, or hybrid
  transport behavior;
- a real passkey provider, provider sync, account recovery, or attestation
  interoperability;
- PRF behavior or any other extension result;
- spoken screen-reader output, assistive-technology behavior, or Safari
  behavior;
- production origin, public deployment, certificate issuance, OS trust-store
  behavior, or production abuse-limit behavior.

The test requests `attestation: "none"`, disables metadata services, and uses a
synthetic `none` attestation. The virtual authenticator reports user
verification, but that does not prove a physical biometric prompt. The
disposable certificate is trusted only by the harness context. Darwin results
are not a Linux CI result. The exact-head Linux required CI remains the merge
gate owned by the maintainer.

## References

- [Phase 5 authentication contract](PHASE_5.md)
- [ADR-0015: passkey sessions and account boundary](adr/0015-passkey-session-account-boundary.md)
- [D1 sync storage and harness](SYNC_STORAGE.md)
- [Phase 4 results](PHASE_4_RESULTS.md)
- [WebAuthn Level 3 virtual authenticators](https://www.w3.org/TR/webauthn-3/#sctn-automation-virtual-authenticators)

## Local results

These results were recorded on macOS arm64 on 2026-11-13.

| Command                                                          | Result                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------ |
| `just test-session-proof` with source artifacts                  | 20 tests, 17 passed, 3 packaged-only skipped                 |
| `just test-session-proof` with Nix `result-web` and `result-api` | 20 passed                                                    |
| `just test-sync` with source artifacts                           | 48 tests, 47 passed, 1 packaged-only skipped                 |
| `just test-sync` with Nix `result-web` and `result-api`          | 48 passed                                                    |
| `nix build path:.#web` and `path:.#api`                          | both built as self-contained artifacts                       |
| `nix flake check path:. -L`                                      | passed; omitted the incompatible x86_64-linux system locally |
| `just lint`                                                      | passed                                                       |

A controlled red check temporarily disabled the session Origin guard in
`apps/api/session/admission.mjs`. `session-auth-faults.test.mjs` failed with
`200 !== 403` at the hostile Origin assertion. Restoring the guard made the test
pass again. The production file is unchanged in the delivered diff.

This page does not claim Linux execution, Phase 5 completion, milestone closure,
or physical-device support.

After failure-evidence hardening on 2026-11-14, the packaged session proof
passed 20/20 and the packaged dev-bearer suite passed 50/50. The added
redaction and success-ledger regressions account for the extra dev-bearer
tests. The lifecycle suite passed 25/25 and `just lint` passed.
