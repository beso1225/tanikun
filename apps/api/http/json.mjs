import { SYNC_LIMITS } from "../../../packages/sync-contract/contract.mjs";
import { ApiError } from "./errors.mjs";

// Parse JSON without allowing duplicate object keys. JSON.parse keeps the last
// value for a repeated key, which would let a caller smuggle a second envelope
// or AAD value past the shared contract's exact-key checks.
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
    const value = Object.create(null);
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
      value[key] = this.parseValue();
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

export function parseJson(text) {
  return new Parser(text).parse();
}

export async function readJsonBody(request, maxBytes) {
  const contentEncoding = request.headers.get("Content-Encoding");
  if (contentEncoding !== null && contentEncoding.toLowerCase() !== "identity")
    throw new ApiError("unsupported_media_type");
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)
      throw new ApiError("request_too_large");
  }
  if (!request.body) throw new ApiError("malformed_request");
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
  const limit = read("limit", 100);
  if (limit < 1 || limit > SYNC_LIMITS.maxPageChanges)
    throw new ApiError("malformed_request");
  return { after, limit };
}
