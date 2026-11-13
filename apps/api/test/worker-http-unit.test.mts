import { expect, it } from "vitest";

import { SYNC_LIMITS } from "../../../packages/sync-contract/contract.mjs";
import {
  ALLOWED_ORIGIN,
  assertOrigin,
  readDevEnvironment,
  resolveIdentity,
} from "../http/auth.mjs";
import { ApiError } from "../http/errors.mjs";
import { parseJson, parsePagination, readJsonBody } from "../http/json.mjs";
import { errorResponse, jsonResponse, withCors } from "../http/respond.mjs";

const url = "http://127.0.0.1:8787/api/v1/sync/document";
const origin = "http://127.0.0.1:4300";
const identities = JSON.stringify({ token: "dev-alice" });
const env = {
  AUTH_MODE: "dev_bearer",
  DEV_AUTH: "true",
  APP_ENV: "local",
  DEV_AUTH_IDENTITIES: identities,
};
const authorized = () =>
  new Request(url, {
    headers: { Origin: origin, Authorization: "Bearer token" },
  });

it("rejects duplicate JSON keys at any nesting depth", () => {
  expect(() => parseJson('{"a":1,"a":2}')).toThrow("invalid JSON");
  expect(() => parseJson('{"a":{"b":1,"b":2}}')).toThrow("invalid JSON");
  expect(() => parseJson('{"a":1,"\\u0061":2}')).toThrow("invalid JSON");
  expect(() => parseJson('{"a":{"b":1,"\\u0062":2}}')).toThrow("invalid JSON");
  expect(() => parseJson('{"__proto__":1,"__proto__":2}')).toThrow(
    "invalid JSON",
  );
  expect(() => parseJson('{"a":[1,2,3]}')).not.toThrow();
  expect(parseJson('{"a":[1,2,3]}')).toEqual({ a: [1, 2, 3] });
  expect(() => parseJson("[".repeat(65) + "]".repeat(65))).toThrow(
    "invalid JSON",
  );
});

it("keeps the shared parser's depth, trailing-data, and grammar boundaries", () => {
  expect(parseJson('{"a":{"b":[1,2,{"c":"d"}]}}')).toEqual({
    a: { b: [1, 2, { c: "d" }] },
  });
  expect(parseJson(' \n\t{"a":1} \r\n')).toEqual({ a: 1 });
  let nested = parseJson("[".repeat(64) + "]".repeat(64));
  let depth = 0;
  while (Array.isArray(nested)) {
    depth += 1;
    nested = nested[0];
  }
  expect(depth).toBe(64);
  expect(() => parseJson("[".repeat(65) + "]".repeat(65))).toThrow(
    "invalid JSON",
  );

  for (const text of ["{}x", "{} {}", "[] []"]) {
    expect(() => parseJson(text)).toThrow("trailing data");
  }
  for (const text of ['{"a":1,}', "[1,]"]) {
    expect(() => parseJson(text)).toThrow("invalid JSON");
  }

  expect(parseJson("[0,-0,1,-1,10,1.5,1e2,1E+2,1e-2]")).toEqual([
    0, -0, 1, -1, 10, 1.5, 100, 100, 0.01,
  ]);
  for (const [text, message] of [
    ["01", "trailing data"],
    ["-01", "trailing data"],
    ["0x10", "trailing data"],
    ["+1", "invalid JSON"],
    [".5", "invalid JSON"],
    ["1.", "invalid JSON"],
    ["1e", "invalid JSON"],
    ["1e+", "invalid JSON"],
    ["Infinity", "invalid JSON"],
    ["NaN", "invalid JSON"],
  ]) {
    expect(() => parseJson(text)).toThrow(message);
  }

  expect(parseJson('"a\\"b\\\\c\\/d\\b\\f\\n\\r\\t\\u0041"')).toBe(
    'a"b\\c/d\b\f\n\r\tA',
  );
  for (const text of ['"\\x41"', '"abc', '"a\nb"']) {
    expect(() => parseJson(text)).toThrow("invalid JSON");
  }
});

it("keeps prototype keys as own data without polluting prototypes", () => {
  const value = parseJson('{"__proto__":{"polluted":true},"constructor":1}');
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(Object.hasOwn(value, "__proto__")).toBe(true);
  expect(Object.hasOwn(value, "constructor")).toBe(true);
  expect(value.__proto__).toEqual({ polluted: true });
  expect(value.constructor).toBe(1);
  expect(Object.keys(value)).toEqual(["__proto__", "constructor"]);
  expect({}.polluted).toBeUndefined();
  expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  expect(Object.hasOwn(parseJson("{}"), "constructor")).toBe(false);
});

it("rejects a streamed body above the limit and a declared oversized body", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(17)));
      controller.close();
    },
  });
  const streamed = new Request(url, { method: "POST", body: stream });
  await expect(readJsonBody(streamed, 16)).rejects.toMatchObject({
    code: "request_too_large",
  });

  const declared = new Request(url, {
    method: "POST",
    body: "{}",
    headers: { "Content-Length": "17" },
  });
  await expect(readJsonBody(declared, 16)).rejects.toMatchObject({
    code: "request_too_large",
  });
});

