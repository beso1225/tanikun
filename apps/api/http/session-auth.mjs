import { AuthStorageError } from "../repositories/auth-data.mjs";
import {
  assertSessionOrigin,
  createSessionAdmission,
} from "../session/admission.mjs";
import {
  appendSetCookies,
  bindingCookie,
  clearSessionCookie,
  parseCookieHeader,
  sessionCookie,
} from "../session/cookies.mjs";
import { readSessionAuthConfig } from "../webauthn/config.mjs";
import { decodeSessionToken } from "../webauthn/session-material.mjs";
import { AUTH_BODY_MAX_BYTES } from "../webauthn/wire.mjs";
import { AUTH_ROUTES } from "./auth-routes.mjs";
import { ApiError } from "./errors.mjs";
import { parseJson, readBodyBytes, readJsonBody } from "./json.mjs";
import { emptyResponse, jsonResponse } from "./respond.mjs";
import {
  authErrorResponse,
  assertJsonRequest,
  dispatchWebAuthnRequest,
} from "./webauthn.mjs";

function sessionBody(session, csrfToken) {
  return {
    session: {
      account: {
        handle: session.account.handle,
        display_name: session.account.displayName,
      },
      expires_at: session.expiresAt,
      idle_expires_at: session.idleExpiresAt,
      recent_auth: session.recentAuth,
      recent_auth_expires_at: session.recentAuthExpiresAt,
      csrf_token: csrfToken,
    },
  };
}

function storageFailure(error) {
  return error?.code === undefined || error?.code === "temporarily_unavailable";
}

async function readEmptyBody(request) {
  const bytes = await readBodyBytes(request, AUTH_BODY_MAX_BYTES);
  if (bytes.byteLength === 0) return;
  assertJsonRequest(request);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ApiError("malformed_request");
  }
  let body;
  try {
    body = parseJson(text);
  } catch {
    throw new ApiError("malformed_request");
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 0
  )
    throw new ApiError("malformed_request");
}

async function dispatch(request, env, dependencies, state) {
  const config = readSessionAuthConfig(env);
  if (!config) throw new ApiError("not_found");

  // Rejection order is fixed by docs/PHASE_5.md: mode gate, Origin, route,
  // method, session, CSRF, recent auth, media/body, challenge/operation,
  // storage. Origin is checked before route existence on purpose.
  assertSessionOrigin(request, config);

  const url = new URL(request.url);
  const route = AUTH_ROUTES[url.pathname];
  if (!route) throw new ApiError("not_found");
  if (!route.methods.includes(request.method))
    throw new ApiError("method_not_allowed", { allow: route.allow });

  if (request.headers.get("Authorization") !== null)
    throw new ApiError("malformed_request");

  const admission = createSessionAdmission({
    db: env.DB,
    ...(dependencies.repository ? { repository: dependencies.repository } : {}),
    ...(dependencies.now ? { now: dependencies.now } : {}),
    ...(dependencies.newBinding ? { newBinding: dependencies.newBinding } : {}),
  });
  const cookies = parseCookieHeader(request);
  const presented = await admission.readPresentedSession({
    cookies,
    touch: route.touch,
  });
  const session = presented.kind === "valid" ? presented.session : null;
  state.invalidSession = presented.kind === "invalid" && presented.present;

  if (route.session === "required" && !session) {
    throw new AuthStorageError("unauthorized");
  }
  if (route.session === "optional" && !session) {
    if (presented.kind === "invalid")
      throw new AuthStorageError("unauthorized");
    if (url.search !== "" || request.body !== null)
      throw new ApiError("malformed_request");
    return {
      response: jsonResponse(200, { session: null }),
      setCookies: [],
    };
  }
  if (route.session === "logout" && !session) {
    return {
      response: emptyResponse(204),
      setCookies: [clearSessionCookie()],
    };
  }

  if (route.csrf && session) {
    await admission.verifyCsrf({
      session,
      csrfToken: presented.csrfToken,
      headerValue: request.headers.get("X-CSRF-Token"),
    });
  }
  if (route.recent && session && !session.recentAuth)
    throw new AuthStorageError("recent_auth_required");

  if (url.search !== "") throw new ApiError("malformed_request");

  let body = null;
  if (route.body === "json") {
    assertJsonRequest(request);
    body = await readJsonBody(request, AUTH_BODY_MAX_BYTES);
  } else if (route.body === "empty") {
    await readEmptyBody(request);
  } else if (request.body !== null) {
    throw new ApiError("malformed_request");
  }

  // Registration never accepts a valid presented session. This check runs
  // before binding minting so a browser with a session receives 409 even if
  // its binding cookie is absent or malformed.
  if (
    session &&
    (route.id === "registration_options" || route.id === "registration_verify")
  )
    throw new ApiError("already_authenticated");

  let binding = null;
  if (route.binding === "options") {
    binding = await admission.readBinding(cookies, { mode: "options" });
  } else if (route.binding === "verify") {
    binding = await admission.readBinding(cookies, { mode: "verify" });
  }

  if (route.kind === "session") {
    if (route.id === "session_status") {
      return {
        response: jsonResponse(200, sessionBody(session, presented.csrfToken)),
        setCookies: [],
      };
    }
    if (route.id === "logout") {
      await admission.auth.revokeSession({
        sessionDigest: session.digest,
        csrfDigest: session.csrfDigest,
        reason: "logout",
      });
      return {
        response: emptyResponse(204),
        setCookies: [clearSessionCookie()],
      };
    }
    if (route.id === "logout_all") {
      await admission.auth.revokeAllSessionsForSession({
        sessionDigest: session.digest,
        userId: session.userId,
        csrfDigest: session.csrfDigest,
        reason: "logout_all",
      });
      return {
        response: emptyResponse(204),
        setCookies: [clearSessionCookie()],
      };
    }
    throw new ApiError("not_found");
  }

  const result = await dispatchWebAuthnRequest({
    env,
    config,
    route,
    body,
    context: {
      bindingDigest: binding.digest,
      session,
      csrfVerified: route.csrf,
    },
    dependencies,
  });

  const setCookies = [];
  if (binding.minted && result.response.status === 200)
    setCookies.push(bindingCookie(binding.token));
  if (result.handoff?.kind === "session") {
    // Validate the server-only handoff before it becomes a header. The raw
    // token never enters JSON, a URL, a log, or the handoff response body.
    decodeSessionToken(result.handoff.token, "temporarily_unavailable");
    setCookies.push(sessionCookie(result.handoff.token));
  } else if (state.invalidSession) {
    setCookies.push(clearSessionCookie());
  }
  return { response: result.response, setCookies };
}

// #180 internal boundary. It is not imported by the default Worker bridge.
// #181 must wrap this handler with D1 fixed-window abuse limits and #182 must
// route session identity into sync before any production registration. Tests
// exercise it with the real WebAuthn service and D1; a request header or body
// can never supply `bindingDigest`, `session`, or `csrfVerified`.
export async function handleSessionAuthRequest(
  request,
  env,
  dependencies = {},
) {
  const state = { invalidSession: false };
  try {
    const result = await dispatch(request, env, dependencies, state);
    return appendSetCookies(result.response, result.setCookies);
  } catch (error) {
    const response = authErrorResponse(error);
    if (!storageFailure(error) && state.invalidSession)
      return appendSetCookies(response, [clearSessionCookie()]);
    return response;
  }
}
