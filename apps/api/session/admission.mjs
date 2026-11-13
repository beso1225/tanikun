// Reusable Phase 5 session admission. #180 uses this for its auth routes; #182
// must use the same guard for session-authenticated sync bootstrap, append, and
// pull so invalid or revoked sessions never fall back to dev bearer identity.
//
// Timing contract: a request that has passed admission may complete after a
// concurrent revocation. Revocation prevents new admissions and auth mutations
// recheck the session (and recent auth where required) in the same D1 batch as
// their final write. Sync append keeps the principal resolved here, matching
// ADR-0013 retry semantics.
import { createConfiguredAuthRateLimiter } from "../rate-limits/limiter.mjs";
import { AUTH_ROUTE_RATE_LIMIT_POLICIES } from "../rate-limits/policy.mjs";
import {
  AuthStorageError,
  decodeBase64Url,
  encodeBase64Url,
  randomBytes,
} from "../repositories/auth-data.mjs";
import { createAuthRepository } from "../repositories/auth.mjs";
import {
  constantTimeEqual,
  decodeSessionToken,
  deriveCsrfToken,
  sha256,
} from "../webauthn/session-material.mjs";
import {
  BINDING_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  cookieValues,
  parseCookieHeader,
} from "./cookies.mjs";

const CSRF_HEADER = "X-CSRF-Token";
const CANONICAL_TOKEN = /^[A-Za-z0-9_-]{43}$/u;

export function assertSessionOrigin(request, config) {
  if (!config || config.mode !== "session")
    throw new AuthStorageError("not_found");
  const origin = request.headers.get("Origin");
  if (
    request.method === "GET" ||
    request.method === "HEAD" ||
    request.method === "OPTIONS"
  ) {
    if (origin !== null && origin !== config.origin)
      throw new AuthStorageError("origin_forbidden");
  } else if (origin !== config.origin) {
    throw new AuthStorageError("origin_forbidden");
  }

  // Defense in depth, not the CSRF contract. Browsers send this header; a
  // cross-site or cross-origin value is rejected even when Origin is forged.
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none")
    throw new AuthStorageError("origin_forbidden");
}

function bindingError(mode) {
  return new AuthStorageError(
    mode === "options" ? "malformed_request" : "authentication_failed",
  );
}

function decodeBinding(value) {
  const bytes = decodeBase64Url(value, "authentication_failed");
  if (bytes.length !== 32) throw new Error("invalid binding");
  return bytes;
}

async function verifyCsrf({ session, csrfToken, headerValue }) {
  if (headerValue === null || !CANONICAL_TOKEN.test(headerValue))
    throw new AuthStorageError("csrf_forbidden");
  let supplied;
  try {
    supplied = decodeSessionToken(headerValue, "csrf_forbidden");
  } catch {
    throw new AuthStorageError("csrf_forbidden");
  }
  if (!constantTimeEqual(await sha256(supplied), session.csrfDigest))
    throw new AuthStorageError("csrf_forbidden");

  // The row digest is authoritative, and the derived token is what session
  // status returns after reload. Check both so a stale or inconsistent row
  // cannot authorize a mutation.
  let derived;
  try {
    derived = decodeBase64Url(csrfToken, "csrf_forbidden");
  } catch {
    throw new AuthStorageError("csrf_forbidden");
  }
  if (!constantTimeEqual(supplied, derived))
    throw new AuthStorageError("csrf_forbidden");
}

// Fixed-window admission needs the binding digest before the full verify
// rejection path. This read never mints and never throws for an absent or
// malformed cookie; the route's real binding check still owns that 401.
export async function readBindingForRate(cookies) {
  if (cookies.malformed) return null;
  const values = cookieValues(cookies, BINDING_COOKIE_NAME);
  if (values.length !== 1) return null;
  try {
    return { digest: await sha256(decodeBinding(values[0])) };
  } catch {
    return null;
  }
}

