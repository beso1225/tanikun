import { readSessionAuthConfig } from "../webauthn/config.mjs";
import { createAuthCeremonyService } from "../webauthn/service.mjs";
import {
  parseAuthenticationOptionsBody,
  parseRegistrationOptionsBody,
  AUTH_BODY_MAX_BYTES,
} from "../webauthn/wire.mjs";
import { ApiError } from "./errors.mjs";
import { readJsonBody } from "./json.mjs";
import { jsonResponse } from "./respond.mjs";

const routes = Object.freeze({
  "/api/v1/auth/register/options": "registration_options",
  "/api/v1/auth/register/verify": "registration_verify",
  "/api/v1/auth/sign-in/options": "sign_in_options",
  "/api/v1/auth/sign-in/verify": "sign_in_verify",
  "/api/v1/auth/step-up/options": "step_up_options",
  "/api/v1/auth/step-up/verify": "step_up_verify",
  "/api/v1/auth/credentials/options": "credential_add_options",
  "/api/v1/auth/credentials/verify": "credential_add_verify",
});

const statusByCode = Object.freeze({
  malformed_request: 400,
  authentication_failed: 401,
  unauthorized: 401,
  origin_forbidden: 403,
  csrf_forbidden: 403,
  recent_auth_required: 403,
  not_found: 404,
  method_not_allowed: 405,
  already_authenticated: 409,
  credential_conflict: 409,
  credential_limit: 409,
  last_credential: 409,
  request_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  temporarily_unavailable: 503,
});

function authErrorResponse(error) {
  const code =
    typeof error?.code === "string" && Object.hasOwn(statusByCode, error.code)
      ? error.code
      : "temporarily_unavailable";
  const headers = {};
  if (code === "method_not_allowed") headers.Allow = "POST";
  if (code === "rate_limited" && Number.isSafeInteger(error?.retryAfter))
    headers["Retry-After"] = String(error.retryAfter);
  return jsonResponse(statusByCode[code], { error: { code } }, headers);
}

function assertJsonRequest(request) {
  const contentType = request.headers.get("Content-Type");
  if (contentType === null) throw new ApiError("unsupported_media_type");
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json")
    throw new ApiError("unsupported_media_type");
}

function assertContext(context) {
  if (!context || typeof context !== "object")
    throw new ApiError("authentication_failed");
  if (!(context.bindingDigest instanceof Uint8Array))
    throw new ApiError("authentication_failed");
  return context;
}

function sessionFor(context) {
  const session = context.session;
  if (!session) throw new ApiError("unauthorized");
  return session;
}

async function dispatch(request, env, context, dependencies) {
  const config = readSessionAuthConfig(env);
  if (!config) throw new ApiError("not_found");
  const url = new URL(request.url);
  if (url.search !== "") throw new ApiError("malformed_request");
  const route = routes[url.pathname];
  if (!route) throw new ApiError("not_found");
  if (request.method !== "POST")
    throw new ApiError("method_not_allowed", { allow: "POST" });
  if (request.headers.get("Origin") !== config.origin)
    throw new ApiError("origin_forbidden");
  if (request.headers.get("Authorization") !== null)
    throw new ApiError("malformed_request");
  assertJsonRequest(request);

  const checkedContext = assertContext(context);
  const csrfRequired =
    route === "step_up_options" ||
    route === "step_up_verify" ||
    route === "credential_add_options" ||
    route === "credential_add_verify";
  if (csrfRequired && checkedContext.csrfVerified !== true)
    throw new ApiError("csrf_forbidden");
  const body = await readJsonBody(request, AUTH_BODY_MAX_BYTES);
  const service = createAuthCeremonyService({
    db: env.DB,
    config,
    ...dependencies,
  });

  if (route === "registration_options") {
    if (checkedContext.session) throw new ApiError("already_authenticated");
    const displayName = parseRegistrationOptionsBody(body);
    const result = await service.registrationOptions({
      bindingDigest: checkedContext.bindingDigest,
      displayName,
    });
    return { response: jsonResponse(200, result), handoff: null };
  }
  if (route === "registration_verify") {
    const result = await service.verifyRegistration({
      bindingDigest: checkedContext.bindingDigest,
      body,
      existingSession: checkedContext.session ?? null,
    });
    return {
      response: jsonResponse(200, result.body),
      handoff: result.handoff,
    };
  }
  if (route === "sign_in_options") {
    parseAuthenticationOptionsBody(body);
    const result = await service.signInOptions({
      bindingDigest: checkedContext.bindingDigest,
    });
    return { response: jsonResponse(200, result), handoff: null };
  }
  if (route === "sign_in_verify") {
    const result = await service.verifySignIn({
      bindingDigest: checkedContext.bindingDigest,
      body,
      presentedSession: checkedContext.session ?? null,
    });
    return {
      response: jsonResponse(200, result.body),
      handoff: result.handoff,
    };
  }
  if (route === "step_up_options") {
    parseAuthenticationOptionsBody(body);
    const result = await service.stepUpOptions({
      bindingDigest: checkedContext.bindingDigest,
      session: sessionFor(checkedContext),
    });
    return { response: jsonResponse(200, result), handoff: null };
  }
  if (route === "step_up_verify") {
    const result = await service.verifyStepUp({
      bindingDigest: checkedContext.bindingDigest,
      body,
      session: sessionFor(checkedContext),
    });
    return {
      response: jsonResponse(200, result.body),
      handoff: result.handoff,
    };
  }
  if (route === "credential_add_options") {
    parseAuthenticationOptionsBody(body);
    const result = await service.addCredentialOptions({
      bindingDigest: checkedContext.bindingDigest,
      session: sessionFor(checkedContext),
    });
    return { response: jsonResponse(200, result), handoff: null };
  }
  const result = await service.verifyAddCredential({
    bindingDigest: checkedContext.bindingDigest,
    body,
    session: sessionFor(checkedContext),
  });
  return {
    response: jsonResponse(200, result.body),
    handoff: result.handoff,
  };
}

// This handler is intentionally not registered in the Worker bridge. #180
// must wrap it with cookie parsing/minting, session resolution, and CSRF
// verification, and #181 must add the rate limits, before a route can become
// reachable. The binding digest, resolved session, and csrfVerified flag are
// server-only context values; a request body can never supply them.
export async function handleWebAuthnRequest(
  request,
  env,
  context,
  dependencies = {},
) {
  try {
    return await dispatch(request, env, context, dependencies);
  } catch (error) {
    return { response: authErrorResponse(error), handoff: null };
  }
}
