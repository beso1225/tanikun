import {
  SYNC_LIMITS,
  SyncError,
  parseWireJson,
  requireDocumentId,
  validateAppend,
  validateStoredEnvelope,
} from "./sync-contract.mjs";

export { SYNC_LIMITS } from "./sync-contract.mjs";

// Transport-only result variants. Callers compare against these values instead
// of inspecting messages or exception text.
export const SYNC_TRANSPORT_KINDS = Object.freeze({
  BOOTSTRAPPED: "bootstrapped",
  PUSHED: "pushed",
  PULLED: "pulled",
  INVALID_REQUEST: "invalid_request",
  OFFLINE: "offline",
  TIMEOUT: "timeout",
  ABORTED: "aborted",
  UNAUTHORIZED: "unauthorized",
  NOT_FOUND: "not_found",
  MALFORMED_RESPONSE: "malformed_response",
  CONFLICT: "conflict",
  REQUEST_REJECTED: "request_rejected",
  SERVER_ERROR: "server_error",
});

export const SYNC_TRANSPORT_MODES = Object.freeze({
  DEV_BEARER: "dev_bearer",
  SESSION: "session",
});

const K = SYNC_TRANSPORT_KINDS;
const M = SYNC_TRANSPORT_MODES;
const CSRF_HEADER = "X-CSRF-Token";
const encoder = new TextEncoder();

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isCursor(value) {
  return (
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= SYNC_LIMITS.maxSequence
  );
}

function isSequence(value) {
  return (
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= SYNC_LIMITS.maxSequence
  );
}

function malformed() {
  return { kind: K.MALFORMED_RESPONSE, retryable: false };
}

function invalid(code = "malformed_request") {
  return { kind: K.INVALID_REQUEST, code, retryable: false };
}

function transportFailure(timedOut, signal) {
  if (timedOut) return { kind: K.TIMEOUT, retryable: true };
  if (signal?.aborted) return { kind: K.ABORTED, retryable: false };
  return { kind: K.OFFLINE, retryable: true };
}