export function createSessionAdmission({
  db,
  repository,
  now,
  newBinding = () => randomBytes(32),
} = {}) {
  if (!repository && !db) throw new AuthStorageError("temporarily_unavailable");
  const clock = now ?? Date.now;
  const auth = repository ?? createAuthRepository(db, { now: clock });

  async function readPresentedSession({ cookies, touch = true }) {
    if (cookies.malformed) return { kind: "invalid", present: true };
    const values = cookieValues(cookies, SESSION_COOKIE_NAME);
    if (values.length === 0) return { kind: "absent", present: false };
    if (values.length !== 1) return { kind: "invalid", present: true };

    let tokenBytes;
    try {
      tokenBytes = decodeSessionToken(values[0]);
    } catch {
      return { kind: "invalid", present: true };
    }
    const digest = await sha256(tokenBytes);
    const session = await auth.resolveSession(digest, { touch });
    if (!session) return { kind: "invalid", present: true };

    const csrfBytes = await deriveCsrfToken(tokenBytes);
    if (!constantTimeEqual(await sha256(csrfBytes), session.csrfDigest))
      return { kind: "invalid", present: true };
    return {
      kind: "valid",
      present: true,
      session,
      tokenBytes,
      csrfToken: encodeBase64Url(csrfBytes),
    };
  }

  async function readBinding(cookies, { mode }) {
    if (cookies.malformed) throw bindingError(mode);
    const values = cookieValues(cookies, BINDING_COOKIE_NAME);
    if (values.length > 1) throw bindingError(mode);
    if (values.length === 1) {
      try {
        const bytes = decodeBinding(values[0]);
        return {
          digest: await sha256(bytes),
          token: values[0],
          minted: false,
        };
      } catch {
        if (mode === "verify") throw bindingError(mode);
      }
    }

    if (mode === "verify") throw bindingError(mode);
    const bytes = newBinding();
    if (!(bytes instanceof Uint8Array) || bytes.length !== 32)
      throw new AuthStorageError("temporarily_unavailable");
    return {
      digest: await sha256(bytes),
      token: encodeBase64Url(bytes),
      minted: true,
    };
  }

  // #182 handoff: exact Origin, a required active session, the canonical CSRF
  // header, and optional recent auth without exposing a weaker helper. Body and
  // query validation stay with the owning route.
  async function admitRequest(
    request,
    config,
    { csrf = true, recent = false, touch = true } = {},
  ) {
    assertSessionOrigin(request, config);
    if (request.headers.get("Authorization") !== null)
      throw new AuthStorageError("malformed_request");
    const cookies = parseCookieHeader(request);
    const presented = await readPresentedSession({ cookies, touch });
    if (presented.kind !== "valid") throw new AuthStorageError("unauthorized");
    if (csrf)
      await verifyCsrf({
        session: presented.session,
        csrfToken: presented.csrfToken,
        headerValue: request.headers.get(CSRF_HEADER),
      });
    if (recent && !presented.session.recentAuth)
      throw new AuthStorageError("recent_auth_required");
    return { ...presented, cookies };
  }

  // Apply only after route-owned media/body validation. The combined helper
  // below remains useful to callers with no body work.
  async function enforceSessionSyncRate(request, env, admitted) {
    if (!db) throw new AuthStorageError("temporarily_unavailable");
    const limiter = await createConfiguredAuthRateLimiter({
      db,
      request,
      env,
      now: clock,
    });
    const policies = AUTH_ROUTE_RATE_LIMIT_POLICIES.sync_request;
    await limiter.enforce(policies, {
      session: admitted.session.digest,
      account: admitted.session.userId,
    });
  }

  async function admitSessionSync(request, config, env, { csrf = true } = {}) {
    const admitted = await admitRequest(request, config, {
      csrf,
      recent: false,
      touch: true,
    });
    await enforceSessionSyncRate(request, env, admitted);
    return admitted;
  }

  return {
    auth,
    admitRequest,
    admitSessionSync,
    enforceSessionSyncRate,
    readBinding,
    readBindingForRate,
    readPresentedSession,
    verifyCsrf,
  };
}
