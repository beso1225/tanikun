export const SYNC_LIMITS = Object.freeze({
  maxSequence: Number.MAX_SAFE_INTEGER,
  maxPayloadBytes: 256 * 1024,
  maxRequestBytes: 4 * 1024 * 1024,
  maxResponseBytes: 8 * 1024 * 1024,
  maxBatchChanges: 20,
  maxPageChanges: 100,
});

export class SyncError extends Error {
  constructor(code, cursor) {
    super(code);
    this.name = "SyncError";
    this.code = code;
    if (cursor !== undefined) this.cursor = cursor;
  }
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();
const envelopeKeys = [
  "document_id",
  "change_id",
  "envelope_version",
  "payload_encoding",
  "crypto_algorithm",
  "key_version",
  "nonce",
  "aad",
  "payload",
];

export function requireDocumentId(value) {
  if (typeof value !== "string" || !uuid.test(value)) {
    throw new SyncError("malformed_request");
  }
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

export function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Bytes(value) {
  if (typeof value !== "string") throw new SyncError("malformed_request");
  try {
    const binary = atob(value);
    if (btoa(binary) !== value) throw new Error();
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new SyncError("malformed_request");
  }
}

// Validates an already parsed envelope. The HTTP boundary must reject duplicate
// JSON keys and enforce the streamed request-byte limit before parsing.
export function validateEnvelope(value, documentId) {
  requireDocumentId(documentId);
  if (
    !exactKeys(value, envelopeKeys) ||
    value.document_id !== documentId ||
    typeof value.change_id !== "string" ||
    !hash.test(value.change_id) ||
    value.envelope_version !== 1 ||
    value.payload_encoding !== "base64" ||
    !Number.isSafeInteger(value.key_version) ||
    value.key_version < 0 ||
    !exactKeys(value.aad, [
      "api_version",
      "document_id",
      "change_id",
      "envelope_version",
      "key_version",
    ]) ||
    value.aad.api_version !== 1 ||
    value.aad.document_id !== documentId ||
    value.aad.change_id !== value.change_id ||
    value.aad.envelope_version !== 1 ||
    value.aad.key_version !== value.key_version
  ) {
    throw new SyncError("malformed_request");
  }
  if (
    typeof value.payload === "string" &&
    value.payload.length > Math.ceil(SYNC_LIMITS.maxPayloadBytes / 3) * 4
  ) {
    throw new SyncError("request_too_large");
  }
  const payload = base64Bytes(value.payload);
  if (payload.length > SYNC_LIMITS.maxPayloadBytes)
    throw new SyncError("request_too_large");
  if (payload.length === 0) throw new SyncError("malformed_request");
  let nonce = null;
  if (value.crypto_algorithm === "none") {
    if (value.key_version !== 0 || value.nonce !== null)
      throw new SyncError("malformed_request");
  } else if (value.crypto_algorithm === "AES-256-GCM") {
    nonce = base64Bytes(value.nonce);
    if (value.key_version === 0 || nonce.length !== 12 || payload.length < 17) {
      throw new SyncError("malformed_request");
    }
  } else {
    throw new SyncError("malformed_request");
  }
  const canonical = encoder.encode(
    JSON.stringify([
      documentId,
      value.change_id,
      1,
      "base64",
      value.crypto_algorithm,
      value.key_version,
      value.nonce,
      [1, documentId, value.change_id, 1, value.key_version],
      value.payload,
    ]),
  );
  return { wire: value, payload, nonce, canonical };
}

// Validates a stored envelope returned by pull. The sequence is transport
// metadata added by the server; the rest of the envelope is the append shape.
export function validateStoredEnvelope(value, documentId) {
  if (!exactKeys(value, [...envelopeKeys, "server_sequence"])) {
    throw new SyncError("malformed_request");
  }
  const { server_sequence, ...wire } = value;
  if (
    !Number.isSafeInteger(server_sequence) ||
    server_sequence < 1 ||
    server_sequence > SYNC_LIMITS.maxSequence
  ) {
    throw new SyncError("malformed_request");
  }
  return { ...validateEnvelope(wire, documentId), server_sequence };
}

export function validateAppend(changes, documentId) {
  if (!Array.isArray(changes) || changes.length === 0)
    throw new SyncError("malformed_request");
  if (changes.length > SYNC_LIMITS.maxBatchChanges)
    throw new SyncError("request_too_large");
  const validated = changes.map((change) =>
    validateEnvelope(change, documentId),
  );
  if (
    encoder.encode(JSON.stringify({ changes })).length >
    SYNC_LIMITS.maxRequestBytes
  ) {
    throw new SyncError("request_too_large");
  }
  return validated;
}

export function envelopeFromRow(row) {
  return {
    document_id: row.document_id,
    change_id: row.change_id,
    envelope_version: row.envelope_version,
    payload_encoding: "base64",
    crypto_algorithm: row.crypto_alg,
    key_version: row.key_version,
    nonce: row.nonce === null ? null : bytesToBase64(new Uint8Array(row.nonce)),
    aad: {
      api_version: 1,
      document_id: row.document_id,
      change_id: row.change_id,
      envelope_version: row.envelope_version,
      key_version: row.key_version,
    },
    payload: bytesToBase64(new Uint8Array(row.payload)),
    server_sequence: row.seq,
  };
}

// Response bodies are wire input too: reject duplicate object keys before
// JSON.parse can apply its last-wins rule. Keeping this in the shared contract
// lets the browser reuse the same wire validation instead of a browser-only
// copy.
class Parser {
  constructor(text) {
    this.text = text;
    this.index = 0;
    this.depth = 0;
  }

  parse() {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.text.length) throw new SyntaxError("trailing data");
    return value;
  }

  fail() {
    throw new SyntaxError("invalid JSON");
  }

  skipWhitespace() {
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
        this.index += 1;
      } else {
        break;
      }
    }
  }

  parseValue() {
    this.skipWhitespace();
    if (this.depth >= 64) this.fail();
    this.depth += 1;
    try {
      const character = this.text[this.index];
      if (character === '"') return this.parseString();
      if (character === "{") return this.parseObject();
      if (character === "[") return this.parseArray();
      if (character === "t") return this.parseLiteral("true", true);
      if (character === "f") return this.parseLiteral("false", false);
      if (character === "n") return this.parseLiteral("null", null);
      if (character === "-" || (character >= "0" && character <= "9"))
        return this.parseNumber();
      this.fail();
    } finally {
      this.depth -= 1;
    }
  }

  parseLiteral(literal, value) {
    if (!this.text.startsWith(literal, this.index)) this.fail();
    this.index += literal.length;
    return value;
  }

  parseString() {
    const start = this.index;
    if (this.text[start] !== '"') this.fail();
    this.index += 1;
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      if (code === 0x22) {
        this.index += 1;
        return JSON.parse(this.text.slice(start, this.index));
      }
      if (code === 0x5c) {
        this.index += 1;
        if (this.index >= this.text.length) this.fail();
        const escape = this.text[this.index];
        if (escape === "u") {
          this.index += 1;
          for (let offset = 0; offset < 4; offset += 1) {
            if (!/[0-9a-fA-F]/.test(this.text[this.index + offset] ?? ""))
              this.fail();
          }
          this.index += 4;
        } else if ('"\\/bfnrt'.includes(escape)) {
          this.index += 1;
        } else {
          this.fail();
        }
        continue;
      }
      if (code < 0x20) this.fail();
      this.index += 1;
    }
    this.fail();
  }

  parseNumber() {
    const start = this.index;
    if (this.text[this.index] === "-") this.index += 1;
    if (this.text[this.index] === "0") {
      this.index += 1;
    } else if (this.text[this.index] >= "1" && this.text[this.index] <= "9") {
      while (this.text[this.index] >= "0" && this.text[this.index] <= "9")
        this.index += 1;
    } else {
      this.fail();
    }
    if (this.text[this.index] === ".") {
      this.index += 1;
      if (!this.isDigit(this.text[this.index])) this.fail();
      while (this.isDigit(this.text[this.index])) this.index += 1;
    }
    if (this.text[this.index] === "e" || this.text[this.index] === "E") {
      this.index += 1;
      if (this.text[this.index] === "+" || this.text[this.index] === "-")
        this.index += 1;
      if (!this.isDigit(this.text[this.index])) this.fail();
      while (this.isDigit(this.text[this.index])) this.index += 1;
    }
    return Number(this.text.slice(start, this.index));
  }

  isDigit(character) {
    return character >= "0" && character <= "9";
  }

  parseArray() {
    this.index += 1;
    const value = [];
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return value;
    }
    while (true) {
      value.push(this.parseValue());
      this.skipWhitespace();
      if (this.text[this.index] === ",") {
        this.index += 1;
        continue;
      }
      if (this.text[this.index] === "]") {
        this.index += 1;
        return value;
      }
      this.fail();
    }
  }

  parseObject() {
    this.index += 1;
    const value = {};
    const keys = new Set();
    this.skipWhitespace();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return value;
    }
    while (true) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') this.fail();
      const key = this.parseString();
      if (keys.has(key)) this.fail();
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") this.fail();
      this.index += 1;
      Object.defineProperty(value, key, {
        value: this.parseValue(),
        enumerable: true,
        configurable: true,
        writable: true,
      });
      this.skipWhitespace();
      if (this.text[this.index] === ",") {
        this.index += 1;
        continue;
      }
      if (this.text[this.index] === "}") {
        this.index += 1;
        return value;
      }
      this.fail();
    }
  }
}

export function parseWireJson(text) {
  return new Parser(text).parse();
}
