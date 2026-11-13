// D1 fixed-window abuse limits for the Phase 5 auth boundary. D1 is the
// admission authority. Cloudflare's per-location Rate Limiting binding is not
// used and is not described as a globally exact quota.
//
// Each applicable bucket is one conditional upsert on the primary key
// (bucket_key, window_start). All buckets for a request are sent in one D1
// batch. The batch is transactional, but a rejected upsert does not abort the
// other statements: a denied request can consume capacity from the buckets
// that still have room. That is conservative. A bucket never admits more than
// its limit, including under concurrent requests.
import {
  AuthStorageError,
  decodeBase64Url,
  encodeBase64Url,
} from "../repositories/auth-data.mjs";
import { AUTH_RATE_LIMIT_STORAGE } from "./policy.mjs";

const HMAC_DOMAIN = "tanikun-auth-rate-v1";
const RATE_LIMIT_KEY_BYTES = 32;
const BUCKET_KEY_BYTES = 32;
const MAX_ADDRESS_LENGTH = 45;
const ADDRESS_CHARACTERS = /^[0-9A-Fa-f:.]+$/u;

// The contract uses one shared fallback bucket when trusted Cloudflare request
// metadata or the CF-Connecting-IP value is absent or malformed.
export const UNKNOWN_TRUSTED_ADDRESS = "unknown";

const UPSERT_COUNTER =
  "INSERT INTO auth_rate_limit_counters (bucket_key, window_start, count, expires_at) VALUES (?1, ?2, 1, ?3) ON CONFLICT(bucket_key, window_start) DO UPDATE SET count = count + 1 WHERE count < ?4 RETURNING count";
const CLEANUP_COUNTERS =
  "DELETE FROM auth_rate_limit_counters WHERE (bucket_key, window_start) IN (SELECT bucket_key, window_start FROM auth_rate_limit_counters WHERE expires_at <= ?1 ORDER BY expires_at LIMIT ?2)";

export function decodeRateLimitKey(value) {
  let bytes;
  try {
    bytes = decodeBase64Url(value, "temporarily_unavailable");
  } catch {
    throw new AuthStorageError("temporarily_unavailable");
  }
  if (bytes.length !== RATE_LIMIT_KEY_BYTES)
    throw new AuthStorageError("temporarily_unavailable");
  return bytes;
}

function normalizeAddress(value) {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > MAX_ADDRESS_LENGTH) return null;
  if (value !== value.trim()) return null;
  if (!ADDRESS_CHARACTERS.test(value)) return null;
  return value.toLowerCase();
}

// Only a request that carries actual Cloudflare request.cf metadata may use
// CF-Connecting-IP. X-Forwarded-For, Forwarded, X-Real-IP, a request body, and
// any other client-controlled value are never address sources. A same-zone
// subrequest can rewrite x-real-ip, so the Worker path does not read it.
export function trustedClientAddress(request) {
  const cf = request?.cf;
  if (cf === null || typeof cf !== "object" || Array.isArray(cf))
    return UNKNOWN_TRUSTED_ADDRESS;
  const normalized = normalizeAddress(request.headers.get("CF-Connecting-IP"));
  return normalized ?? UNKNOWN_TRUSTED_ADDRESS;
}

function requirePolicy(policy) {
  if (
    !policy ||
    typeof policy.id !== "string" ||
    policy.id.length === 0 ||
    !["address", "binding", "credential", "session", "account"].includes(
      policy.scope,
    ) ||
    !Number.isSafeInteger(policy.limit) ||
    policy.limit < 1 ||
    !Number.isSafeInteger(policy.windowMs) ||
    policy.windowMs < 1
  )
    throw new AuthStorageError("temporarily_unavailable");
  return policy;
}

function subjectFor(policy, subjects) {
  if (policy.scope === "address")
    return normalizeAddress(subjects.address) ?? UNKNOWN_TRUSTED_ADDRESS;
  const value = subjects[policy.scope];
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return encodeBase64Url(value);
  if (typeof value === "string" && value.length > 0) return value;
  throw new AuthStorageError("temporarily_unavailable");
}

