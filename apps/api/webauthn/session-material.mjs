// Server-only session material for the #179 handoff. #180 owns cookie
// transport, CSRF enforcement, lookup, and revocation. This module only
// creates the opaque token and the ADR-0015 CSRF derivation once; raw values
// never enter a JSON response or a log.
import {
  AuthStorageError,
  decodeBase64Url,
  encodeBase64Url,
  randomBytes,
} from "../repositories/auth-data.mjs";

export const SESSION_TOKEN_BYTES = 32;
export const SESSION_TOKEN_LENGTH = 43;

const CSRF_MESSAGE = new TextEncoder().encode("tanikun-csrf-v1");

export async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", value));
}

export function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function deriveCsrfToken(sessionToken) {
  const key = await crypto.subtle.importKey(
    "raw",
    sessionToken,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, CSRF_MESSAGE));
}

// Decode a canonical, unpadded base64url opaque token and require exactly the
// session-material length. The caller chooses the public error code so a
// malformed cookie is unauthorized while malformed internal material is a
// storage/configuration failure.
export function decodeSessionToken(value, code = "unauthorized") {
  const bytes = decodeBase64Url(value, code);
  if (bytes.length !== SESSION_TOKEN_BYTES) throw new AuthStorageError(code);
  return bytes;
}

export async function createSessionMaterial({
  newToken = () => randomBytes(SESSION_TOKEN_BYTES),
} = {}) {
  const tokenBytes = newToken();
  if (
    !(tokenBytes instanceof Uint8Array) ||
    tokenBytes.length !== SESSION_TOKEN_BYTES
  )
    throw new Error("invalid session token");
  const csrfBytes = await deriveCsrfToken(tokenBytes);
  return {
    token: encodeBase64Url(tokenBytes),
    digest: await sha256(tokenBytes),
    csrfToken: encodeBase64Url(csrfBytes),
    csrfDigest: await sha256(csrfBytes),
  };
}
