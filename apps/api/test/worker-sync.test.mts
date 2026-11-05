import { applyD1Migrations, env, reset, SELF } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";

import fixture from "../../../docs/contracts/sync-v1.json";
import worker from "../bridges/worker.mjs";

const apiOrigin = "http://127.0.0.1:8787";
const allowedOrigin = "http://127.0.0.1:4300";
const alice = "Bearer local-fixture-token-alice";
const bob = "Bearer local-fixture-token-bob";

const headers = (authorization = alice, extra = {}) => ({
  Origin: allowedOrigin,
  Authorization: authorization,
  ...extra,
});

const request = (
  path,
  { authorization, headers: extraHeaders, ...init } = {},
) =>
  SELF.fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: headers(authorization, extraHeaders),
  });

const bootstrap = async (authorization = alice) => {
  const response = await request("/api/v1/sync/document", { authorization });
  expect(response.status).toBe(200);
  return response.json();
};

const envelopeFor = (documentId, envelope = fixture.envelope) => ({
  ...envelope,
  document_id: documentId,
  aad: { ...envelope.aad, document_id: documentId },
});

const append = (documentId, changes, authorization = alice) =>
  request(`/api/v1/sync/documents/${documentId}/changes`, {
    method: "POST",
    authorization,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes }),
  });

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

