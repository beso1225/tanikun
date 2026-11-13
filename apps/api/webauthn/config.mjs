import { decodeRateLimitKey } from "../rate-limits/limiter.mjs";

export const SESSION_AUTH_ORIGIN = "https://localhost:4300";
export const SESSION_RP_ID = "localhost";
export const SESSION_RP_NAME = "Tanikun";

// Session mode is deliberately local/test only in Phase 5. The origin and RP
// ID are configuration, never derived from a forwarded host or request URL.
// #180 owns cookies, CSRF, and Origin enforcement. #181 owns the fixed-window
// counter store and derives bucket keys from this deployment secret.
export function readSessionAuthConfig(env) {
  if (!env || env.AUTH_MODE !== "session") return null;
  if (env.APP_ENV !== "local" && env.APP_ENV !== "test") return null;
  if (env.DEV_AUTH !== undefined && env.DEV_AUTH !== "false") return null;
  if (env.DEV_AUTH_IDENTITIES !== undefined) return null;
  // The deterministic test-document hook is dev-bearer only. Session owners
  // always receive a server-generated document from registration or the
  // idempotent provisioning path.
  if (env.TEST_NEW_DOCUMENT_ID !== undefined) return null;
  if (env.AUTH_ORIGIN !== SESSION_AUTH_ORIGIN) return null;
  if (env.RP_ID !== SESSION_RP_ID) return null;
  try {
    decodeRateLimitKey(env.AUTH_RATE_LIMIT_KEY);
  } catch {
    return null;
  }
  return Object.freeze({
    mode: "session",
    origin: SESSION_AUTH_ORIGIN,
    rpID: SESSION_RP_ID,
    rpName: SESSION_RP_NAME,
  });
}
