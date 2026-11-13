// Read-only Phase 5 session handoff for the sync shell. The session cookie is
// HttpOnly; this client never sees it and never stores a session or CSRF token
// outside memory. #183 owns sign-in UI, account partitioning, and local state.
const SESSION_STATUS_KINDS = Object.freeze({
  SIGNED_OUT: "signed_out",
  ACTIVE: "active",
  REAUTH_REQUIRED: "reauth_required",
  UNAVAILABLE: "unavailable",
  MALFORMED: "malformed",
});

const TOKEN = /^[A-Za-z0-9_-]{43}$/u;

function statusBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (!Object.hasOwn(body, "session")) return null;
  return body.session;
}

function activeSession(session) {
  if (!session || typeof session !== "object" || Array.isArray(session))
    return null;
  const account = session.account;
  if (!account || typeof account !== "object" || Array.isArray(account))
    return null;
  if (
    typeof account.handle !== "string" ||
    !TOKEN.test(account.handle) ||
    typeof account.display_name !== "string" ||
    typeof session.csrf_token !== "string" ||
    !TOKEN.test(session.csrf_token)
  )
    return null;
  for (const field of ["expires_at", "idle_expires_at"])
    if (!Number.isSafeInteger(session[field]) || session[field] < 0)
      return null;
  return {
    account: {
      handle: account.handle,
      display_name: account.display_name,
    },
    expires_at: session.expires_at,
    idle_expires_at: session.idle_expires_at,
    recent_auth: session.recent_auth === true,
    recent_auth_expires_at: session.recent_auth_expires_at,
    csrf_token: session.csrf_token,
  };
}

export function createSessionStatusClient({
  fetch,
  baseUrl,
  timeoutMs = 15_000,
} = {}) {
  if (typeof fetch !== "function")
    throw new TypeError("fetch must be a function");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new TypeError("timeoutMs must be a positive integer");
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new TypeError("baseUrl must be an absolute HTTP URL");
  }
  if (base.protocol !== "http:" && base.protocol !== "https:")
    throw new TypeError("baseUrl must be an absolute HTTP URL");
  if (base.pathname !== "/" || base.search !== "" || base.hash !== "")
    throw new TypeError("baseUrl must not include a path, query, or fragment");

  let csrfToken = null;
  let account = null;

  function clear() {
    csrfToken = null;
    account = null;
  }

  async function read() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      try {
        response = await fetch(
          new URL("/api/v1/auth/session", base.origin).href,
          {
            method: "GET",
            cache: "no-store",
            credentials: "same-origin",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        );
      } catch {
        return { kind: SESSION_STATUS_KINDS.UNAVAILABLE, retryable: true };
      }
      if (response.status === 401) {
        clear();
        return { kind: SESSION_STATUS_KINDS.REAUTH_REQUIRED, retryable: false };
      }
      if (response.status >= 500)
        return { kind: SESSION_STATUS_KINDS.UNAVAILABLE, retryable: true };
      if (response.status !== 200)
        return { kind: SESSION_STATUS_KINDS.MALFORMED, retryable: false };
      let body;
      try {
        body = JSON.parse(await response.text());
      } catch {
        return { kind: SESSION_STATUS_KINDS.MALFORMED, retryable: false };
      }
      const session = statusBody(body);
      if (session === null) {
        clear();
        return { kind: SESSION_STATUS_KINDS.SIGNED_OUT, retryable: false };
      }
      const active = activeSession(session);
      if (!active) {
        clear();
        return { kind: SESSION_STATUS_KINDS.MALFORMED, retryable: false };
      }
      csrfToken = active.csrf_token;
      account = active.account;
      return {
        kind: SESSION_STATUS_KINDS.ACTIVE,
        retryable: false,
        session: {
          account: { ...active.account },
          expires_at: active.expires_at,
          idle_expires_at: active.idle_expires_at,
          recent_auth: active.recent_auth,
          recent_auth_expires_at: active.recent_auth_expires_at,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    clear,
    read,
    get csrfToken() {
      return csrfToken;
    },
    get account() {
      return account ? { ...account } : null;
    },
  });
}

export { SESSION_STATUS_KINDS };