function windowFor(policy, current) {
  const windowStart = Math.floor(current / policy.windowMs) * policy.windowMs;
  return {
    windowStart,
    expiresAt:
      windowStart + policy.windowMs + AUTH_RATE_LIMIT_STORAGE.retentionMs,
    retryAfterSeconds: (blockedAt) =>
      Math.max(
        1,
        Math.ceil((windowStart + policy.windowMs - blockedAt) / 1000),
      ),
  };
}

function storageFailure() {
  return new AuthStorageError("temporarily_unavailable");
}

export async function createAuthRateLimiter({
  db,
  request,
  key,
  now = Date.now,
}) {
  if (!db) throw storageFailure();
  const keyBytes =
    key instanceof Uint8Array ? Uint8Array.from(key) : decodeRateLimitKey(key);
  if (keyBytes.length !== RATE_LIMIT_KEY_BYTES) throw storageFailure();
  let hmacKey;
  try {
    hmacKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw storageFailure();
  }
  const address = trustedClientAddress(request);
  const encoder = new TextEncoder();

  function currentTime() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) throw storageFailure();
    return value;
  }

  async function deriveBucketKey(policy, value) {
    const domain = encoder.encode(
      `${HMAC_DOMAIN}\u0000${policy.id}\u0000${policy.scope}\u0000`,
    );
    const material = encoder.encode(value);
    const message = new Uint8Array(domain.length + material.length);
    message.set(domain, 0);
    message.set(material, domain.length);
    let signature;
    try {
      signature = await crypto.subtle.sign("HMAC", hmacKey, message);
    } catch {
      throw storageFailure();
    }
    const bytes = new Uint8Array(signature);
    if (bytes.length !== BUCKET_KEY_BYTES) throw storageFailure();
    return encodeBase64Url(bytes);
  }

  async function cleanupExpired(limit = AUTH_RATE_LIMIT_STORAGE.cleanupBatch) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw storageFailure();
    const current = currentTime();
    try {
      const result = await db
        .prepare(CLEANUP_COUNTERS)
        .bind(current, limit)
        .run();
      return result.meta.changes;
    } catch {
      throw storageFailure();
    }
  }

  async function enforce(policies, subjects = {}) {
    if (!Array.isArray(policies)) throw storageFailure();
    if (policies.length === 0) return;
    const current = currentTime();
    const prepared = [];
    for (const candidate of policies) {
      const policy = requirePolicy(candidate);
      const subject = subjectFor(policy, subjects);
      if (subject === null) continue;
      const window = windowFor(policy, current);
      prepared.push({
        policy,
        window,
        bucketKey: await deriveBucketKey(policy, subject),
      });
    }
    if (prepared.length === 0) return;

    const statements = [
      db
        .prepare(CLEANUP_COUNTERS)
        .bind(current, AUTH_RATE_LIMIT_STORAGE.cleanupBatch),
    ];
    for (const entry of prepared) {
      statements.push(
        db
          .prepare(UPSERT_COUNTER)
          .bind(
            entry.bucketKey,
            entry.window.windowStart,
            entry.window.expiresAt,
            entry.policy.limit,
          ),
      );
    }
    let results;
    try {
      results = await db.batch(statements);
    } catch {
      throw storageFailure();
    }
    let retryAfter = 0;
    for (let index = 0; index < prepared.length; index += 1) {
      const entry = prepared[index];
      if (results[index + 1].results.length > 0) continue;
      retryAfter = Math.max(
        retryAfter,
        entry.window.retryAfterSeconds(current),
      );
    }
    if (retryAfter > 0)
      throw new AuthStorageError("rate_limited", { retryAfter });
  }

  return { address, cleanupExpired, enforce };
}

export async function createConfiguredAuthRateLimiter({
  db,
  request,
  env,
  now = Date.now,
}) {
  return createAuthRateLimiter({
    db,
    request,
    key: env?.AUTH_RATE_LIMIT_KEY,
    now,
  });
}