function readJson(response, text) {
  try {
    const type = response.headers.get("content-type");
    if (
      !type ||
      type.split(";")[0].trim().toLowerCase() !== "application/json"
    ) {
      return null;
    }
    const value = parseWireJson(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

// Browsers expose Retry-After only when the API sends
// Access-Control-Expose-Headers: Retry-After. The Phase 4 Worker does.
function retryAfterSeconds(response) {
  const raw = response.headers?.get?.("retry-after");
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw)) return undefined;
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

function serverFailure(status, response, text) {
  const body = readJson(response, text);
  if (!body) return malformed();
  const withCursor = Object.hasOwn(body, "cursor");
  const code = body.error?.code;
  const expectsCursor = code === "cursor_ahead" || code === "log_gap";
  if (
    !exactKeys(body, withCursor ? ["error", "cursor"] : ["error"]) ||
    !exactKeys(body.error, ["code"]) ||
    typeof code !== "string" ||
    code.length === 0 ||
    withCursor !== expectsCursor ||
    (expectsCursor && (status !== 409 || !isCursor(body.cursor)))
  ) {
    return malformed();
  }
  const base = {
    status,
    code,
    retryable: false,
  };
  if (withCursor) base.cursor = body.cursor;
  switch (status) {
    case 401:
      return { ...base, kind: K.UNAUTHORIZED };
    case 404:
      return { ...base, kind: K.NOT_FOUND };
    case 409:
      return { ...base, kind: K.CONFLICT };
    case 413:
      return { ...base, kind: K.REQUEST_REJECTED };
    default:
      if (status >= 500) {
        const retryable = code === "temporarily_unavailable";
        const result = {
          ...base,
          kind: K.SERVER_ERROR,
          retryable,
        };
        if (retryable) {
          const retryAfter = retryAfterSeconds(response);
          if (retryAfter !== undefined) result.retry_after = retryAfter;
        }
        return result;
      }
      return { ...base, kind: K.REQUEST_REJECTED };
  }
}

function parseBootstrap(response, text) {
  if (response.status !== 200)
    return serverFailure(response.status, response, text);
  const body = readJson(response, text);
  if (!body || !exactKeys(body, ["document_id", "cursor"])) return malformed();
  try {
    requireDocumentId(body.document_id);
  } catch {
    return malformed();
  }
  if (!isCursor(body.cursor)) return malformed();
  return {
    kind: K.BOOTSTRAPPED,
    document_id: body.document_id,
    cursor: body.cursor,
  };
}

function parsePush(documentId, validated, response, text) {
  if (response.status !== 200)
    return serverFailure(response.status, response, text);
  const body = readJson(response, text);
  if (
    !body ||
    !exactKeys(body, ["document_id", "accepted", "cursor"]) ||
    body.document_id !== documentId ||
    !Array.isArray(body.accepted) ||
    body.accepted.length !== validated.length ||
    !isCursor(body.cursor)
  ) {
    return malformed();
  }
  const accepted = [];
  const sequenceByChange = new Map();
  const changeBySequence = new Map();
  for (const [index, entry] of body.accepted.entries()) {
    if (
      !exactKeys(entry, ["change_id", "server_sequence"]) ||
      entry.change_id !== validated[index].wire.change_id ||
      !isSequence(entry.server_sequence) ||
      entry.server_sequence > body.cursor
    ) {
      return malformed();
    }
    const previousSequence = sequenceByChange.get(entry.change_id);
    if (
      previousSequence !== undefined &&
      previousSequence !== entry.server_sequence
    ) {
      return malformed();
    }
    const previousChange = changeBySequence.get(entry.server_sequence);
    if (previousChange !== undefined && previousChange !== entry.change_id) {
      return malformed();
    }
    sequenceByChange.set(entry.change_id, entry.server_sequence);
    changeBySequence.set(entry.server_sequence, entry.change_id);
    accepted.push(entry);
  }
  return {
    kind: K.PUSHED,
    document_id: body.document_id,
    accepted,
    cursor: body.cursor,
  };
}

function parsePull(documentId, after, limit, response, text) {
  if (response.status !== 200)
    return serverFailure(response.status, response, text);
  const body = readJson(response, text);
  if (
    !body ||
    !exactKeys(body, [
      "document_id",
      "changes",
      "next_cursor",
      "has_more",
      "cursor",
    ]) ||
    body.document_id !== documentId ||
    !Array.isArray(body.changes) ||
    body.changes.length > limit ||
    typeof body.has_more !== "boolean" ||
    !isCursor(body.next_cursor) ||
    !isCursor(body.cursor) ||
    body.cursor < body.next_cursor ||
    body.has_more !== body.next_cursor < body.cursor
  ) {
    return malformed();
  }
  let expected = after;
  try {
    for (const change of body.changes) {
      const { server_sequence } = validateStoredEnvelope(change, documentId);
      if (server_sequence !== expected + 1) return malformed();
      expected = server_sequence;
    }
  } catch {
    return malformed();
  }
  if (body.changes.length === 0) {
    if (body.next_cursor !== after || body.cursor !== after) return malformed();
  } else if (body.next_cursor !== expected) {
    return malformed();
  }
  return {
    kind: K.PULLED,
    document_id: body.document_id,
    changes: body.changes,
    next_cursor: body.next_cursor,
    has_more: body.has_more,
    cursor: body.cursor,
  };
}

async function readResponseText(response) {
  const contentLength = response.headers?.get?.("content-length");
  if (contentLength !== null && contentLength !== undefined) {
    if (
      !/^[0-9]+$/.test(contentLength) ||
      Number(contentLength) > SYNC_LIMITS.maxResponseBytes
    ) {
      if (response.body) {
        try {
          await response.body.cancel();
        } catch {
          // The body may already be closed.
        }
      }
      return null;
    }
  }
  if (!response.body) {
    const text = await response.text();
    return encoder.encode(text).byteLength > SYNC_LIMITS.maxResponseBytes
      ? null
      : text;
  }
  let reader;
  try {
    reader = response.body.getReader();
  } catch {
    return null;
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > SYNC_LIMITS.maxResponseBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A cancelled stream can already have released its lock.
    }
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
    return null;
  }
}

export function createSyncTransport({
  fetch,
  mode,
  baseUrl,
  token,
  getCsrfToken,
  timeoutMs = 15_000,
} = {}) {
  if (typeof fetch !== "function") {
    throw new TypeError("fetch must be a function");
  }
  if (mode !== M.DEV_BEARER && mode !== M.SESSION) {
    throw new TypeError("mode must be exactly dev_bearer or session");
  }
  if (mode === M.DEV_BEARER) {
    if (
      typeof token !== "string" ||
      token.length === 0 ||
      /[\r\n]/.test(token)
    ) {
      throw new TypeError("token must be a non-empty bearer token");
    }
    if (getCsrfToken !== undefined)
      throw new TypeError("dev_bearer must not use a CSRF token");
  } else {
    // Session mode is same-origin cookie transport. A runtime bearer or any
    // other opaque token is forbidden, and the CSRF token stays in memory.
    if (token !== undefined)
      throw new TypeError("session mode must not carry a runtime token");
    if (typeof getCsrfToken !== "function")
      throw new TypeError("session mode requires getCsrfToken");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("timeoutMs must be a positive integer");
  }
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new TypeError("baseUrl must be an absolute HTTP URL");
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new TypeError("baseUrl must be an absolute HTTP URL");
  }
  if (base.pathname !== "/" || base.search !== "" || base.hash !== "") {
    throw new TypeError("baseUrl must not include a path, query, or fragment");
  }

  const origin = base.origin;
  const credentials = mode === M.DEV_BEARER ? "omit" : "same-origin";
  const headers =
    mode === M.DEV_BEARER
      ? Object.freeze({
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        })
      : Object.freeze({ Accept: "application/json" });

  function writeHeaders() {
    if (mode === M.DEV_BEARER) return {};
    let csrf;
    try {
      csrf = getCsrfToken();
    } catch {
      return null;
    }
    if (typeof csrf !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(csrf))
      return null;
    return { [CSRF_HEADER]: csrf };
  }

  async function request(url, init, signal, interpret, { write = false } = {}) {
    const extra = write ? writeHeaders() : {};
    if (extra === null) return { kind: K.UNAUTHORIZED, retryable: false };
    if (signal?.aborted) {
      return { kind: K.ABORTED, retryable: false };
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let response;
    let text;
    try {
      try {
        response = await fetch(url, {
          ...init,
          cache: "no-store",
          credentials,
          headers: { ...headers, ...extra, ...init.headers },
          signal: controller.signal,
        });
      } catch {
        return transportFailure(timedOut, signal);
      }
      if (
        (typeof response?.text !== "function" &&
          typeof response?.body?.getReader !== "function") ||
        !Number.isInteger(response.status)
      ) {
        return malformed();
      }
      try {
        text = await readResponseText(response);
      } catch {
        return transportFailure(timedOut, signal);
      }
      if (text === null) return malformed();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    if (timedOut) return { kind: K.TIMEOUT, retryable: true };
    if (signal?.aborted) return { kind: K.ABORTED, retryable: false };
    return interpret(response, text);
  }

  async function bootstrap({ signal } = {}) {
    // Dev bearer keeps ADR-0014's cookie-free GET. Session mode provisions
    // with POST, no body, no query, and the in-memory CSRF header.
    return request(
      new URL("/api/v1/sync/document", origin).href,
      { method: mode === M.DEV_BEARER ? "GET" : "POST" },
      signal,
      parseBootstrap,
      { write: mode === M.SESSION },
    );
  }

  async function push(documentId, changes, { signal } = {}) {
    let validated;
    try {
      requireDocumentId(documentId);
      validated = validateAppend(changes, documentId);
    } catch (error) {
      return invalid(
        error instanceof SyncError ? error.code : "malformed_request",
      );
    }
    let body;
    try {
      body = JSON.stringify({
        changes: validated.map((entry) => entry.wire),
      });
    } catch {
      return invalid();
    }
    if (encoder.encode(body).byteLength > SYNC_LIMITS.maxRequestBytes) {
      return invalid("request_too_large");
    }
    return request(
      new URL(`/api/v1/sync/documents/${documentId}/changes`, origin).href,
      {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
      },
      signal,
      (response, text) => parsePush(documentId, validated, response, text),
      { write: mode === M.SESSION },
    );
  }

  async function pull(documentId, options = {}) {
    const { after = 0, limit = SYNC_LIMITS.maxPageChanges, signal } = options;
    try {
      requireDocumentId(documentId);
      if (
        !isCursor(after) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > SYNC_LIMITS.maxPageChanges
      ) {
        return invalid();
      }
    } catch {
      return invalid();
    }
    const url = new URL(`/api/v1/sync/documents/${documentId}/changes`, origin);
    url.searchParams.set("after", String(after));
    url.searchParams.set("limit", String(limit));
    return request(url.href, { method: "GET" }, signal, (response, text) =>
      parsePull(documentId, after, limit, response, text),
    );
  }

  return Object.freeze({ bootstrap, push, pull });
}
