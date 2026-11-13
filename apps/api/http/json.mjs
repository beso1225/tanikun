import {
  SYNC_LIMITS,
  parseWireJson,
} from "../../../packages/sync-contract/contract.mjs";
import { ApiError } from "./errors.mjs";

// The shared sync contract owns wire JSON parsing. It rejects duplicate object
// keys before JSON.parse can apply its last-wins rule, bounds nesting at 64,
// and installs every key as an own data property so an own "__proto__" key
// cannot mutate a prototype. This boundary previously returned null-prototype
// objects; its consumer checks wire keys with Object.keys/Object.hasOwn, so
// the shared ordinary-object representation keeps own-key checks and
// prototype-pollution safety without a second parser.
export function parseJson(text) {
  return parseWireJson(text);
}

export async function readBodyBytes(request, maxBytes) {
  const contentEncoding = request.headers.get("Content-Encoding");
  if (contentEncoding !== null && contentEncoding.toLowerCase() !== "identity")
    throw new ApiError("unsupported_media_type");
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)
      throw new ApiError("request_too_large");
    if (contentLength === "0") return new Uint8Array();
  }
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ApiError("request_too_large");
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
  return bytes;
}

export async function readJsonBody(request, maxBytes) {
  const bytes = await readBodyBytes(request, maxBytes);
  if (bytes.byteLength === 0) throw new ApiError("malformed_request");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ApiError("malformed_request");
  }
  try {
    return parseJson(text);
  } catch {
    throw new ApiError("malformed_request");
  }
}

const decimal = /^(0|[1-9][0-9]*)$/;

export function parsePagination(url) {
  const values = new Map();
  for (const [key, value] of url.searchParams) {
    if ((key !== "after" && key !== "limit") || values.has(key))
      throw new ApiError("malformed_request");
    values.set(key, value);
  }
  const read = (name, fallback) => {
    if (!values.has(name)) return fallback;
    const raw = values.get(name);
    if (!decimal.test(raw)) throw new ApiError("malformed_request");
    const number = Number(raw);
    if (!Number.isSafeInteger(number)) throw new ApiError("malformed_request");
    return number;
  };
  const after = read("after", 0);
  const limit = read("limit", SYNC_LIMITS.maxPageChanges);
  if (limit < 1 || limit > SYNC_LIMITS.maxPageChanges)
    throw new ApiError("malformed_request");
  return { after, limit };
}
