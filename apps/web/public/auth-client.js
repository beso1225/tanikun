// Phase 5 auth client. The session cookie is HttpOnly, so this module never
// reads or stores a session token. It projects only the allowlisted WebAuthn
// verification fields and never forwards `clientExtensionResults`, `prf`,
// transports, attachment metadata, or a generic credential JSON projection.
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const CHALLENGE_ID = /^[A-Za-z0-9_-]{22}$/u;
const PATH = /^\/[A-Za-z0-9/_-]*$/u;

export const AUTH_CLIENT_ERRORS = Object.freeze({
  CANCELED: "canceled",
  UNSUPPORTED: "unsupported",
  EXPIRED: "expired",
  OFFLINE: "offline",
  TIMEOUT: "timeout",
  RATE_LIMITED: "rate_limited",
  UNAUTHORIZED: "unauthorized",
  CSRF_FORBIDDEN: "csrf_forbidden",
  ALREADY_AUTHENTICATED: "already_authenticated",
  CREDENTIAL_CONFLICT: "credential_conflict",
  MALFORMED: "malformed",
  UNAVAILABLE: "temporarily_unavailable",
});

export class AuthClientError extends Error {
  constructor(code, { status, retryAfter } = {}) {
    super(code);
    this.name = "AuthClientError";
    this.code = code;
    if (Number.isInteger(status)) this.status = status;
    if (Number.isSafeInteger(retryAfter)) this.retryAfter = retryAfter;
  }
}

function fail(code, detail) {
  throw new AuthClientError(code, detail);
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!record(value)) return false;
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function bytesOf(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function decodeBase64Url(value, code = "malformed") {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) fail(code);
  let binary;
  try {
    const standard = value.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (standard.length % 4)) % 4);
    binary = atob(standard + padding);
  } catch {
    fail(code);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value) fail(code);
  return bytes;
}