it("bootstraps once per authenticated dev identity and returns the same document", async () => {
  const firstResponse = await request("/api/v1/sync/document");
  expect(firstResponse.headers.get("Content-Type")).toBe("application/json");
  expect(firstResponse.headers.get("Cache-Control")).toBe("no-store");
  const first = await firstResponse.json();
  expect(first).toMatchObject({ cursor: 0 });
  expect(first.document_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  const second = await bootstrap();
  expect(second).toMatchObject({ document_id: first.document_id, cursor: 0 });
  const bobDocument = await bootstrap(bob);
  expect(bobDocument.document_id).not.toBe(first.document_id);
});

it("appends, replays duplicates, rejects conflicts, and pulls the ordered page", async () => {
  const { document_id: documentId } = await bootstrap();
  const envelope = envelopeFor(documentId);
  const first = await append(documentId, [envelope]);
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({
    document_id: documentId,
    accepted: [{ change_id: envelope.change_id, server_sequence: 1 }],
    cursor: 1,
  });

  const duplicate = await append(documentId, [envelope]);
  expect(duplicate.status).toBe(200);
  expect(await duplicate.json()).toMatchObject({
    accepted: [{ change_id: envelope.change_id, server_sequence: 1 }],
    cursor: 1,
  });

  const conflict = await append(documentId, [{ ...envelope, payload: "BQY=" }]);
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({ error: { code: "change_conflict" } });

  const page = await request(
    `/api/v1/sync/documents/${documentId}/changes?after=0&limit=100`,
  );
  expect(page.status).toBe(200);
  expect(await page.json()).toEqual({
    document_id: documentId,
    changes: [{ ...envelope, server_sequence: 1 }],
    next_cursor: 1,
    has_more: false,
    cursor: 1,
  });
});

it("keeps foreign documents indistinguishable and scopes every operation", async () => {
  const aliceDocument = await bootstrap();
  const bobDocument = await bootstrap(bob);
  const envelope = envelopeFor(aliceDocument.document_id);
  expect(
    (await append(aliceDocument.document_id, [envelope], bob)).status,
  ).toBe(404);
  expect(
    (
      await request(
        `/api/v1/sync/documents/${aliceDocument.document_id}/changes`,
        { authorization: bob },
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await request(
        `/api/v1/sync/documents/${aliceDocument.document_id}/changes?after=bad`,
        { authorization: bob },
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await append(
        bobDocument.document_id,
        [envelopeFor(bobDocument.document_id)],
        bob,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await request(
        `/api/v1/sync/documents/${bobDocument.document_id}/changes`,
        { authorization: alice },
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await request(
        `/api/v1/sync/documents/${bobDocument.document_id}/changes`,
        { authorization: bob },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await request(
        "/api/v1/sync/documents/33333333-3333-4333-8333-333333333333/changes",
      )
    ).status,
  ).toBe(404);
});

it("rejects missing, malformed, and unknown bearers before touching the route", async () => {
  const requests = [
    { Origin: allowedOrigin },
    { Origin: allowedOrigin, Authorization: "Basic local-fixture-token-alice" },
    { Origin: allowedOrigin, Authorization: "Bearer unknown" },
  ];
  for (const requestHeaders of requests) {
    const response = await SELF.fetch(`${apiOrigin}/api/v1/sync/document`, {
      headers: requestHeaders,
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(await response.json()).toEqual({ error: { code: "unauthorized" } });
  }
});

it("applies the exact-Origin CORS contract including preflight", async () => {
  const preflight = await SELF.fetch(
    `${apiOrigin}/api/v1/sync/documents/11111111-1111-4111-8111-111111111111/changes`,
    {
      method: "OPTIONS",
      headers: {
        Origin: allowedOrigin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    },
  );
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(
    allowedOrigin,
  );
  expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe("POST");
  expect(preflight.headers.get("Access-Control-Allow-Headers")).toBe(
    "Authorization, Content-Type",
  );
  expect(preflight.headers.get("Access-Control-Expose-Headers")).toBe(
    "Retry-After",
  );
  expect(preflight.headers.get("Access-Control-Max-Age")).toBe("0");
  expect(preflight.headers.get("Vary")).toBe("Origin");
  expect(preflight.headers.get("Cache-Control")).toBe("no-store");
  expect(preflight.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  expect(preflight.body).toBeNull();

  const invalidMethod = await SELF.fetch(
    `${apiOrigin}/api/v1/sync/documents/11111111-1111-4111-8111-111111111111/changes`,
    {
      method: "OPTIONS",
      headers: {
        Origin: allowedOrigin,
        "Access-Control-Request-Method": "PATCH",
      },
    },
  );
  expect(invalidMethod.status).toBe(403);
  expect(invalidMethod.headers.get("Access-Control-Allow-Origin")).toBe(
    allowedOrigin,
  );
  expect(await invalidMethod.json()).toEqual({
    error: { code: "origin_forbidden" },
  });

  const invalidHeader = await SELF.fetch(
    `${apiOrigin}/api/v1/sync/documents/11111111-1111-4111-8111-111111111111/changes`,
    {
      method: "OPTIONS",
      headers: {
        Origin: allowedOrigin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, x-extra",
      },
    },
  );
  expect(invalidHeader.status).toBe(403);

  const forbidden = await SELF.fetch(`${apiOrigin}/api/v1/sync/document`, {
    headers: {
      Origin: "http://localhost:4300",
      Authorization: alice,
    },
  });
  expect(forbidden.status).toBe(403);
  expect(forbidden.headers.get("Access-Control-Allow-Origin")).toBeNull();
  expect(forbidden.headers.get("Access-Control-Expose-Headers")).toBeNull();
  expect(forbidden.headers.get("Vary")).toBe("Origin");
  expect(forbidden.headers.get("Cache-Control")).toBe("no-store");
  expect(await forbidden.json()).toEqual({
    error: { code: "origin_forbidden" },
  });

  const missing = await SELF.fetch(`${apiOrigin}/api/v1/sync/document`, {
    headers: { Authorization: alice },
  });
  expect(missing.status).toBe(403);
  expect(missing.headers.get("Access-Control-Allow-Origin")).toBeNull();
});

it("reports cursor and log faults as redacted 409 responses", async () => {
  const { document_id: documentId } = await bootstrap();
  await append(documentId, [envelopeFor(documentId)]);
  const ahead = await request(
    `/api/v1/sync/documents/${documentId}/changes?after=2`,
  );
  expect(ahead.status).toBe(409);
  expect(await ahead.json()).toEqual({
    error: { code: "cursor_ahead" },
    cursor: 1,
  });

  await env.DB.prepare("DELETE FROM changes WHERE document_id = ?1")
    .bind(documentId)
    .run();
  const gap = await request(
    `/api/v1/sync/documents/${documentId}/changes?after=0`,
  );
  expect(gap.status).toBe(409);
  expect(await gap.json()).toEqual({ error: { code: "log_gap" }, cursor: 1 });

  const gapAppend = await append(documentId, [envelopeFor(documentId)]);
  expect(gapAppend.status).toBe(409);
  expect(await gapAppend.json()).toEqual({
    error: { code: "log_gap" },
    cursor: 1,
  });
});

const postRaw = (documentId, body, requestHeaders = {}) =>
  SELF.fetch(`${apiOrigin}/api/v1/sync/documents/${documentId}/changes`, {
    method: "POST",
    headers: headers(alice, {
      "Content-Type": "application/json",
      ...requestHeaders,
    }),
    body,
  });

const changeFor = (index, documentId) => {
  const changeId = index.toString(16).padStart(64, "0");
  return {
    ...fixture.envelope,
    document_id: documentId,
    change_id: changeId,
    aad: {
      ...fixture.envelope.aad,
      document_id: documentId,
      change_id: changeId,
    },
  };
};

it("pages in sequence order and reports the lookahead", async () => {
  const { document_id: documentId } = await bootstrap();
  const changes = [1, 2, 3].map((index) => changeFor(index, documentId));
  const uploaded = await append(documentId, changes);
  expect(uploaded.status).toBe(200);
  expect(await uploaded.json()).toMatchObject({
    accepted: changes.map((change, index) => ({
      change_id: change.change_id,
      server_sequence: index + 1,
    })),
    cursor: 3,
  });

  const first = await request(
    `/api/v1/sync/documents/${documentId}/changes?after=0&limit=2`,
  );
  expect(first.status).toBe(200);
  const firstBody = await first.json();
  expect(firstBody).toMatchObject({
    next_cursor: 2,
    has_more: true,
    cursor: 3,
  });
  expect(firstBody.changes).toHaveLength(2);
  expect(firstBody.changes.map((change) => change.server_sequence)).toEqual([
    1, 2,
  ]);

  const second = await request(
    `/api/v1/sync/documents/${documentId}/changes?after=2&limit=2`,
  );
  const secondBody = await second.json();
  expect(secondBody).toMatchObject({
    next_cursor: 3,
    has_more: false,
    cursor: 3,
  });
  expect(secondBody.changes).toHaveLength(1);
  expect(secondBody.changes[0].server_sequence).toBe(3);

  const empty = await request(
    `/api/v1/sync/documents/${documentId}/changes?after=3`,
  );
  expect(await empty.json()).toEqual({
    document_id: documentId,
    changes: [],
    next_cursor: 3,
    has_more: false,
    cursor: 3,
  });
});

it("rejects invalid query strings on an owned document", async () => {
  const { document_id: documentId } = await bootstrap();
  const paths = [
    "after=01",
    "after=-1",
    "after=1.5",
    "after=9007199254740992",
    "limit=0",
    "limit=101",
    "after=0&after=1",
    "after=0&unknown=1",
  ];
  for (const query of paths) {
    const response = await request(
      `/api/v1/sync/documents/${documentId}/changes?${query}`,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "malformed_request" },
    });
  }
});

it("rejects query strings on bootstrap and append before writing", async () => {
  const bootstrapQuery = await request("/api/v1/sync/document?after=0");
  expect(bootstrapQuery.status).toBe(400);
  expect(await bootstrapQuery.json()).toEqual({
    error: { code: "malformed_request" },
  });
  const empty = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM documents",
  ).first();
  expect(empty.count).toBe(0);

  const { document_id: documentId } = await bootstrap();
  const body = JSON.stringify({ changes: [envelopeFor(documentId)] });
  const appendQuery = await SELF.fetch(
    `${apiOrigin}/api/v1/sync/documents/${documentId}/changes?foo=1`,
    {
      method: "POST",
      headers: headers(alice, { "Content-Type": "application/json" }),
      body,
    },
  );
  expect(appendQuery.status).toBe(400);
  expect(await appendQuery.json()).toEqual({
    error: { code: "malformed_request" },
  });
  const changes = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM changes",
  ).first();
  expect(changes.count).toBe(0);

  const mediaTypeFirst = await SELF.fetch(
    `${apiOrigin}/api/v1/sync/documents/${documentId}/changes?foo=1`,
    {
      method: "POST",
      headers: headers(alice, { "Content-Type": "text/plain" }),
      body,
    },
  );
  expect(mediaTypeFirst.status).toBe(415);
});

it("rejects malformed bodies, duplicate keys, unknown fields, and limits", async () => {
  const { document_id: documentId } = await bootstrap();
  const envelope = envelopeFor(documentId);
  const changesJson = JSON.stringify([envelope]);
  const wireBody = `{"changes":${changesJson}}`;
  const cases = [
    ["not json", "malformed_request", 400],
    [JSON.stringify({ changes: [] }), "malformed_request", 400],
    [
      JSON.stringify({ changes: [envelope], extra: true }),
      "malformed_request",
      400,
    ],
    [
      JSON.stringify({ changes: [{ ...envelope, extra: true }] }),
      "malformed_request",
      400,
    ],
    [
      JSON.stringify({ changes: [envelope] }).replace(
        `"change_id":"${envelope.change_id}"`,
        `"change_id":"${envelope.change_id}","change_id":"${envelope.change_id}"`,
      ),
      "malformed_request",
      400,
    ],
    [
      JSON.stringify({ changes: [envelope] }).replace(
        '"api_version":1',
        '"api_version":1,"api_version":1',
      ),
      "malformed_request",
      400,
    ],
    [
      `{"changes":${changesJson},"\\u0063hanges":${changesJson}}`,
      "malformed_request",
      400,
    ],
    [
      wireBody.replace(
        '"payload":"AQIDBA=="',
        '"payload":"AQIDBA==","\\u0070ayload":"BQY="',
      ),
      "malformed_request",
      400,
    ],
    [
      wireBody.replace(
        '"api_version":1',
        '"api_version":1,"\\u0061pi_version":1',
      ),
      "malformed_request",
      400,
    ],
    [
      wireBody.replace(
        '{"changes":',
        '{"__proto__":{"polluted":true},"changes":',
      ),
      "malformed_request",
      400,
    ],
    [
      wireBody.replace(
        '{"changes":',
        '{"constructor":{"polluted":true},"changes":',
      ),
      "malformed_request",
      400,
    ],
    [
      wireBody.replace(
        '"envelope_version":1',
        '"__proto__":{"polluted":true},"envelope_version":1',
      ),
      "malformed_request",
      400,
    ],
    [
      wireBody.replace('"api_version":1', '"constructor":1,"api_version":1'),
      "malformed_request",
      400,
    ],
    [`${wireBody}x`, "malformed_request", 400],
    [
      JSON.stringify({ changes: Array.from({ length: 21 }, () => envelope) }),
      "request_too_large",
      413,
    ],
    [
      JSON.stringify({
        changes: [{ ...envelope, payload: btoa("x".repeat(262145)) }],
      }),
      "request_too_large",
      413,
    ],
  ];
  for (const [body, code, status] of cases) {
    const response = await postRaw(documentId, body);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code } });
  }
  expect({}.polluted).toBeUndefined();
  expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
});

it("rejects unsupported media types and content encodings", async () => {
  const { document_id: documentId } = await bootstrap();
  const body = JSON.stringify({ changes: [envelopeFor(documentId)] });
  for (const requestHeaders of [
    { "Content-Type": "text/plain" },
    { "Content-Type": "application/json", "Content-Encoding": "gzip" },
  ]) {
    const response = await postRaw(documentId, body, requestHeaders);
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      error: { code: "unsupported_media_type" },
    });
  }
  const missingType = await SELF.fetch(
    `${apiOrigin}/api/v1/sync/documents/${documentId}/changes`,
    {
      method: "POST",
      headers: headers(),
      body,
    },
  );
  expect(missingType.status).toBe(415);
  const accepted = await postRaw(documentId, body, {
    "Content-Type": "application/json; charset=utf-8",
  });
  expect(accepted.status).toBe(200);
});

it("returns route-specific method errors and unknown-route errors", async () => {
  const { document_id: documentId } = await bootstrap();
  const method = await SELF.fetch(
    `${apiOrigin}/api/v1/sync/documents/${documentId}/changes`,
    { method: "DELETE", headers: headers() },
  );
  expect(method.status).toBe(405);
  expect(method.headers.get("Allow")).toBe("GET, POST, OPTIONS");
  expect(await method.json()).toEqual({
    error: { code: "method_not_allowed" },
  });

  const bootstrapPost = await SELF.fetch(`${apiOrigin}/api/v1/sync/document`, {
    method: "POST",
    headers: headers(),
  });
  expect(bootstrapPost.status).toBe(405);
  expect(bootstrapPost.headers.get("Allow")).toBe("GET, OPTIONS");

  const unknown = await request("/api/v1/sync/unknown");
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toEqual({ error: { code: "not_found" } });

  const malformed = await request("/api/v1/sync/documents/not-a-uuid/changes");
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toEqual({
    error: { code: "malformed_request" },
  });
});

it("checks ownership before body syntax for foreign append targets", async () => {
  const aliceDocument = await bootstrap();
  const bobDocument = await bootstrap(bob);
  const response = await postRaw(
    bobDocument.document_id,
    JSON.stringify({ changes: [envelopeFor(aliceDocument.document_id)] }),
  );
  // Alice's bearer cannot write Bob's document even with a malformed route
  // envelope, and the response does not disclose the document's existence.
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: { code: "not_found" } });
});

