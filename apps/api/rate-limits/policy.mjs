// Canonical Phase 5 abuse-limit policy. docs/PHASE_5.md owns the accepted
// table; this module is the only production owner of its numeric values.
//
// Scopes are server-owned values:
// - address: the Cloudflare-supplied client address, or the shared unknown
//   bucket when the trusted metadata is absent or malformed.
// - binding: SHA-256 of the __Host-tanikun_binding cookie value.
// - credential: the submitted canonical credential ID.
// - session: the SHA-256 session digest. Raw session tokens never reach this
//   module.
// - account: the internal server-owned user ID.
//
// Every bucket key is a keyed digest. A scope value is never stored raw.
const policy = (id, scope, limit, windowMs) =>
  Object.freeze({ id, scope, limit, windowMs });

export const AUTH_RATE_LIMIT_POLICIES = Object.freeze({
  challengeAddress: policy("challenge_address", "address", 30, 600_000),
  challengeBinding: policy("challenge_binding", "binding", 5, 600_000),
  registrationAddress: policy("registration_address", "address", 10, 3_600_000),
  registrationBinding: policy("registration_binding", "binding", 5, 600_000),
  signInAddress: policy("sign_in_address", "address", 60, 600_000),
  signInBinding: policy("sign_in_binding", "binding", 10, 600_000),
  signInCredential: policy("sign_in_credential", "credential", 10, 600_000),
  stepUpSession: policy("step_up_session", "session", 10, 600_000),
  credentialAccount: policy("credential_account", "account", 10, 3_600_000),
  logoutAllAccount: policy("logout_all_account", "account", 5, 3_600_000),
  sessionStatusSession: policy(
    "session_status_session",
    "session",
    120,
    60_000,
  ),
  syncSession: policy("sync_session", "session", 120, 60_000),
});

// The route IDs come from apps/api/http/auth-routes.mjs. A missing entry is a
// programming error, not an implicit exemption. The last three entries are
// handoffs: #182 owns sync integration and #184 owns credential list/remove.
export const AUTH_ROUTE_RATE_LIMIT_POLICIES = Object.freeze({
  registration_options: Object.freeze([
    AUTH_RATE_LIMIT_POLICIES.challengeAddress,
    AUTH_RATE_LIMIT_POLICIES.challengeBinding,
  ]),
  registration_verify: Object.freeze([
    AUTH_RATE_LIMIT_POLICIES.registrationAddress,
    AUTH_RATE_LIMIT_POLICIES.registrationBinding,
  ]),
  sign_in_options: Object.freeze([
    AUTH_RATE_LIMIT_POLICIES.challengeAddress,
    AUTH_RATE_LIMIT_POLICIES.challengeBinding,
  ]),
  sign_in_verify: Object.freeze([
    AUTH_RATE_LIMIT_POLICIES.signInAddress,
    AUTH_RATE_LIMIT_POLICIES.signInBinding,
    AUTH_RATE_LIMIT_POLICIES.signInCredential,
  ]),
  session_status: Object.freeze([
    AUTH_RATE_LIMIT_POLICIES.sessionStatusSession,
  ]),
  logout: Object.freeze([]),
  logout_all: Object.freeze([AUTH_RATE_LIMIT_POLICIES.logoutAllAccount]),
  step_up_options: Object.freeze([
    AUTH_RATE_LIMIT_POLICIES.challengeAddress,
    AUTH_RATE_LIMIT_POLICIES.challengeBinding,
  ]),
  step_up_verify: Object.freeze([AUTH_RATE_LIMIT_POLICIES.stepUpSession]),
  credential_add_options: Object.freeze([
    AUTH_RATE_LIMIT_POLICIES.challengeAddress,
    AUTH_RATE_LIMIT_POLICIES.challengeBinding,
    AUTH_RATE_LIMIT_POLICIES.credentialAccount,
  ]),
  credential_add_verify: Object.freeze([
    AUTH_RATE_LIMIT_POLICIES.credentialAccount,
  ]),
  credential_list: Object.freeze([]),
  credential_remove: Object.freeze([
    AUTH_RATE_LIMIT_POLICIES.credentialAccount,
  ]),
  sync_request: Object.freeze([AUTH_RATE_LIMIT_POLICIES.syncSession]),
});

// Enforcement rows live for one fixed window plus one hour. Cleanup is bounded
// and opportunistic; it is not part of the admission decision.
export const AUTH_RATE_LIMIT_STORAGE = Object.freeze({
  retentionMs: 3_600_000,
  cleanupBatch: 100,
});

export function rateLimitPoliciesForRoute(routeId) {
  return AUTH_ROUTE_RATE_LIMIT_POLICIES[routeId] ?? null;
}
