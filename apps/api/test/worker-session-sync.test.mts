import { applyD1Migrations, env, reset } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import fixture from "../../../docs/contracts/sync-v1.json";
import worker from "../bridges/worker.mjs";
import { base64Url, bytes, countRows, queryFirst } from "./auth-fixtures.mts";
import {
  buildRegistrationResponse,
  createCredential,
} from "./webauthn-ceremony-fixtures.mjs";

const ORIGIN = "https://localhost:4300";
const DEV_ORIGIN = "http://127.0.0.1:4300";
const DEV_API_ORIGIN = "http://127.0.0.1:8787";
const SESSION = "__Host-tanikun_session";
const BINDING = "__Host-tanikun_binding";
const RATE_KEY = base64Url(bytes(32, 0x7a));

function sessionEnv(overrides = {}) {
  return {
    ...env,
    DB: env.DB,
    AUTH_MODE: "session",
    APP_ENV: "test",
    DEV_AUTH: undefined,
    DEV_AUTH_IDENTITIES: undefined,
    AUTH_ORIGIN: ORIGIN,
    RP_ID: "localhost",
    AUTH_RATE_LIMIT_KEY: RATE_KEY,
    TEST_NEW_DOCUMENT_ID: undefined,
    ...overrides,
  };
}

function devEnv(overrides = {}) {
  return {
    DB: env.DB,
    AUTH_MODE: "dev_bearer",
    APP_ENV: "local",
    DEV_AUTH: "true",
    DEV_AUTH_IDENTITIES: JSON.stringify({
      "local-fixture-token-alice": "dev-alice",
      "local-fixture-token-bob": "dev-bob",
    }),
    AUTH_ORIGIN: undefined,
    RP_ID: undefined,
    AUTH_RATE_LIMIT_KEY: undefined,
    TEST_NEW_DOCUMENT_ID: undefined,
    ...overrides,
  };
}