it("returns one document for concurrent bootstrap calls", async () => {
  const documents = await Promise.all(
    Array.from({ length: 4 }, () => bootstrap()),
  );
  expect(new Set(documents.map((document) => document.document_id)).size).toBe(
    1,
  );
});

it("hides every sync route when the local gate is disabled or malformed", async () => {
  const gateRequests = [
    () =>
      new Request(`${apiOrigin}/api/v1/sync/document`, {
        headers: headers(),
      }),
    () =>
      new Request(
        `${apiOrigin}/api/v1/sync/documents/${fixture.document_id}/changes`,
        { headers: headers() },
      ),
    () =>
      new Request(
        `${apiOrigin}/api/v1/sync/documents/${fixture.document_id}/changes`,
        { method: "POST", headers: headers() },
      ),
  ];
  const configurations = [
    {
      DEV_AUTH: "false",
      APP_ENV: "local",
      DEV_AUTH_IDENTITIES: JSON.stringify({
        "local-fixture-token-alice": "dev-alice",
      }),
    },
    {
      DEV_AUTH: "true",
      APP_ENV: "production",
      DEV_AUTH_IDENTITIES: JSON.stringify({
        "local-fixture-token-alice": "dev-alice",
      }),
    },
    {
      DEV_AUTH: "true",
      APP_ENV: "local",
      DEV_AUTH_IDENTITIES: "not-json",
    },
    {
      DEV_AUTH: "true",
      APP_ENV: "local",
      DEV_AUTH_IDENTITIES: "{}",
    },
  ];
  for (const configuration of configurations) {
    for (const makeRequest of gateRequests) {
      const response = await worker.fetch(makeRequest(), configuration);
      expect(response.status).toBe(404);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        allowedOrigin,
      );
      expect(await response.json()).toEqual({ error: { code: "not_found" } });
    }
  }
});
