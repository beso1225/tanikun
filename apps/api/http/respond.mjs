import { ALLOWED_ORIGIN } from "./auth.mjs";

const statusByCode = Object.freeze({
  malformed_request: 400,
  unauthorized: 401,
  origin_forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  change_conflict: 409,
  cursor_ahead: 409,
  log_gap: 409,
  request_too_large: 413,
  unsupported_media_type: 415,
  temporarily_unavailable: 503,
  sequence_exhausted: 503,
});

export function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export function emptyResponse(status, headers = {}) {
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export function errorResponse(error) {
  const code =
    typeof error?.code === "string" && Object.hasOwn(statusByCode, error.code)
      ? error.code
      : "temporarily_unavailable";
  const body = { error: { code } };
  if (
    (code === "cursor_ahead" || code === "log_gap") &&
    Number.isSafeInteger(error?.cursor)
  )
    body.cursor = error.cursor;
  const headers = {};
  if (code === "unauthorized") headers["WWW-Authenticate"] = "Bearer";
  if (code === "method_not_allowed" && typeof error?.allow === "string")
    headers.Allow = error.allow;
  return jsonResponse(statusByCode[code], body, headers);
}

// Apply the exact-Origin CORS result after every response, including gate and
// origin failures. A disallowed or missing Origin never receives an allow
// header, but every response is origin-dependent.
export function withCors(response, request) {
  const headers = new Headers(response.headers);
  const vary = headers.get("Vary");
  if (!vary) headers.set("Vary", "Origin");
  else if (!vary.split(/\s*,\s*/i).includes("Origin"))
    headers.set("Vary", `${vary}, Origin`);
  if (request.headers.get("Origin") === ALLOWED_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  } else {
    headers.delete("Access-Control-Allow-Origin");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