function request(
  path,
  { method = "GET", body, cookie, csrf, origin = ORIGIN, headers = {} } = {},
) {
  const requestHeaders = new Headers(headers);
  if (origin !== null) requestHeaders.set("Origin", origin);
  if (cookie !== undefined) requestHeaders.set("Cookie", cookie);
  if (csrf !== undefined) requestHeaders.set("X-CSRF-Token", csrf);
  if (body !== undefined)
    requestHeaders.set("Content-Type", "application/json");
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: requestHeaders,
    ...(body === undefined
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

function setCookies(response) {
  return typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : (response.headers.get("Set-Cookie") ?? "")
        .split(/,\s*(?=__Host-)/u)
        .filter(Boolean);
}

function cookieValue(response, name) {
  const prefix = `${name}=`;
  for (const header of setCookies(response)) {
    if (!header.startsWith(prefix)) continue;
    return header.slice(prefix.length).split(";", 1)[0];
  }
  return null;
}

async function register(accountEnv, { idFill = 1, displayName } = {}) {
  const optionsResponse = await worker.fetch(
    request("/api/v1/auth/register/options", {
      method: "POST",
      body: displayName === undefined ? {} : { display_name: displayName },
    }),
    accountEnv,
  );
  expect(optionsResponse.status).toBe(200);
  const options = await optionsResponse.json();
  const binding = cookieValue(optionsResponse, BINDING);
  expect(binding).toHaveLength(43);

  const credential = await createCredential({ idFill, idLength: 16 });
  const registration = await buildRegistrationResponse({
    challenge: options.publicKey.challenge,
    rpID: "localhost",
    origin: ORIGIN,
    credential,
  });
  const verifyResponse = await worker.fetch(
    request("/api/v1/auth/register/verify", {
      method: "POST",
      body: {
        challenge_id: options.challenge_id,
        credential: registration,
      },
      cookie: `${BINDING}=${binding}`,
    }),
    accountEnv,
  );
  expect(verifyResponse.status).toBe(200);
  const verifyBody = await verifyResponse.json();
  const session = cookieValue(verifyResponse, SESSION);
  expect(session).toHaveLength(43);
  return {
    credential,
    options,
    binding,
    session,
    csrf: verifyBody.session.csrf_token,
    handle: verifyBody.session.account.handle,
    cookie: `${SESSION}=${session}; ${BINDING}=${binding}`,
  };
}

function syncRequest(account, path, options = {}) {
  return request(path, {
    cookie: account.cookie,
    ...(options.method === "POST" ? { csrf: account.csrf } : {}),
    ...options,
  });
}

async function bootstrap(account) {
  const response = await worker.fetch(
    syncRequest(account, "/api/v1/sync/document", { method: "POST" }),
    sessionEnv(),
  );
  expect(response.status).toBe(200);
  return response.json();
}

const envelopeFor = (documentId, envelope = fixture.envelope) => ({
  ...envelope,
  document_id: documentId,
  aad: { ...envelope.aad, document_id: documentId },
});

function append(account, documentId, changes) {
  return worker.fetch(
    syncRequest(account, `/api/v1/sync/documents/${documentId}/changes`, {
      method: "POST",
      body: { changes },
    }),
    sessionEnv(),
  );
}

function pull(account, documentId, query = "after=0&limit=100") {
  return worker.fetch(
    syncRequest(
      account,
      `/api/v1/sync/documents/${documentId}/changes?${query}`,
    ),
    sessionEnv(),
  );
}

async function userIdFor(handle) {
  return (await queryFirst("SELECT id FROM users WHERE handle = ?1", handle))
    .id;
}

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("session principal sync authorization", () => {
  it("rejects dev-only configuration in session mode before auth or routing", async () => {
    const alice = await register(sessionEnv(), { idFill: 0x7f });
    for (const overrides of [
      { TEST_NEW_DOCUMENT_ID: fixture.document_id },
      { DEV_AUTH: "true" },
      {
        DEV_AUTH_IDENTITIES: JSON.stringify({
          "local-fixture-token-alice": "dev-alice",
        }),
      },
      { APP_ENV: "production" },
      { AUTH_ORIGIN: "https://example.test" },
      { RP_ID: "example.test" },
      { AUTH_RATE_LIMIT_KEY: "A".repeat(42) },
    ]) {
      for (const response of [
        await worker.fetch(
          syncRequest(alice, "/api/v1/sync/document", { method: "POST" }),
          sessionEnv(overrides),
        ),
        await worker.fetch(
          request("/api/v1/auth/session", {
            cookie: alice.cookie,
          }),
          sessionEnv(overrides),
        ),
      ]) {
        expect(response.status).toBe(404);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
        expect(await response.json()).toEqual({
          error: { code: "not_found" },
        });
      }
    }
  });

  it("provisions exactly one server-owned document for the session account", async () => {
    const alice = await register(sessionEnv(), {
      idFill: 1,
      displayName: "Alice Session",
    });
    const aliceId = await userIdFor(alice.handle);
    const document = await queryFirst(
      "SELECT id, owner_id FROM documents WHERE owner_id = ?1",
      aliceId,
    );
    expect(document.owner_id).toBe(aliceId);

    const first = await worker.fetch(
      syncRequest(alice, "/api/v1/sync/document", { method: "POST" }),
      sessionEnv(),
    );
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    expect(first.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(first.headers.get("WWW-Authenticate")).toBeNull();
    expect(setCookies(first)).toEqual([]);
    expect(await first.json()).toEqual({
      document_id: document.id,
      cursor: 0,
    });

    const concurrent = await Promise.all(
      Array.from({ length: 6 }, () =>
        worker.fetch(
          syncRequest(alice, "/api/v1/sync/document", { method: "POST" }),
          sessionEnv(),
        ),
      ),
    );
    expect(
      new Set(
        await Promise.all(
          concurrent.map(async (response) => {
            expect(response.status).toBe(200);
            return (await response.json()).document_id;
          }),
        ),
      ),
    ).toEqual(new Set([document.id]));
  });

  it("creates a missing document only for the existing session user, never a caller owner", async () => {
    const alice = await register(sessionEnv(), { idFill: 2 });
    const aliceId = await userIdFor(alice.handle);
    const original = await queryFirst(
      "SELECT id FROM documents WHERE owner_id = ?1",
      aliceId,
    );
    await env.DB.prepare("DELETE FROM documents WHERE owner_id = ?1")
      .bind(aliceId)
      .run();
    const before = await countRows("documents");

    const response = await worker.fetch(
      syncRequest(alice, "/api/v1/sync/document", { method: "POST" }),
      sessionEnv(),
    );
    expect(response.status).toBe(200);
    const provisioned = await response.json();
    expect(provisioned).toMatchObject({ cursor: 0 });
    expect(provisioned.document_id).not.toBe(original.id);
    expect(await countRows("documents")).toBe(before + 1);
    expect(
      await queryFirst(
        "SELECT owner_id FROM documents WHERE id = ?1",
        provisioned.document_id,
      ),
    ).toEqual({ owner_id: aliceId });

    const repeated = await worker.fetch(
      syncRequest(alice, "/api/v1/sync/document", { method: "POST" }),
      sessionEnv(),
    );
    expect(await repeated.json()).toEqual(provisioned);

    for (const query of [
      "owner_id=dev-alice",
      "user_id=dev-alice",
      "after=0",
    ]) {
      const rejected = await worker.fetch(
        syncRequest(alice, `/api/v1/sync/document?${query}`, {
          method: "POST",
        }),
        sessionEnv(),
      );
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({
        error: { code: "malformed_request" },
      });
    }

    for (const body of [
      { owner_id: "dev-alice" },
      { user_id: "dev-alice" },
      { document_id: original.id },
    ]) {
      const rejected = await worker.fetch(
        syncRequest(alice, "/api/v1/sync/document", {
          method: "POST",
          body,
        }),
        sessionEnv(),
      );
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({
        error: { code: "malformed_request" },
      });
    }
  });

  it("keeps foreign and missing documents indistinguishable for read and write", async () => {
    const alice = await register(sessionEnv(), { idFill: 3 });
    const bob = await register(sessionEnv(), { idFill: 4 });
    const aliceDocument = await bootstrap(alice);
    const bobDocument = await bootstrap(bob);
    expect(aliceDocument.document_id).not.toBe(bobDocument.document_id);

    const before = await countRows("changes");
    const envelope = envelopeFor(aliceDocument.document_id);
    const foreignRead = await pull(bob, aliceDocument.document_id);
    const missingRead = await pull(bob, "33333333-3333-4333-8333-333333333333");
    const foreignWrite = await append(bob, aliceDocument.document_id, [
      envelope,
    ]);
    const missingWrite = await append(
      bob,
      "33333333-3333-4333-8333-333333333333",
      [envelope],
    );
    for (const response of [
      foreignRead,
      missingRead,
      foreignWrite,
      missingWrite,
    ]) {
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("WWW-Authenticate")).toBeNull();
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(await response.json()).toEqual({ error: { code: "not_found" } });
    }
    expect(await countRows("changes")).toBe(before);

    const own = await append(bob, bobDocument.document_id, [
      envelopeFor(bobDocument.document_id),
    ]);
    expect(own.status).toBe(200);
    const unchanged = await pull(alice, aliceDocument.document_id);
    expect((await unchanged.json()).changes).toEqual([]);
  });

  it("never falls back across modes, Authorization headers, or dev cookies", async () => {
    const alice = await register(sessionEnv(), { idFill: 5 });
    const document = await bootstrap(alice);
    expect(await userIdFor(alice.handle)).toBe(
      (
        await queryFirst(
          "SELECT owner_id FROM documents WHERE id = ?1",
          document.document_id,
        )
      ).owner_id,
    );

    const authorization = await worker.fetch(
      request("/api/v1/sync/document", {
        method: "POST",
        cookie: alice.cookie,
        csrf: alice.csrf,
        headers: { Authorization: "Bearer local-fixture-token-alice" },
      }),
      sessionEnv(),
    );
    expect(authorization.status).toBe(400);
    expect(await authorization.json()).toEqual({
      error: { code: "malformed_request" },
    });
    expect(authorization.headers.get("WWW-Authenticate")).toBeNull();

    const devTokenAsSession = await worker.fetch(
      request("/api/v1/sync/document", {
        method: "POST",
        csrf: alice.csrf,
        headers: { Authorization: "Bearer local-fixture-token-alice" },
      }),
      sessionEnv(),
    );
    expect(devTokenAsSession.status).toBe(400);

    const sessionCookieAsDev = await worker.fetch(
      new Request(`${DEV_API_ORIGIN}/api/v1/sync/document`, {
        headers: {
          Origin: DEV_ORIGIN,
          Cookie: alice.cookie,
        },
      }),
      devEnv(),
    );
    expect(sessionCookieAsDev.status).toBe(401);
    expect(sessionCookieAsDev.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(await sessionCookieAsDev.json()).toEqual({
      error: { code: "unauthorized" },
    });

    const devValidWithSessionCookie = await worker.fetch(
      new Request(`${DEV_API_ORIGIN}/api/v1/sync/document`, {
        headers: {
          Origin: DEV_ORIGIN,
          Cookie: alice.cookie,
          Authorization: "Bearer local-fixture-token-alice",
        },
      }),
      devEnv(),
    );
    expect(devValidWithSessionCookie.status).toBe(200);
    const devDocument = await devValidWithSessionCookie.json();
    expect(devDocument).toMatchObject({ cursor: 0 });
    // The dev path ignored the cookie and provisioned/read the dev owner's
    // document, which is distinct from Alice's session document.
    expect(devDocument.document_id).not.toBe(document.document_id);
  });

  it("rejects missing, malformed, expired, revoked, and duplicate cookies without writes", async () => {
    const alice = await register(sessionEnv(), { idFill: 6 });
    const document = await bootstrap(alice);
    const aliceId = await userIdFor(alice.handle);
    const before = await countRows("changes");
    const sessionDigest = await queryFirst(
      "SELECT digest FROM sessions WHERE user_id = ?1",
      aliceId,
    );
    expect(sessionDigest.digest).toHaveLength(32);

    const cases = [
      {
        label: "missing",
        headers: {},
        cookie: undefined,
        expectedCookie: null,
      },
      {
        label: "malformed",
        cookie: `${SESSION}=not-a-token`,
        expectedCookie: true,
      },
      {
        label: "duplicate",
        cookie: `${alice.cookie}; ${SESSION}=${alice.session}`,
        expectedCookie: true,
      },
      {
        label: "unknown",
        cookie: `${SESSION}=${"A".repeat(43)}`,
        expectedCookie: true,
      },
    ];
    for (const testCase of cases) {
      const response = await worker.fetch(
        request(`/api/v1/sync/documents/${document.document_id}/changes`, {
          cookie: testCase.cookie,
          method: "POST",
          csrf: alice.csrf,
          body: { changes: [] },
        }),
        sessionEnv(),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBeNull();
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(await response.json()).toEqual({
        error: { code: "unauthorized" },
      });
      const cleared = setCookies(response).find((value) =>
        value.startsWith("__Host-tanikun_session="),
      );
      expect([
        cleared !== undefined,
        typeof cleared === "string" && cleared.includes("Max-Age=0"),
      ]).toEqual([
        testCase.expectedCookie === true,
        testCase.expectedCookie === true,
      ]);
    }

    const expiredAt = Date.now() - 43_200_001;
    await env.DB.prepare(
      "UPDATE sessions SET created_at = ?2, last_seen_at = ?2, expires_at = ?3, idle_expires_at = ?4 WHERE user_id = ?1",
    )
      .bind(aliceId, expiredAt, expiredAt + 43_200_000, expiredAt + 1_800_000)
      .run();
    const expired = await pull(alice, document.document_id);
    expect(expired.status).toBe(401);
    expect(setCookies(expired)).toContain(
      "__Host-tanikun_session=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    );

    const liveAt = Date.now() - 1_000;
    await env.DB.prepare(
      "UPDATE sessions SET created_at = ?2, last_seen_at = ?2, expires_at = ?3, idle_expires_at = ?4, revoked_at = ?5, revoke_reason = 'logout_all' WHERE user_id = ?1",
    )
      .bind(
        aliceId,
        liveAt,
        liveAt + 43_200_000,
        liveAt + 1_800_000,
        liveAt + 1_000,
      )
      .run();
    const revoked = await pull(alice, document.document_id);
    expect(revoked.status).toBe(401);
    expect(await countRows("changes")).toBe(before);
  });

  it("preserves append idempotency, conflicts, cursor semantics, and page replay", async () => {
    const alice = await register(sessionEnv(), { idFill: 7 });
    const { document_id: documentId } = await bootstrap(alice);
    const first = envelopeFor(documentId);
    const second = {
      ...fixture.second_envelope,
      document_id: documentId,
      aad: { ...fixture.second_envelope.aad, document_id: documentId },
    };

    const uploaded = await append(alice, documentId, [first, second]);
    expect(uploaded.status).toBe(200);
    const uploadedBody = await uploaded.json();
    expect(uploadedBody).toEqual({
      document_id: documentId,
      accepted: [
        { change_id: first.change_id, server_sequence: 1 },
        { change_id: second.change_id, server_sequence: 2 },
      ],
      cursor: 2,
    });

    const duplicate = await append(alice, documentId, [first, second]);
    expect(await duplicate.json()).toEqual(uploadedBody);

    const conflict = await append(alice, documentId, [
      { ...first, payload: "BQY=" },
    ]);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: { code: "change_conflict" },
    });

    const firstPage = await pull(alice, documentId, "after=0&limit=1");
    const firstPageBody = await firstPage.json();
    expect(firstPageBody).toMatchObject({
      next_cursor: 1,
      has_more: true,
      cursor: 2,
    });
    expect(firstPageBody.changes).toHaveLength(1);
    expect(firstPageBody.changes[0].server_sequence).toBe(1);
    const secondPage = await pull(alice, documentId, "after=1&limit=1");
    const secondPageBody = await secondPage.json();
    expect(secondPageBody).toMatchObject({
      next_cursor: 2,
      has_more: false,
      cursor: 2,
    });
    expect(secondPageBody.changes).toHaveLength(1);
    expect(secondPageBody.changes[0].server_sequence).toBe(2);
    const repeat = await pull(alice, documentId, "after=1&limit=1");
    expect(await repeat.json()).toEqual(secondPageBody);

    const ahead = await pull(alice, documentId, "after=3");
    expect(ahead.status).toBe(409);
    expect(await ahead.json()).toEqual({
      error: { code: "cursor_ahead" },
      cursor: 2,
    });

    await env.DB.prepare("DELETE FROM changes WHERE document_id = ?1")
      .bind(documentId)
      .run();
    const gap = await pull(alice, documentId);
    expect(gap.status).toBe(409);
    expect(await gap.json()).toEqual({ error: { code: "log_gap" }, cursor: 2 });
    const gapAppend = await append(alice, documentId, [first]);
    expect(gapAppend.status).toBe(409);
    expect(await gapAppend.json()).toEqual({
      error: { code: "log_gap" },
      cursor: 2,
    });
  });

  it("enforces the canonical session sync window before ownership or body work", async () => {
    const alice = await register(sessionEnv(), { idFill: 8 });
    const { document_id: documentId } = await bootstrap(alice);
    // Bootstrap already charged the first request in this fixed window. The
    // canonical limit is 120, so 119 more pulls are admitted and the next one
    // is blocked.
    for (let index = 0; index < 119; index += 1) {
      const response = await pull(alice, documentId);
      expect(response.status).toBe(200);
    }
    const blocked = await pull(alice, documentId);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toMatch(/^[1-9][0-9]*$/u);
    expect(blocked.headers.get("WWW-Authenticate")).toBeNull();
    expect(blocked.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await blocked.json()).toEqual({ error: { code: "rate_limited" } });

    // The session budget is already exhausted, but this request still cannot
    // reveal ownership or parse a body; the rate check stays before both.
    const foreign = await pull(alice, "33333333-3333-4333-8333-333333333333");
    expect(foreign.status).toBe(429);
  });

  it("uses POST-only bootstrap and rejects origin, CSRF, method, query, and body violations", async () => {
    const alice = await register(sessionEnv(), { idFill: 9 });
    const { document_id: documentId } = await bootstrap(alice);
    const before = await countRows("documents");

    const wrongMethod = await worker.fetch(
      syncRequest(alice, "/api/v1/sync/document"),
      sessionEnv(),
    );
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("Allow")).toBe("POST");
    expect(wrongMethod.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await wrongMethod.json()).toEqual({
      error: { code: "method_not_allowed" },
    });

    const options = await worker.fetch(
      request("/api/v1/sync/document", {
        method: "OPTIONS",
        headers: { "Access-Control-Request-Method": "POST" },
      }),
      sessionEnv(),
    );
    expect(options.status).toBe(405);
    expect(options.headers.get("Allow")).toBe("POST");
    expect(options.headers.get("Access-Control-Allow-Origin")).toBeNull();

    for (const origin of [
      null,
      "https://evil.example",
      "http://127.0.0.1:4300",
    ]) {
      const response = await worker.fetch(
        request("/api/v1/sync/document", {
          method: "POST",
          cookie: alice.cookie,
          csrf: alice.csrf,
          origin,
        }),
        sessionEnv(),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: { code: "origin_forbidden" },
      });
    }

    const crossSite = await worker.fetch(
      request("/api/v1/sync/document", {
        method: "POST",
        cookie: alice.cookie,
        csrf: alice.csrf,
        headers: { "Sec-Fetch-Site": "cross-site" },
      }),
      sessionEnv(),
    );
    expect(crossSite.status).toBe(403);
    expect(await crossSite.json()).toEqual({
      error: { code: "origin_forbidden" },
    });

    const duplicateOrigin = await worker.fetch(
      request("/api/v1/sync/document", {
        method: "POST",
        cookie: alice.cookie,
        csrf: alice.csrf,
        origin: `${ORIGIN}, ${ORIGIN}`,
      }),
      sessionEnv(),
    );
    expect(duplicateOrigin.status).toBe(403);

    const noCsrf = await worker.fetch(
      request("/api/v1/sync/document", {
        method: "POST",
        cookie: alice.cookie,
      }),
      sessionEnv(),
    );
    expect(noCsrf.status).toBe(403);
    expect(await noCsrf.json()).toEqual({ error: { code: "csrf_forbidden" } });

    const wrongCsrf = await worker.fetch(
      request("/api/v1/sync/document", {
        method: "POST",
        cookie: alice.cookie,
        csrf: "A".repeat(43),
      }),
      sessionEnv(),
    );
    expect(wrongCsrf.status).toBe(403);

    for (const contentType of [undefined, "text/plain"]) {
      const headers = {
        Origin: ORIGIN,
        Cookie: alice.cookie,
        "X-CSRF-Token": alice.csrf,
        ...(contentType === undefined ? {} : { "Content-Type": contentType }),
      };
      const raw = new Request(
        `${ORIGIN}/api/v1/sync/documents/${documentId}/changes`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ changes: [] }),
        },
      );
      const response = await worker.fetch(raw, sessionEnv());
      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({
        error: { code: "unsupported_media_type" },
      });
    }

    const emptyBootstrap = await worker.fetch(
      request("/api/v1/sync/document", {
        method: "POST",
        cookie: alice.cookie,
        csrf: alice.csrf,
        headers: { "Content-Length": "0" },
      }),
      sessionEnv(),
    );
    expect(emptyBootstrap.status).toBe(200);
    expect(await emptyBootstrap.json()).toEqual({
      document_id: documentId,
      cursor: 0,
    });

    const bodyBootstrap = await worker.fetch(
      request("/api/v1/sync/document", {
        method: "POST",
        cookie: alice.cookie,
        csrf: alice.csrf,
        body: "{}",
      }),
      sessionEnv(),
    );
    expect(bodyBootstrap.status).toBe(400);
    expect(await bodyBootstrap.json()).toEqual({
      error: { code: "malformed_request" },
    });
    expect(await countRows("documents")).toBe(before);
  });

  it("fails closed on session or rate storage failure without bypass or cookie clear", async () => {
    const alice = await register(sessionEnv(), { idFill: 12 });
    const { document_id: documentId } = await bootstrap(alice);
    for (const environment of [
      sessionEnv({ DB: undefined }),
      sessionEnv({
        DB: {
          prepare: () => {
            throw new Error("canary");
          },
        },
      }),
    ]) {
      const response = await worker.fetch(
        syncRequest(alice, `/api/v1/sync/documents/${documentId}/changes`),
        environment,
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("WWW-Authenticate")).toBeNull();
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(setCookies(response)).toEqual([]);
      const body = await response.json();
      expect(body).toEqual({ error: { code: "temporarily_unavailable" } });
      expect(JSON.stringify(body)).not.toMatch(/canary/u);
    }
  });

  it("does not write or mutate on rejected sync requests", async () => {
    const alice = await register(sessionEnv(), { idFill: 10 });
    const bob = await register(sessionEnv(), { idFill: 11 });
    const aliceDocument = await bootstrap(alice);
    const bobDocument = await bootstrap(bob);
    const before = await countRows("changes");
    const rejected = [
      await append(bob, aliceDocument.document_id, [
        envelopeFor(aliceDocument.document_id),
      ]),
      await append(alice, aliceDocument.document_id, []),
      await append(alice, aliceDocument.document_id, [
        { ...envelopeFor(aliceDocument.document_id), extra: true },
      ]),
      await append(alice, bobDocument.document_id, [
        envelopeFor(bobDocument.document_id),
      ]),
    ];
    expect(rejected.map((response) => response.status)).toEqual([
      404, 400, 400, 404,
    ]);
    expect(await countRows("changes")).toBe(before);
    expect(
      (await pull(alice, aliceDocument.document_id).then((r) => r.json()))
        .changes,
    ).toEqual([]);
  });
});