it("converts malformed wire input into the existing request errors", async () => {
  for (const body of [
    '{"a":1,"a":2}',
    "{}x",
    "not json",
    new Uint8Array([0xff]),
  ]) {
    const request = new Request(url, { method: "POST", body });
    await expect(readJsonBody(request, 1024)).rejects.toMatchObject({
      code: "malformed_request",
    });
  }

  const missing = new Request(url, { method: "POST" });
  await expect(readJsonBody(missing, 1024)).rejects.toMatchObject({
    code: "malformed_request",
  });

  const encoded = new Request(url, {
    method: "POST",
    body: "{}",
    headers: { "Content-Encoding": "gzip" },
  });
  await expect(readJsonBody(encoded, 1024)).rejects.toMatchObject({
    code: "unsupported_media_type",
  });
});

it("parses and bounds cursor pagination parameters", () => {
  expect(parsePagination(new URL(url))).toEqual({
    after: 0,
    limit: SYNC_LIMITS.maxPageChanges,
  });
  expect(
    parsePagination(
      new URL(`${url}?after=0&limit=${SYNC_LIMITS.maxPageChanges}`),
    ),
  ).toEqual({
    after: 0,
    limit: SYNC_LIMITS.maxPageChanges,
  });
  for (const query of [
    "after=01",
    "after=-1",
    "after=1.5",
    "after=9007199254740992",
    "limit=0",
    `limit=${SYNC_LIMITS.maxPageChanges + 1}`,
    "after=0&after=1",
    "after=0&unknown=1",
  ]) {
    expect(() => parsePagination(new URL(`${url}?${query}`))).toThrow(
      "malformed_request",
    );
  }
});

it("gates local development on explicit mode, environment, URL, and mapping", () => {
  expect(readDevEnvironment(authorized(), env)).not.toBeNull();
  for (const conflict of [
    { AUTH_MODE: undefined },
    { AUTH_MODE: "session" },
    { AUTH_MODE: "devbearer" },
    { AUTH_ORIGIN: "https://localhost:4300" },
    { RP_ID: "localhost" },
    { AUTH_RATE_LIMIT_KEY: "A".repeat(43) },
    { DEV_AUTH: "false" },
    { APP_ENV: "production" },
  ]) {
    expect(
      readDevEnvironment(authorized(), { ...env, ...conflict }),
    ).toBeNull();
  }
  expect(
    readDevEnvironment(
      new Request("https://example.test/api/v1/sync/document", {
        headers: { Origin: origin, Authorization: "Bearer token" },
      }),
      env,
    ),
  ).toBeNull();
  expect(
    readDevEnvironment(authorized(), {
      ...env,
      DEV_AUTH_IDENTITIES: "not-json",
    }),
  ).toBeNull();
  expect(
    readDevEnvironment(authorized(), { ...env, DEV_AUTH_IDENTITIES: "{}" }),
  ).toBeNull();
});

it("resolves only an exact mapped bearer and requires the exact Origin", () => {
  const dev = readDevEnvironment(authorized(), env);
  expect(resolveIdentity(authorized(), dev)).toEqual({
    token: "token",
    ownerId: "dev-alice",
  });
  const duplicated = new Request(url, {
    headers: {
      Origin: origin,
      Authorization: "Bearer token, Bearer token",
    },
  });
  expect(() => resolveIdentity(duplicated, dev)).toThrow("unauthorized");
  for (const authorization of [
    undefined,
    "Basic token",
    "Bearer unknown",
    "Bearer",
  ]) {
    const request = new Request(url, {
      headers: {
        Origin: origin,
        ...(authorization ? { Authorization: authorization } : {}),
      },
    });
    expect(() => resolveIdentity(request, dev)).toThrow("unauthorized");
  }
  expect(() => assertOrigin(authorized())).not.toThrow();
  expect(() =>
    assertOrigin(
      new Request(url, { headers: { Origin: "http://localhost:4300" } }),
    ),
  ).toThrow("origin_forbidden");
  expect(() => assertOrigin(new Request(url))).toThrow("origin_forbidden");
});

it("applies CORS after a gate response and removes disallowed allow headers", async () => {
  const allowed = withCors(
    jsonResponse(404, { error: { code: "not_found" } }),
    new Request(url, { headers: { Origin: origin } }),
  );
  expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
    ALLOWED_ORIGIN,
  );
  expect(allowed.headers.get("Vary")).toBe("Origin");

  const denied = withCors(
    jsonResponse(404, { error: { code: "not_found" } }),
    new Request(url, { headers: { Origin: "http://localhost:4300" } }),
  );
  expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
  expect(denied.headers.get("Vary")).toBe("Origin");
});

it("maps known errors and redacts unknown failures", async () => {
  const gap = errorResponse(new ApiError("log_gap", { cursor: 2 }));
  expect(gap.status).toBe(409);
  expect(await gap.json()).toEqual({
    error: { code: "log_gap" },
    cursor: 2,
  });
  const exhausted = errorResponse(new ApiError("sequence_exhausted"));
  expect(exhausted.status).toBe(503);
  expect(await exhausted.json()).toEqual({
    error: { code: "sequence_exhausted" },
  });
  const unknown = errorResponse(new Error("raw SQL detail"));
  expect(unknown.status).toBe(503);
  expect(await unknown.json()).toEqual({
    error: { code: "temporarily_unavailable" },
  });
});
