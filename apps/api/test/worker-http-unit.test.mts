import { expect, it } from "vitest";

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
  expect(() => parseJson('{"a":[1,2,3]}')).not.toThrow();
  expect(parseJson('{"a":[1,2,3]}')).toEqual({ a: [1, 2, 3] });
  expect(() => parseJson("[".repeat(65) + "]".repeat(65))).toThrow(
    "invalid JSON",
  );
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

it("parses and bounds cursor pagination parameters", () => {
  expect(parsePagination(new URL(`${url}?after=0&limit=100`))).toEqual({
    after: 0,
    limit: 100,
  });
  for (const query of [
    "after=01",
    "after=-1",
    "after=1.5",
    "after=9007199254740992",
    "limit=0",
    "limit=101",
    "after=0&after=1",
    "after=0&unknown=1",
  ]) {
    expect(() => parsePagination(new URL(`${url}?${query}`))).toThrow(
      "malformed_request",
    );
  }
});

it("gates local development on environment, URL, and a valid identity map", () => {
  expect(readDevEnvironment(authorized(), env)).not.toBeNull();
  expect(
    readDevEnvironment(authorized(), { ...env, DEV_AUTH: "false" }),
  ).toBeNull();
  expect(
    readDevEnvironment(authorized(), { ...env, APP_ENV: "production" }),
  ).toBeNull();
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