export function encodeBase64Url(input) {
  const bytes = bytesOf(input);
  if (!bytes) fail("unsupported");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function canonicalToken(value, code = "malformed") {
  if (typeof value !== "string" || !TOKEN.test(value)) fail(code);
  return value;
}

function challengeId(value) {
  if (typeof value !== "string" || !CHALLENGE_ID.test(value)) fail("malformed");
  return value;
}

function projectString(value, code = "malformed") {
  if (typeof value !== "string" || value.length === 0) fail(code);
  return value;
}

function projectInteger(value, code = "malformed") {
  if (!Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}

function projectCredentialDescriptor(value) {
  if (!exactKeys(value, ["type", "id"]) || value.type !== "public-key")
    fail("malformed");
  canonicalToken(value.id);
  return {
    type: "public-key",
    id: decodeBase64Url(value.id).buffer,
  };
}

function projectRegistrationOptions(publicKey) {
  if (
    !exactKeys(publicKey, [
      "rp",
      "user",
      "challenge",
      "pubKeyCredParams",
      "timeout",
      "excludeCredentials",
      "authenticatorSelection",
      "attestation",
    ])
  )
    fail("malformed");
  if (
    !exactKeys(publicKey.rp, ["id", "name"]) ||
    !exactKeys(publicKey.user, ["id", "name", "displayName"]) ||
    !Array.isArray(publicKey.pubKeyCredParams) ||
    !Array.isArray(publicKey.excludeCredentials) ||
    !exactKeys(publicKey.authenticatorSelection, [
      "residentKey",
      "requireResidentKey",
      "userVerification",
    ])
  )
    fail("malformed");
  if (
    publicKey.pubKeyCredParams.length !== 1 ||
    !exactKeys(publicKey.pubKeyCredParams[0], ["type", "alg"]) ||
    publicKey.pubKeyCredParams[0].type !== "public-key" ||
    publicKey.pubKeyCredParams[0].alg !== -7
  )
    fail("malformed");
  if (
    publicKey.attestation !== "none" ||
    publicKey.authenticatorSelection.residentKey !== "required" ||
    publicKey.authenticatorSelection.requireResidentKey !== true ||
    publicKey.authenticatorSelection.userVerification !== "required"
  )
    fail("malformed");
  canonicalToken(publicKey.user.id);
  const challenge = decodeBase64Url(publicKey.challenge);
  const user = decodeBase64Url(publicKey.user.id);
  if (challenge.byteLength !== 32 || user.byteLength !== 32) fail("malformed");
  return {
    rp: {
      id: projectString(publicKey.rp.id),
      name: projectString(publicKey.rp.name),
    },
    user: {
      id: user.buffer,
      name: projectString(publicKey.user.name),
      displayName: projectString(publicKey.user.displayName),
    },
    challenge: challenge.buffer,
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    timeout: projectInteger(publicKey.timeout),
    excludeCredentials: publicKey.excludeCredentials.map(
      projectCredentialDescriptor,
    ),
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
    attestation: "none",
  };
}

function projectAssertionOptions(publicKey) {
  if (
    !exactKeys(publicKey, [
      "challenge",
      "timeout",
      "rpId",
      "allowCredentials",
      "userVerification",
    ]) ||
    !Array.isArray(publicKey.allowCredentials) ||
    publicKey.userVerification !== "required"
  )
    fail("malformed");
  if (publicKey.allowCredentials.length !== 0) fail("malformed");
  const challenge = decodeBase64Url(publicKey.challenge);
  if (challenge.byteLength !== 32) fail("malformed");
  return {
    challenge: challenge.buffer,
    timeout: projectInteger(publicKey.timeout),
    rpId: projectString(publicKey.rpId),
    allowCredentials: [],
    userVerification: "required",
  };
}

export function parseCredentialOptions(body, kind) {
  if (
    !exactKeys(body, ["challenge_id", "publicKey"]) ||
    !record(body.publicKey)
  )
    fail("malformed");
  const id = challengeId(body.challenge_id);
  if (kind === "registration")
    return {
      challengeId: id,
      publicKey: projectRegistrationOptions(body.publicKey),
    };
  if (kind === "sign_in")
    return {
      challengeId: id,
      publicKey: projectAssertionOptions(body.publicKey),
    };
  fail("malformed");
}

function encodedField(value, { min = 1, max = 32 * 1024 } = {}) {
  const bytes = bytesOf(value);
  if (!bytes || bytes.byteLength < min || bytes.byteLength > max)
    fail("unsupported");
  return encodeBase64Url(bytes);
}

export function serializeRegistrationCredential(credential) {
  if (!record(credential) || credential.type !== "public-key")
    fail("unsupported");
  if (typeof credential.id !== "string") fail("unsupported");
  const rawId = bytesOf(credential.rawId);
  if (!rawId || rawId.byteLength === 0 || rawId.byteLength > 1023)
    fail("unsupported");
  const id = encodeBase64Url(rawId);
  if (credential.id !== id) fail("unsupported");
  const response = credential.response;
  if (!record(response)) fail("unsupported");
  return {
    id,
    rawId: id,
    type: "public-key",
    response: {
      clientDataJSON: encodedField(response.clientDataJSON),
      attestationObject: encodedField(response.attestationObject),
    },
  };
}

export function serializeAssertionCredential(credential) {
  if (!record(credential) || credential.type !== "public-key")
    fail("unsupported");
  if (typeof credential.id !== "string") fail("unsupported");
  const rawId = bytesOf(credential.rawId);
  if (!rawId || rawId.byteLength === 0 || rawId.byteLength > 1023)
    fail("unsupported");
  const id = encodeBase64Url(rawId);
  if (credential.id !== id) fail("unsupported");
  const response = credential.response;
  if (!record(response)) fail("unsupported");
  return {
    id,
    rawId: id,
    type: "public-key",
    response: {
      clientDataJSON: encodedField(response.clientDataJSON),
      authenticatorData: encodedField(response.authenticatorData),
      signature: encodedField(response.signature),
      userHandle: encodedField(response.userHandle, { min: 32, max: 32 }),
    },
  };
}

function sessionBody(body) {
  if (
    !exactKeys(body, ["session"]) ||
    !record(body.session) ||
    !exactKeys(body.session, [
      "account",
      "expires_at",
      "idle_expires_at",
      "recent_auth",
      "recent_auth_expires_at",
      "csrf_token",
    ]) ||
    !exactKeys(body.session.account, ["handle", "display_name"])
  )
    fail("malformed");
  const handle = canonicalToken(body.session.account.handle);
  canonicalToken(body.session.csrf_token);
  if (
    typeof body.session.account.display_name !== "string" ||
    body.session.account.display_name.length < 1 ||
    body.session.account.display_name.length > 80
  )
    fail("malformed");
  const expiresAt = projectInteger(body.session.expires_at);
  const idleExpiresAt = projectInteger(body.session.idle_expires_at);
  const recentExpiresAt = projectInteger(body.session.recent_auth_expires_at);
  if (body.session.recent_auth !== true && body.session.recent_auth !== false)
    fail("malformed");
  return {
    account: {
      handle,
      display_name: body.session.account.display_name,
    },
    expires_at: expiresAt,
    idle_expires_at: idleExpiresAt,
    recent_auth: body.session.recent_auth,
    recent_auth_expires_at: recentExpiresAt,
    csrf_token: body.session.csrf_token,
  };
}

function retryAfterSeconds(response) {
  const raw = response.headers?.get?.("retry-after");
  if (typeof raw !== "string" || !/^[0-9]+$/u.test(raw)) return undefined;
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds) && seconds <= 2_147_483
    ? seconds
    : undefined;
}

function statusCodeError(code, status, response) {
  const retryAfter = status === 429 ? retryAfterSeconds(response) : undefined;
  const detail = { status, retryAfter };
  switch (code) {
    case "rate_limited":
      return new AuthClientError("rate_limited", detail);
    case "unauthorized":
      return new AuthClientError("unauthorized", detail);
    case "authentication_failed":
      return new AuthClientError("expired", detail);
    case "csrf_forbidden":
      return new AuthClientError("csrf_forbidden", detail);
    case "origin_forbidden":
      return new AuthClientError("origin_forbidden", detail);
    case "already_authenticated":
      return new AuthClientError("already_authenticated", detail);
    case "credential_conflict":
      return new AuthClientError("credential_conflict", detail);
    case "malformed_request":
    case "unsupported_media_type":
    case "request_too_large":
      return new AuthClientError("malformed", detail);
    case "not_found":
      return new AuthClientError("not_found", detail);
    case "temporarily_unavailable":
      return new AuthClientError("temporarily_unavailable", detail);
    default:
      return status >= 500
        ? new AuthClientError("temporarily_unavailable", detail)
        : new AuthClientError("malformed", detail);
  }
}

function errorBody(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !exactKeys(body, ["error"]) ||
    !exactKeys(body.error, ["code"]) ||
    typeof body.error.code !== "string"
  )
    return null;
  return body.error.code;
}

