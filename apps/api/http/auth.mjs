import { ApiError } from "./errors.mjs";

export const ALLOWED_ORIGIN = "http://127.0.0.1:4300";

function parseIdentities(value) {
  let mapping = value;
  if (typeof mapping === "string") {
    try {
      mapping = JSON.parse(mapping);
    } catch {
      return null;
    }
  }
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping))
    return null;
  const identities = Object.create(null);
  const entries = Object.entries(mapping);
  if (entries.length === 0) return null;
  for (const [token, ownerId] of entries) {
    if (!token || typeof ownerId !== "string" || ownerId.length === 0)
      return null;
    identities[token] = ownerId;
  }
  return identities;
}

// ADR-0014: the environment and URL gate runs before Origin, routes, or auth.
// A disabled or malformed local configuration is indistinguishable from an
// unknown route.
export function readDevEnvironment(request, env) {
  if (env?.DEV_AUTH !== "true" || env?.APP_ENV !== "local") return null;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
  )
    return null;
  const identities = parseIdentities(env.DEV_AUTH_IDENTITIES);
  if (!identities) return null;
  return { identities };
}

export function assertOrigin(request) {
  if (request.headers.get("Origin") !== ALLOWED_ORIGIN)
    throw new ApiError("origin_forbidden");
}

export function resolveIdentity(request, dev) {
  const header = request.headers.get("Authorization");
  if (header === null) throw new ApiError("unauthorized");
  const match = /^Bearer ([^\s]+)$/.exec(header.trim());
  if (!match) throw new ApiError("unauthorized");
  const token = match[1];
  if (!Object.hasOwn(dev.identities, token)) throw new ApiError("unauthorized");
  return { token, ownerId: dev.identities[token] };
}
