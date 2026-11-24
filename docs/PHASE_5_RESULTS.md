# Phase 5 implementation and verification

Phase 5 implements passkey authentication, cookie sessions, and account-scoped
planner sync for local and test use. [The Phase 5 contract](PHASE_5.md) and
[ADR-0015](adr/0015-passkey-session-account-boundary.md) define the boundary.
Public plaintext sync stays disabled pending encryption and deployment review.
Authentication grants access to an account. Document-key transfer and recovery
need their own design.

## Implementation evidence

| Contract area                                                                                                                                                  | Implementation                                                                                                                                                                                                                                                                                                                                           | Verification                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passkey registration and sign-in ([#179](https://github.com/beso1225/tanikun/issues/179))                                                                      | [WebAuthn service](../apps/api/webauthn/service.mjs) and [auth repository](../apps/api/repositories/auth.mjs) bind one-time challenges to their purpose and browser. Verification requires ES256/P-256 and user verification. Assertion finalization checks the credential and updates its counter with the session operation.                           | [Ceremonies](../apps/api/test/auth-ceremonies.test.mts), [adversarial cases](../apps/api/test/auth-ceremony-adversarial.test.mts), and [atomic finalization](../apps/api/test/auth-ceremony-atomic.test.mts).                                |
| Opaque sessions, CSRF, expiry, and revocation ([#178](https://github.com/beso1225/tanikun/issues/178), [#180](https://github.com/beso1225/tanikun/issues/180)) | [Auth migration](../apps/api/migrations/0002_auth_storage.sql), [session routes](../apps/api/http/session-auth.mjs), and [admission](../apps/api/session/admission.mjs) store session digests, set HttpOnly cookies, validate Origin and CSRF, and enforce idle and absolute expiry. Sign-in rotates the session. Logout and logout-all revoke sessions. | [Migration](../apps/api/test/auth-migration.test.mts), [session repository](../apps/api/test/auth-sessions.test.mts), and [HTTP boundary](../apps/api/test/auth-session-boundary.test.mts).                                                  |
| Abuse limits and safe diagnostics ([#181](https://github.com/beso1225/tanikun/issues/181))                                                                     | [Rate limiter](../apps/api/rate-limits/limiter.mjs) and [D1 migration](../apps/api/migrations/0003_auth_rate_limits.sql) implement fixed windows with opaque bucket keys, bounded errors, and `Retry-After`.                                                                                                                                             | [Rate-limit HTTP tests](../apps/api/test/auth-rate-limit-http.test.mts) and [policy and evidence](AUTH_ABUSE_LIMITS.md).                                                                                                                     |
| Sync ownership and deployment gates ([#182](https://github.com/beso1225/tanikun/issues/182))                                                                   | [API mode gate](../apps/api/http/api.mjs), [sync routes](../apps/api/http/sync.mjs), and [browser transport](../apps/web/public/sync-transport.js) use the session principal for document ownership. Session bootstrap uses POST with CSRF. Foreign and missing documents both return 404. Dev bearer remains an explicit local mode.                    | [Worker/D1 session authorization](../apps/api/test/worker-session-sync.test.mts), [transport](../tests/integration/sync-transport.test.mjs), and [deployment config check](../tests/integration/deployment-config.test.mjs).                 |
| Browser account isolation ([#183](https://github.com/beso1225/tanikun/issues/183))                                                                             | [Auth state](../apps/web/public/auth-state.js), [persistence](../apps/web/public/persistence.js), and [sync coordinator](../apps/web/public/sync-coordinator.js) scope planner state and sync by account. Generation checks fence stale work. Copying an unbound plan and first upload require separate consent.                                         | [Account persistence tests](../tests/integration/auth-persistence.test.mjs), [account fence tests](../tests/integration/sync-account-fence.test.mjs), and [session account journeys](../tests/integration/session-account-journey.test.mjs). |
| Credential lifecycle ([#184](https://github.com/beso1225/tanikun/issues/184))                                                                                  | [Session routes](../apps/api/http/session-auth.mjs) and [credential repository](../apps/api/repositories/auth.mjs) list credential metadata and require recent authentication to add or remove a passkey. Removal checks ownership, protects the last passkey, and revokes the account's sessions.                                                       | [Credential repository tests](../apps/api/test/auth-credentials.test.mts), [HTTP boundary tests](../apps/api/test/auth-session-boundary.test.mts), and [credential journey](../tests/integration/session-credential-journey.test.mjs).       |
| Real session sync ([#185](https://github.com/beso1225/tanikun/issues/185))                                                                                     | [Session proof recipe](../justfile) and [Linux CI](../.github/workflows/ci.yml) run the packaged browser and Worker over loopback HTTPS with local D1.                                                                                                                                                                                                   | [Real-session proof](PHASE_5_SESSION_PROOF.md) maps convergence, cross-account denial, cookie and CSRF behavior, response loss, sanitized evidence, and teardown to tests.                                                                   |

[#176](PHASE_5_WEBAUTHN_SPIKE.md) established the packaged verifier baseline.
The [sync protocol](adr/0013-http-sync-protocol.md) still governs the change log,
cursors, and retries. The [Phase 4 results](PHASE_4_RESULTS.md) retain the
separate dev-bearer baseline.

## Reproducible baseline

[Main CI run 45387662679](https://github.com/beso1225/tanikun/actions/runs/45387662679)
passed `lint` and `linux` on 2026-11-24 UTC at
`9c9e68a159be04f61e41f1afbfa7df07f5639c36` ([PR #201](https://github.com/beso1225/tanikun/pull/201)).
That revision pins the [Nix inputs](../flake.lock) and
[JavaScript dependencies](../pnpm-lock.yaml). The run used Node.js 24.22.1,
pnpm 12.9.0, Playwright Core 1.64.1, Wrangler 4.151.1, and SimpleWebAuthn Server
14.1.0.

The Linux runner built the `web`, `api`, and `release` Nix outputs, all version
0.1.0. The CI log identifies these derivations:

- `lf8c0npnd0y59cgc044l6w4yj700l86s-tanikun-web-0.1.0.drv`
- `wj7cm0y3bdq66diprn55qhzmyizqy2w3-tanikun-api-0.1.0.drv`
- `ili9j1k7g58i041y3yyxrdrybvb394gd-tanikun-release-0.1.0.drv`

CI passed the paired `result-web` and `result-api` outputs to both sync suites.

| Command in CI                                                                     | Observed result                                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `just lint`                                                                       | Passed, including the closed deployment config check.                                            |
| `nix flake check path:. --all-systems --no-build` and `nix flake check path:. -L` | Both supported systems evaluated. Native Linux checks passed, including packaged release checks. |
| `nix build path:.#web path:.#api --offline --rebuild --no-link`                   | Both artifacts rebuilt with fetching disabled.                                                   |
| `just test-d1`                                                                    | 314 tests passed in 20 files.                                                                    |
| `just test-browser-built`                                                         | 67 Chromium tests passed against the built page.                                                 |
| `just test-sync`                                                                  | 50 packaged dev-bearer tests passed.                                                             |
| `just test-session-proof`                                                         | 20 packaged session-proof tests passed.                                                          |
| `just test-prf-probe`                                                             | 27 synthetic probe tests passed, including nine browser tests.                                   |

The isolated [session verification instructions](PHASE_5_SESSION_PROOF.md#bounded-command)
show how to run the source and packaged commands.

## Observations and limits

- **Virtual authenticator.** Chromium drove the real browser cookie jar, local
  HTTPS, Worker, WebAuthn verifier, and D1. The authenticator, credentials,
  planner data, and TLS certificate were test fixtures. The packaged proof
  covered two replicas for the same account and rejected cross-account writes.
- **Physical PRF.** [Issue #186](https://github.com/beso1225/tanikun/issues/186)
  recorded five Mac configurations. Three completed the PRF comparisons.
  The Chrome 1Password extension returned an array in one configuration.
  Chrome with macOS AutoFill reported a registration/assertion mismatch on
  the support-check path and completed the comparisons on the opt-in
  registration-evaluation path. The probe recorded result types, lengths,
  comparison outcomes, and cleanup without exporting PRF bytes.
  [Physical results](PHASE_5_PRF_RESULTS.md) record exact versions and all
  observed cases. Hybrid authentication, direct iPhone ceremonies,
  cross-device equality, and hardware security keys remain unverified.
- **Accessibility.** Chromium tests cover keyboard and focus behavior and
  responsive layout. Spoken screen-reader verification for the requirement
  summary is tracked in [#103](https://github.com/beso1225/tanikun/issues/103).
- **Deployment and recovery.** Default, preview, and production configuration
  keep plaintext sync closed. Keep PRF adoption deferred while Phase 6 defines
  supported environments and document-key recovery. Losing every passkey leaves
  no account recovery route in Phase 5. Catalogue import and backup are
  outside this milestone.

## Closeout

At the baseline, [milestone 6](https://github.com/beso1225/tanikun/milestone/6)
had closed #176 through #186. [#187](https://github.com/beso1225/tanikun/issues/187)
tracks this evidence and the administrative closeout. After the reviewed
documentation PR merges, verify `lint` and `linux` on its exact `main` merge
commit, reconcile the issues, and close the milestone with zero open issues.
