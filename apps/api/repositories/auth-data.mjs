// Shared Phase 5 storage values and validation. The repository boundary accepts
// digest bytes and verified authenticator results from the future HTTP layer; it
// never accepts or derives raw session, CSRF, or challenge values from D1.
export const AUTH_STORAGE_LIMITS = Object.freeze({
  challengeLifetimeMs: 300_000,
  challengeCapPerBinding: 3,
  challengeCleanupBatch: 100,
  sessionAbsoluteLifetimeMs: 43_200_000,
  sessionIdleLifetimeMs: 1_800_000,
  sessionLastSeenWriteMs: 60_000,
  recentAuthWindowMs: 300_000,
  revokedSessionRetentionMs: 3_600_000,
  credentialLimit: 20,
  credentialIdMaxBytes: 1023,
  publicKeyMaxBytes: 2048,
  cleanupBatch: 100,
});

export const CHALLENGE_PURPOSES = Object.freeze([
  "register",
  "sign_in",
  "add_credential",
  "step_up",
]);

export const SESSION_REVOKE_REASONS = Object.freeze([
  "logout",
  "logout_all",
  "credential_removed",
  "sign_in_rotation",
]);

export class AuthStorageError extends Error {
  constructor(code, { retryAfter } = {}) {
    super(code);
    this.name = "AuthStorageError";
    this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const ACCOUNT_ID = /^acct_[A-Za-z0-9_-]{8,80}$/u;

export function encodeBase64Url(value) {
  const binary = Array.from(value, (byte) => String.fromCharCode(byte)).join(
    "",
  );
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

export function decodeBase64Url(value, code = "malformed_request") {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !BASE64URL.test(value) ||
    value.length % 4 === 1
  )
    throw new AuthStorageError(code);
  const padding = (4 - (value.length % 4)) % 4;
  let binary;
  try {
    binary = atob(
      value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padding),
    );
  } catch {
    throw new AuthStorageError(code);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value) throw new AuthStorageError(code);
  return bytes;
}

export function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function defaultAccountHandle() {
  return encodeBase64Url(randomBytes(32));
}

export function defaultAccountId() {
  return `acct_${encodeBase64Url(randomBytes(16))}`;
}

export function defaultChallengeId() {
  return encodeBase64Url(randomBytes(16));
}

export function defaultDocumentId() {
  return crypto.randomUUID();
}

export function toBytes(value) {
  if (value === null || value === undefined || typeof value === "string")
    return null;
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    );
  if (typeof value.byteLength === "number") {
    try {
      return new Uint8Array(value);
    } catch {
      try {
        return new Uint8Array(value.slice(0));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function byteView(value) {
  return toBytes(value);
}

export function requireDigest(value, code = "malformed_request") {
  const bytes = byteView(value);
  if (!bytes || bytes.length !== 32) throw new AuthStorageError(code);
  return bytes;
}

export function requireBytes(
  value,
  { min = 1, max = Number.MAX_SAFE_INTEGER, code = "malformed_request" } = {},
) {
  const bytes = byteView(value);
  if (!bytes || bytes.length < min || bytes.length > max)
    throw new AuthStorageError(code);
  return bytes;
}

export function requireAccountHandle(value, code = "malformed_request") {
  const bytes = decodeBase64Url(value, code);
  if (bytes.length !== 32) throw new AuthStorageError(code);
  return value;
}

export function requireChallengeId(value, code = "malformed_request") {
  const bytes = decodeBase64Url(value, code);
  if (bytes.length !== 16) throw new AuthStorageError(code);
  return value;
}

export function requireCredentialId(value, code = "malformed_request") {
  const bytes = decodeBase64Url(value, code);
  if (
    bytes.length < 1 ||
    bytes.length > AUTH_STORAGE_LIMITS.credentialIdMaxBytes
  )
    throw new AuthStorageError(code);
  return value;
}

export function requireUserId(value, code = "malformed_request") {
  if (typeof value !== "string" || !ACCOUNT_ID.test(value))
    throw new AuthStorageError(code);
  return value;
}

export function requireDisplayName(value, code = "malformed_request") {
  if (value === undefined || value === null) return "Tanikun user";
  if (typeof value !== "string") throw new AuthStorageError(code);
  let count = 0;
  for (const character of value) {
    const point = character.codePointAt(0);
    if (
      point < 0x20 ||
      (point >= 0x7f && point <= 0x9f) ||
      (point >= 0xd800 && point <= 0xdfff)
    )
      throw new AuthStorageError(code);
    count += 1;
  }
  if (count < 1 || count > 80) throw new AuthStorageError(code);
  return value;
}

export function requireCounter(value, code = "malformed_request") {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new AuthStorageError(code);
  return value;
}

export function requireTimestamp(value, code = "malformed_request") {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new AuthStorageError(code);
  return value;
}

export function requireFlag(value, code = "malformed_request") {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  throw new AuthStorageError(code);
}

export function requirePurpose(value, code = "malformed_request") {
  if (!CHALLENGE_PURPOSES.includes(value)) throw new AuthStorageError(code);
  return value;
}

export function requireRevokeReason(value, code = "malformed_request") {
  if (!SESSION_REVOKE_REASONS.includes(value)) throw new AuthStorageError(code);
  return value;
}

export function requireBatchLimit(value, code = "malformed_request") {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000)
    throw new AuthStorageError(code);
  return value;
}

export function normalizeCredential(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AuthStorageError("malformed_request");
  const credentialId = requireCredentialId(
    value.id ?? value.credentialId,
    "malformed_request",
  );
  const publicKey = requireBytes(value.publicKey, {
    min: 1,
    max: AUTH_STORAGE_LIMITS.publicKeyMaxBytes,
    code: "malformed_request",
  });
  const counter = requireCounter(value.counter, "malformed_request");
  const backupEligible = requireFlag(
    value.backupEligible,
    "authentication_failed",
  );
  const backupState = requireFlag(value.backupState, "authentication_failed");
  if (backupEligible === 0 && backupState === 1)
    throw new AuthStorageError("authentication_failed");
  return {
    credentialId,
    publicKey,
    counter,
    backupEligible: backupEligible === 1,
    backupState: backupState === 1,
  };
}

export function normalizeAssertion(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AuthStorageError("authentication_failed");
  const credentialId = requireCredentialId(
    value.credentialId ?? value.id,
    "authentication_failed",
  );
  const userId = requireUserId(value.userId, "authentication_failed");
  const newCounter = requireCounter(
    value.newCounter ?? value.counter,
    "authentication_failed",
  );
  const backupEligible = requireFlag(
    value.backupEligible,
    "authentication_failed",
  );
  const backupState = requireFlag(value.backupState, "authentication_failed");
  if (backupEligible === 0 && backupState === 1)
    throw new AuthStorageError("authentication_failed");
  return {
    credentialId,
    userId,
    newCounter,
    backupEligible: backupEligible === 1,
    backupState: backupState === 1,
  };
}

export function normalizeSessionCredentials(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AuthStorageError("malformed_request");
  return {
    digest: requireDigest(value.digest, "malformed_request"),
    csrfDigest: requireDigest(value.csrfDigest, "malformed_request"),
  };
}

export function retryAfterSeconds(expiresAt, now) {
  return Math.max(1, Math.ceil((expiresAt - now) / 1000));
}

export function hasConstraint(error, fragment) {
  const detail = `${error?.message ?? ""} ${error?.cause?.message ?? ""}`;
  return detail.includes(fragment);
}

export function databaseError(error) {
  if (error instanceof AuthStorageError) return error;
  if (
    hasConstraint(error, "UNIQUE constraint failed: credentials.credential_id")
  )
    return new AuthStorageError("credential_conflict");
  return new AuthStorageError("temporarily_unavailable");
}
