// Strict Phase 5 cookie transport. A Cookie header is a semicolon-separated
// list of name=value pairs. Cookie values never contain a comma, so a comma in
// the header means the runtime joined more than one Cookie header or the
// client sent an ambiguous value. Both fail closed. Duplicate names are kept
// as a list so each route can distinguish a duplicate session cookie
// (authentication failure) from a duplicate browser-binding cookie
// (malformed request on options, generic authentication failure on verify).
export const SESSION_COOKIE_NAME = "__Host-tanikun_session";
export const BINDING_COOKIE_NAME = "__Host-tanikun_binding";
export const BINDING_COOKIE_MAX_AGE_SECONDS = 86_400;

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
// RFC 6265 cookie-octet, including an empty value. Our own values are canonical
// 43-character base64url strings and are validated separately.
const COOKIE_VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/u;
const COOKIE_ATTRIBUTES = "Secure; HttpOnly; SameSite=Lax; Path=/";

function malformedJar() {
  return { malformed: true, values: new Map() };
}

export function parseCookieHeader(request) {
  const header = request.headers.get("Cookie");
  if (header === null) return { malformed: false, values: new Map() };
  if (header.includes(",") || header.includes("\r") || header.includes("\n"))
    return malformedJar();

  const values = new Map();
  for (const rawSegment of header.split(";")) {
    const segment = rawSegment.trim();
    if (segment.length === 0) return malformedJar();
    const separator = segment.indexOf("=");
    if (separator <= 0) return malformedJar();
    const name = segment.slice(0, separator);
    const value = segment.slice(separator + 1);
    if (!COOKIE_NAME.test(name) || !COOKIE_VALUE.test(value))
      return malformedJar();
    const current = values.get(name);
    if (current) current.push(value);
    else values.set(name, [value]);
  }
  return { malformed: false, values };
}

export function cookieValues(jar, name) {
  return jar.values.get(name) ?? [];
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE_NAME}=${token}; ${COOKIE_ATTRIBUTES}`;
}

export function bindingCookie(token) {
  return `${BINDING_COOKIE_NAME}=${token}; ${COOKIE_ATTRIBUTES}; Max-Age=${BINDING_COOKIE_MAX_AGE_SECONDS}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}

export function appendSetCookies(response, cookies) {
  if (cookies.length === 0) return response;
  const headers = new Headers(response.headers);
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