function credentialFailure(error) {
  const name = error?.name;
  if (name === "NotAllowedError" || name === "AbortError")
    return new AuthClientError("canceled");
  if (name === "InvalidStateError")
    return new AuthClientError("credential_conflict");
  if (
    name === "SecurityError" ||
    name === "NotSupportedError" ||
    name === "NotReadableError"
  )
    return new AuthClientError("unsupported");
  return new AuthClientError("unsupported");
}

async function readText(response, controller) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 64 * 1024) {
        controller.abort();
        fail("malformed");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("malformed");
  }
}

function statusSuccess(status) {
  return status === 200 || status === 204;
}

export function createAuthClient({
  fetch,
  baseUrl,
  credentials = globalThis.navigator?.credentials,
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
  if (
    (base.protocol !== "http:" && base.protocol !== "https:") ||
    base.pathname !== "/" ||
    base.search !== "" ||
    base.hash !== ""
  )
    throw new TypeError("baseUrl must be an absolute HTTP URL without a path");

  function url(path) {
    if (!PATH.test(path)) throw new TypeError("invalid auth path");
    return new URL(path, base.origin).href;
  }

  async function request(
    path,
    { method = "GET", body, csrfToken, signal } = {},
  ) {
    if (signal?.aborted) throw new AuthClientError("canceled");
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let response;
    let text;
    try {
      const headers = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (csrfToken !== undefined) {
        canonicalToken(csrfToken, "csrf_forbidden");
        headers["X-CSRF-Token"] = csrfToken;
      }
      try {
        response = await fetch(url(path), {
          method,
          cache: "no-store",
          credentials: "same-origin",
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        });
      } catch {
        if (timedOut) throw new AuthClientError("timeout");
        if (signal?.aborted) throw new AuthClientError("canceled");
        throw new AuthClientError("offline");
      }
      try {
        text = await readText(response, controller);
      } catch (error) {
        if (error instanceof AuthClientError) throw error;
        if (timedOut) throw new AuthClientError("timeout");
        if (signal?.aborted) throw new AuthClientError("canceled");
        throw new AuthClientError("offline");
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    if (statusSuccess(response.status)) {
      if (response.status === 204) return null;
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new AuthClientError("malformed");
      }
      return parsed;
    }
    const code = errorBody(text);
    if (!code)
      throw new AuthClientError("malformed", { status: response.status });
    throw statusCodeError(code, response.status, response);
  }

  async function register({ displayName, signal, beforeVerify } = {}) {
    if (!credentials || typeof credentials.create !== "function")
      throw new AuthClientError("unsupported");
    const options = await request("/api/v1/auth/register/options", {
      method: "POST",
      body: displayName === undefined ? {} : { display_name: displayName },
      signal,
    });
    const parsed = parseCredentialOptions(options, "registration");
    let credential;
    try {
      credential = await credentials.create({
        publicKey: parsed.publicKey,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw new AuthClientError("canceled");
      throw credentialFailure(error);
    }
    if (signal?.aborted) throw new AuthClientError("canceled");
    if (!credential) throw new AuthClientError("canceled");
    const serialized = serializeRegistrationCredential(credential);
    if (signal?.aborted) throw new AuthClientError("canceled");
    await beforeVerify?.();
    const verified = await request("/api/v1/auth/register/verify", {
      method: "POST",
      body: { challenge_id: parsed.challengeId, credential: serialized },
      signal,
    });
    return sessionBody(verified);
  }

  async function signIn({ signal, beforeVerify } = {}) {
    if (!credentials || typeof credentials.get !== "function")
      throw new AuthClientError("unsupported");
    const options = await request("/api/v1/auth/sign-in/options", {
      method: "POST",
      body: {},
      signal,
    });
    const parsed = parseCredentialOptions(options, "sign_in");
    let credential;
    try {
      credential = await credentials.get({
        publicKey: parsed.publicKey,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw new AuthClientError("canceled");
      throw credentialFailure(error);
    }
    if (signal?.aborted) throw new AuthClientError("canceled");
    if (!credential) throw new AuthClientError("canceled");
    const serialized = serializeAssertionCredential(credential);
    if (signal?.aborted) throw new AuthClientError("canceled");
    await beforeVerify?.();
    const verified = await request("/api/v1/auth/sign-in/verify", {
      method: "POST",
      body: { challenge_id: parsed.challengeId, credential: serialized },
      signal,
    });
    return sessionBody(verified);
  }

  async function logout({ csrfToken, signal } = {}) {
    await request("/api/v1/auth/logout", {
      method: "POST",
      csrfToken,
      signal,
    });
  }

  async function readStatus({ signal } = {}) {
    const body = await request("/api/v1/auth/session", { signal });
    if (!exactKeys(body, ["session"])) throw new AuthClientError("malformed");
    if (body.session === null) return null;
    return sessionBody(body);
  }

  return Object.freeze({ register, signIn, logout, status: readStatus });
}
