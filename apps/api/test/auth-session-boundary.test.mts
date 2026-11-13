import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import worker from "../bridges/worker.mjs";
import { handleSessionAuthRequest } from "../http/session-auth.mjs";
import { createAuthRepository } from "../repositories/auth.mjs";
import { createSessionAdmission } from "../session/admission.mjs";
import { parseCookieHeader } from "../session/cookies.mjs";
import {
  createSessionMaterial,
  decodeSessionToken,
  sha256,
} from "../webauthn/session-material.mjs";
import {
  base64Url,
  bytes,
  countRows,
  fakeClock,
  queryFirst,
  resetAuthDatabase,
} from "./auth-fixtures.mts";
import {
  buildAssertionResponse,
  buildRegistrationResponse,
  createCredential,
} from "./webauthn-ceremony-fixtures.mjs";

const ORIGIN = "https://localhost:4300";
const SESSION = "__Host-tanikun_session";
const BINDING = "__Host-tanikun_binding";
const RATE_KEY = base64Url(bytes(32, 0x7a));
const SESSION_ATTRIBUTES = "Secure; HttpOnly; SameSite=Lax; Path=/";

beforeEach(resetAuthDatabase);

function authEnv(overrides = {}) {
  return {
    DB: env.DB,
    AUTH_MODE: "session",
    APP_ENV: "test",
    DEV_AUTH: undefined,
    DEV_AUTH_IDENTITIES: undefined,
    AUTH_ORIGIN: ORIGIN,
    RP_ID: "localhost",
    AUTH_RATE_LIMIT_KEY: RATE_KEY,
    ...overrides,
  };
}

function request(
  path,
  {
    method = "POST",
    body,
    origin = ORIGIN,
    contentType = "application/json",
    headers = {},
  } = {},
) {
  const requestHeaders = { ...headers };
  if (origin !== null) requestHeaders.Origin = origin;
  const encoded =
    body === undefined
      ? undefined
      : typeof body === "string"
        ? body
        : JSON.stringify(body);
  if (encoded !== undefined) requestHeaders["Content-Type"] = contentType;
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: requestHeaders,
    ...(encoded === undefined ? {} : { body: encoded }),
  });
}

function setCookies(response) {
  return typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : (response.headers.get("Set-Cookie") ?? "")
        .split(/,\s*(?=__Host-)/u)
        .filter(Boolean);
}

function cookieValueFromResponse(response, name) {
  const prefix = `${name}=`;
  const values = setCookies(response)
    .filter((value) => value.startsWith(prefix))
    .map((value) => value.slice(prefix.length).split(";", 1)[0]);
  return values.at(-1) ?? null;
}

function dependencies(clock, overrides = {}) {
  let binding = 0x30;
  return {
    now: clock.now,
    newAccountId: () => "acct_http1801",
    newAccountHandle: () => base64Url(bytes(32, 0x21)),
    newDocumentId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    newChallengeId: () => base64Url(crypto.getRandomValues(new Uint8Array(16))),
    newBinding: () => bytes(32, binding++),
    ...overrides,
  };
}

async function registerAccount({
  clock = fakeClock(),
  env: environment = authEnv(),
  deps = dependencies(clock),
  handleFill = 0x21,
  accountName = "acct_http1801",
  documentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
} = {}) {
  deps = {
    ...deps,
    newAccountHandle: () => base64Url(bytes(32, handleFill)),
    newAccountId: () => accountName,
    newDocumentId: () => documentId,
  };
  const optionsResponse = await handleSessionAuthRequest(
    request("/api/v1/auth/register/options", { body: {} }),
    environment,
    deps,
  );
  expect(optionsResponse.status).toBe(200);
  const options = await optionsResponse.json();
  const binding = cookieValueFromResponse(optionsResponse, BINDING);
  expect(binding).toHaveLength(43);

  const credential = await createCredential({
    idFill: handleFill & 0xff,
    idLength: 16,
  });
  const registration = await buildRegistrationResponse({
    challenge: options.publicKey.challenge,
    rpID: "localhost",
    origin: ORIGIN,
    credential,
  });
  const verifyResponse = await handleSessionAuthRequest(
    request("/api/v1/auth/register/verify", {
      body: {
        challenge_id: options.challenge_id,
        credential: registration,
      },
      headers: { Cookie: `${BINDING}=${binding}` },
    }),
    environment,
    deps,
  );
  expect(verifyResponse.status).toBe(200);
  const verifyBody = await verifyResponse.json();
  const session = cookieValueFromResponse(verifyResponse, SESSION);
  expect(session).toHaveLength(43);
  return {
    clock,
    env: environment,
    deps,
    binding,
    session,
    credential,
    options,
    optionsResponse,
    verifyResponse,
    verifyBody,
    handle: verifyBody.session.account.handle,
    csrf: verifyBody.session.csrf_token,
  };
}

async function stepUp(account, { counter = 0 } = {}) {
  const cookie = `${SESSION}=${account.session}; ${BINDING}=${account.binding}`;
  const optionsResponse = await handleSessionAuthRequest(
    request("/api/v1/auth/step-up/options", {
      body: {},
      headers: { Cookie: cookie, "X-CSRF-Token": account.csrf },
    }),
    account.env,
    account.deps,
  );
  expect(optionsResponse.status).toBe(200);
  expect(setCookies(optionsResponse)).toEqual([]);
  const options = await optionsResponse.json();
  const assertion = await buildAssertionResponse({
    challenge: options.publicKey.challenge,
    rpID: "localhost",
    origin: ORIGIN,
    credential: account.credential,
    counter,
    userHandle: account.handle,
    includeUserHandle: false,
  });
  const verifyResponse = await handleSessionAuthRequest(
    request("/api/v1/auth/step-up/verify", {
      body: {
        challenge_id: options.challenge_id,
        credential: assertion,
      },
      headers: { Cookie: cookie, "X-CSRF-Token": account.csrf },
    }),
    account.env,
    account.deps,
  );
  expect(verifyResponse.status).toBe(200);
  expect(setCookies(verifyResponse)).toEqual([]);
  const body = await verifyResponse.json();
  const status = await sessionStatus(account);
  expect(status.status).toBe(200);
  const session = await status.json();
  expect(session.session.csrf_token).toBe(account.csrf);
  expect(session.session.recent_auth).toBe(true);
  return {
    optionsResponse,
    options,
    verifyResponse,
    body,
  };
}

async function sessionStatus(
  account,
  cookie = `${SESSION}=${account.session}`,
) {
  return handleSessionAuthRequest(
    request("/api/v1/auth/session", {
      method: "GET",
      origin: null,
      headers: { Cookie: cookie },
    }),
    account.env,
    account.deps,
  );
}

async function createSecondSession(account, fill) {
  const user = await queryFirst(
    "SELECT id FROM users WHERE handle = ?1",
    account.handle,
  );
  const repository = createAuthRepository(env.DB, {
    now: account.clock.now,
  });
  const material = await createSessionMaterial({
    newToken: () => bytes(32, fill),
  });
  const session = await repository.createSession({
    userId: user.id,
    digest: material.digest,
    csrfDigest: material.csrfDigest,
  });
  return { repository, session, material };
}

describe("session boundary", () => {
  it("never mints a browser binding during verification when its cookie is absent", async () => {
    const newBinding = vi.fn<() => Uint8Array>(() => bytes(32, 0x77));
    const admission = createSessionAdmission({ db: env.DB, newBinding });
    const cookies = parseCookieHeader(request("/api/v1/auth/register/verify"));
    await expect(
      admission.readBinding(cookies, { mode: "verify" }),
    ).rejects.toMatchObject({ code: "authentication_failed" });
    expect(newBinding).not.toHaveBeenCalled();
  });

  it("checks actual logout body bytes even when Content-Length claims zero", async () => {
    const account = await registerAccount();
    const headers = {
      Cookie: `${SESSION}=${account.session}`,
      "X-CSRF-Token": account.csrf,
      "Content-Length": "0",
    };
    const malformed = await handleSessionAuthRequest(
      request("/api/v1/auth/logout", {
        body: { extra: true },
        headers,
      }),
      account.env,
      account.deps,
    );
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe("malformed_request");
    const oversized = await handleSessionAuthRequest(
      request("/api/v1/auth/logout", {
        body: "x".repeat(33 * 1024),
        headers,
      }),
      account.env,
      account.deps,
    );
    expect(oversized.status).toBe(413);
    expect((await oversized.json()).error.code).toBe("request_too_large");
    expect((await sessionStatus(account)).status).toBe(200);
  });

  it("mints and reuses the binding cookie, then sets an exact HttpOnly session cookie", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    const cookies = setCookies(account.verifyResponse);

    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toBe(
      `${SESSION}=${account.session}; ${SESSION_ATTRIBUTES}`,
    );
    expect(cookies[0]).not.toMatch(/Max-Age|Domain|Partitioned/u);
    expect(setCookies(account.optionsResponse)).toEqual([
      `${BINDING}=${account.binding}; ${SESSION_ATTRIBUTES}; Max-Age=86400`,
    ]);
    expect(account.binding).toHaveLength(43);
    expect(account.verifyBody.session.account.handle).toBe(account.handle);
    expect(account.verifyBody.session.csrf_token).toHaveLength(43);
    expect(JSON.stringify(account.verifyBody)).not.toContain(account.session);

    const status = await handleSessionAuthRequest(
      request("/api/v1/auth/session", {
        method: "GET",
        origin: null,
        headers: { Cookie: `${SESSION}=${account.session}` },
      }),
      account.env,
      account.deps,
    );
    expect(status.status).toBe(200);
    expect(status.headers.get("Cache-Control")).toBe("no-store");
    expect(status.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(status.headers.get("WWW-Authenticate")).toBeNull();
    const body = await status.json();
    expect(body.session.account.handle).toBe(account.handle);
    expect(body.session.csrf_token).toBe(account.csrf);
    expect(body.session.recent_auth).toBe(true);
    expect(body.session.expires_at).toBe(clock.current() + 12 * 60 * 60 * 1000);
    expect(body.session.idle_expires_at).toBe(clock.current() + 30 * 60 * 1000);
    expect(JSON.stringify(body)).not.toContain(account.session);

    const reload = await handleSessionAuthRequest(
      request("/api/v1/auth/session", {
        method: "GET",
        origin: null,
        headers: { Cookie: `${SESSION}=${account.session}` },
      }),
      account.env,
      account.deps,
    );
    expect((await reload.json()).session.csrf_token).toBe(account.csrf);
  });

  it("returns 200 null without a cookie and 401 plus deletion for invalid cookies", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    const environment = account.env;
    const deps = account.deps;

    const absent = await handleSessionAuthRequest(
      request("/api/v1/auth/session", { method: "GET", origin: null }),
      environment,
      deps,
    );
    expect(absent.status).toBe(200);
    expect(await absent.json()).toEqual({ session: null });

    const invalid = await handleSessionAuthRequest(
      request("/api/v1/auth/session", {
        method: "GET",
        origin: null,
        headers: { Cookie: `${SESSION}=not-a-token` },
      }),
      environment,
      deps,
    );
    expect(invalid.status).toBe(401);
    expect((await invalid.json()).error.code).toBe("unauthorized");
    expect(setCookies(invalid)).toEqual([
      `${SESSION}=; ${SESSION_ATTRIBUTES}; Max-Age=0`,
    ]);
    expect(invalid.headers.get("WWW-Authenticate")).toBeNull();

    const duplicate = await handleSessionAuthRequest(
      request("/api/v1/auth/session", {
        method: "GET",
        origin: null,
        headers: {
          Cookie: `${SESSION}=${account.session}; ${SESSION}=${account.session}`,
        },
      }),
      environment,
      deps,
    );
    expect(duplicate.status).toBe(401);
    expect((await duplicate.json()).error.code).toBe("unauthorized");
    expect(setCookies(duplicate)).toHaveLength(1);

    const malformedHeader = await handleSessionAuthRequest(
      request("/api/v1/auth/session", {
        method: "GET",
        origin: null,
        headers: { Cookie: `${SESSION}=${account.session}, other=value` },
      }),
      environment,
      deps,
    );
    expect(malformedHeader.status).toBe(401);
    expect(setCookies(malformedHeader)).toHaveLength(1);
  });

  it("rejects wrong/duplicate Origin, wrong methods, and sends no CORS headers", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    const environment = account.env;
    const deps = account.deps;

    const wrongOrigin = await handleSessionAuthRequest(
      request("/api/v1/auth/register/options", {
        body: {},
        origin: "https://evil.example",
      }),
      environment,
      deps,
    );
    expect(wrongOrigin.status).toBe(403);
    expect((await wrongOrigin.json()).error.code).toBe("origin_forbidden");
    expect(setCookies(wrongOrigin)).toEqual([]);
    expect(wrongOrigin.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const duplicateOrigin = await handleSessionAuthRequest(
      request("/api/v1/auth/register/options", {
        body: {},
        origin: null,
        headers: { Origin: `${ORIGIN}, ${ORIGIN}` },
      }),
      environment,
      deps,
    );
    expect(duplicateOrigin.status).toBe(403);

    const getStatusWrongOrigin = await handleSessionAuthRequest(
      request("/api/v1/auth/session", {
        method: "GET",
        origin: "https://evil.example",
        headers: { Cookie: `${SESSION}=${account.session}` },
      }),
      environment,
      deps,
    );
    expect(getStatusWrongOrigin.status).toBe(403);
    expect(setCookies(getStatusWrongOrigin)).toEqual([]);
  });

  it("uses Allow for known-route method failures and never emits CORS preflight", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    const environment = account.env;
    const deps = account.deps;

    const wrongMethod = await handleSessionAuthRequest(
      request("/api/v1/auth/session", {
        method: "POST",
        body: {},
      }),
      environment,
      deps,
    );
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("Allow")).toBe("GET");
    expect(wrongMethod.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const options = await handleSessionAuthRequest(
      request("/api/v1/auth/register/options", {
        method: "OPTIONS",
        origin: null,
      }),
      environment,
      deps,
    );
    expect(options.status).toBe(405);
    expect(options.headers.get("Allow")).toBe("POST");
    expect(options.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(options.headers.get("Access-Control-Allow-Methods")).toBeNull();
  });

  it("rejects CSRF omissions, duplicates and stale tokens", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    const environment = account.env;
    const deps = account.deps;
    const cookie = `${SESSION}=${account.session}; ${BINDING}=${account.binding}`;

    const missing = await handleSessionAuthRequest(
      request("/api/v1/auth/step-up/options", {
        body: {},
        headers: { Cookie: cookie },
      }),
      environment,
      deps,
    );
    expect(missing.status).toBe(403);
    expect((await missing.json()).error.code).toBe("csrf_forbidden");

    const duplicate = await handleSessionAuthRequest(
      request("/api/v1/auth/step-up/options", {
        body: {},
        headers: {
          Cookie: cookie,
          "X-CSRF-Token": `${account.csrf}, ${account.csrf}`,
        },
      }),
      environment,
      deps,
    );
    expect(duplicate.status).toBe(403);

    const stale = await handleSessionAuthRequest(
      request("/api/v1/auth/step-up/options", {
        body: {},
        headers: {
          Cookie: cookie,
          "X-CSRF-Token": base64Url(bytes(32, 0x99)),
        },
      }),
      environment,
      deps,
    );
    expect(stale.status).toBe(403);
  });

  it("rejects body-supplied trusted context on a public ceremony route", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    const environment = account.env;
    const deps = account.deps;

    const options = await handleSessionAuthRequest(
      request("/api/v1/auth/sign-in/options", {
        body: {
          bindingDigest: Array.from(bytes(32, 0x01)),
          session: { digest: "client-chosen" },
          csrfVerified: true,
        },
        headers: { Cookie: `${BINDING}=${account.binding}` },
      }),
      environment,
      deps,
    );
    expect(options.status).toBe(400);
    expect((await options.json()).error.code).toBe("malformed_request");
  });

  it("does not leak a raw session token or a PRF canary", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    const environment = account.env;
    const deps = account.deps;
    const canary = "prf-canary-session-180";

    const spies = ["debug", "info", "log", "warn", "error"].map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    let response;
    try {
      response = await handleSessionAuthRequest(
        request("/api/v1/auth/sign-in/verify", {
          body: {
            challenge_id: base64Url(bytes(16, 0x71)),
            credential: {
              id: "AQ",
              rawId: "AQ",
              type: "public-key",
              clientExtensionResults: { prf: canary },
              response: {
                clientDataJSON: "AQ",
                authenticatorData: "AQ",
                signature: "AQ",
                userHandle: account.handle,
              },
            },
          },
          headers: { Cookie: `${BINDING}=${account.binding}` },
        }),
        environment,
        deps,
      );
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(response.status).toBe(400);
    expect(await response.clone().text()).not.toContain(canary);
    expect(await response.clone().text()).not.toContain(account.session);
    for (const spy of spies)
      expect(JSON.stringify(spy.mock.calls)).not.toContain(canary);
  });

  it("does not change account or document rows on GET session bookkeeping", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    const before = {
      users: await countRows("users"),
      documents: await countRows("documents"),
    };
    const status = await handleSessionAuthRequest(
      request("/api/v1/auth/session", {
        method: "GET",
        origin: null,
        headers: { Cookie: `${SESSION}=${account.session}` },
      }),
      account.env,
      account.deps,
    );
    expect(status.status).toBe(200);
    expect(await countRows("users")).toBe(before.users);
    expect(await countRows("documents")).toBe(before.documents);
  });

  it("fails closed with 503 and leaves cookies unchanged on storage failure", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    clock.advance(61_000);
    await env.DB.exec(
      "CREATE TRIGGER reject_session_touch BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT, 'synthetic_session_failure'); END",
    );
    try {
      const status = await handleSessionAuthRequest(
        request("/api/v1/auth/session", {
          method: "GET",
          origin: null,
          headers: { Cookie: `${SESSION}=${account.session}` },
        }),
        account.env,
        account.deps,
      );
      expect(status.status).toBe(503);
      expect((await status.json()).error.code).toBe("temporarily_unavailable");
      expect(setCookies(status)).toEqual([]);
    } finally {
      await env.DB.exec("DROP TRIGGER reject_session_touch");
    }
  });
  it("logs out a valid session only with CSRF and clears invalid cookies without CSRF", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    const cookie = `${SESSION}=${account.session}`;

    const noCsrf = await handleSessionAuthRequest(
      request("/api/v1/auth/logout", { headers: { Cookie: cookie } }),
      account.env,
      account.deps,
    );
    expect(noCsrf.status).toBe(403);
    expect((await noCsrf.json()).error.code).toBe("csrf_forbidden");

    const valid = await handleSessionAuthRequest(
      request("/api/v1/auth/logout", {
        headers: { Cookie: cookie, "X-CSRF-Token": account.csrf },
      }),
      account.env,
      account.deps,
    );
    expect(valid.status).toBe(204);
    expect(setCookies(valid)).toEqual([
      `${SESSION}=; ${SESSION_ATTRIBUTES}; Max-Age=0`,
    ]);
    expect((await sessionStatus(account)).status).toBe(401);

    const invalid = await handleSessionAuthRequest(
      request("/api/v1/auth/logout", {
        headers: { Cookie: `${SESSION}=not-a-token` },
      }),
      account.env,
      account.deps,
    );
    expect(invalid.status).toBe(204);
    expect(setCookies(invalid)).toHaveLength(1);

    const missing = await handleSessionAuthRequest(
      request("/api/v1/auth/logout", {}),
      account.env,
      account.deps,
    );
    expect(missing.status).toBe(204);
    expect(setCookies(missing)).toHaveLength(1);
  });

  it("keeps logout-all recent-auth guarded and revokes every session on success", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    const second = await createSecondSession(account, 0x91);
    const cookie = `${SESSION}=${account.session}`;
    const secondCookie = `${SESSION}=${second.material.token}`;

    const noSession = await handleSessionAuthRequest(
      request("/api/v1/auth/logout-all", {}),
      account.env,
      account.deps,
    );
    expect(noSession.status).toBe(401);

    const noCsrf = await handleSessionAuthRequest(
      request("/api/v1/auth/logout-all", { headers: { Cookie: cookie } }),
      account.env,
      account.deps,
    );
    expect(noCsrf.status).toBe(403);

    clock.advance(5 * 60 * 1000 + 1);
    const staleStatus = await sessionStatus(account);
    expect((await staleStatus.json()).session.recent_auth).toBe(false);
    const stale = await handleSessionAuthRequest(
      request("/api/v1/auth/logout-all", {
        headers: { Cookie: cookie, "X-CSRF-Token": account.csrf },
      }),
      account.env,
      account.deps,
    );
    expect(stale.status).toBe(403);
    expect((await stale.json()).error.code).toBe("recent_auth_required");
    expect((await sessionStatus(account, secondCookie)).status).toBe(200);
    expect((await sessionStatus(account)).status).toBe(200);

    await stepUp(account);
    const success = await handleSessionAuthRequest(
      request("/api/v1/auth/logout-all", {
        headers: { Cookie: cookie, "X-CSRF-Token": account.csrf },
      }),
      account.env,
      account.deps,
    );
    expect(success.status).toBe(204);
    expect(setCookies(success)).toHaveLength(1);
    expect((await sessionStatus(account)).status).toBe(401);
    expect((await sessionStatus(account, secondCookie)).status).toBe(401);
    expect(
      await queryFirst(
        "SELECT revoke_reason FROM sessions WHERE digest = ?1",
        second.session.digest,
      ),
    ).toEqual({ revoke_reason: "logout_all" });
  });

  it("clears the cookie if logout-all rechecks a session revoked after admission", async () => {
    const account = await registerAccount();
    const second = await createSecondSession(account, 0x93);
    const repository = createAuthRepository(env.DB, { now: account.clock.now });
    const response = await handleSessionAuthRequest(
      request("/api/v1/auth/logout-all", {
        headers: {
          Cookie: `${SESSION}=${account.session}`,
          "X-CSRF-Token": account.csrf,
        },
      }),
      account.env,
      {
        ...account.deps,
        repository: {
          ...repository,
          async revokeAllSessionsForSession(input) {
            // Admission succeeded; another tab logs this session out before
            // the real SQL guard rechecks it for the sensitive mutation.
            await repository.revokeSession({
              sessionDigest: input.sessionDigest,
            });
            return repository.revokeAllSessionsForSession(input);
          },
        },
      },
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "unauthorized" } });
    expect(setCookies(response)).toEqual([
      `${SESSION}=; ${SESSION_ATTRIBUTES}; Max-Age=0`,
    ]);
    expect((await sessionStatus(account)).status).toBe(401);
    expect(
      (await sessionStatus(account, `${SESSION}=${second.material.token}`))
        .status,
    ).toBe(200);
    expect(
      await queryFirst(
        "SELECT revoked_at FROM sessions WHERE digest = ?1",
        second.session.digest,
      ),
    ).toEqual({ revoked_at: null });
  });

  it("rotates the session at sign-in and rejects the old cookie and CSRF token", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    const second = await createSecondSession(account, 0x92);

    const optionsResponse = await handleSessionAuthRequest(
      request("/api/v1/auth/sign-in/options", {
        body: {},
        headers: { Cookie: `${BINDING}=${account.binding}` },
      }),
      account.env,
      account.deps,
    );
    expect(optionsResponse.status).toBe(200);
    expect(setCookies(optionsResponse)).toEqual([]);
    const options = await optionsResponse.json();
    const assertion = await buildAssertionResponse({
      challenge: options.publicKey.challenge,
      rpID: "localhost",
      origin: ORIGIN,
      credential: account.credential,
      userHandle: account.handle,
    });
    const verifyResponse = await handleSessionAuthRequest(
      request("/api/v1/auth/sign-in/verify", {
        body: {
          challenge_id: options.challenge_id,
          credential: assertion,
        },
        headers: {
          Cookie: `${BINDING}=${account.binding}; ${SESSION}=${account.session}`,
        },
      }),
      account.env,
      account.deps,
    );
    expect(verifyResponse.status).toBe(200);
    const body = await verifyResponse.json();
    const rotated = cookieValueFromResponse(verifyResponse, SESSION);
    expect(rotated).toHaveLength(43);
    expect(rotated).not.toBe(account.session);
    expect(body.session.csrf_token).not.toBe(account.csrf);

    expect(
      (await sessionStatus(account, `${SESSION}=${account.session}`)).status,
    ).toBe(401);
    const rotatedStatus = await sessionStatus(account, `${SESSION}=${rotated}`);
    expect(rotatedStatus.status).toBe(200);
    expect((await rotatedStatus.json()).session.csrf_token).toBe(
      body.session.csrf_token,
    );
    expect(
      (await sessionStatus(account, `${SESSION}=${second.material.token}`))
        .status,
    ).toBe(200);

    const oldCsrf = await handleSessionAuthRequest(
      request("/api/v1/auth/step-up/options", {
        body: {},
        headers: {
          Cookie: `${SESSION}=${rotated}; ${BINDING}=${account.binding}`,
          "X-CSRF-Token": account.csrf,
        },
      }),
      account.env,
      account.deps,
    );
    expect(oldCsrf.status).toBe(403);
    expect(
      await queryFirst(
        "SELECT revoke_reason FROM sessions WHERE digest = ?1",
        await sha256(decodeSessionToken(account.session)),
      ),
    ).toEqual({ revoke_reason: "sign_in_rotation" });
  });

  it("fails closed on duplicate binding cookies and never rebinds on verify", async () => {
    const clock = fakeClock();
    let fill = 0x30;
    let handleFill = 0x31;
    const deps = dependencies(clock, {
      newBinding: () => bytes(32, fill++),
      newAccountHandle: () => base64Url(bytes(32, handleFill++)),
    });
    const optionsA = await handleSessionAuthRequest(
      request("/api/v1/auth/register/options", { body: {} }),
      authEnv(),
      deps,
    );
    const optionsB = await handleSessionAuthRequest(
      request("/api/v1/auth/register/options", { body: {} }),
      authEnv(),
      deps,
    );
    expect(optionsA.status).toBe(200);
    expect(optionsB.status).toBe(200);
    const bindingA = cookieValueFromResponse(optionsA, BINDING);
    const bindingB = cookieValueFromResponse(optionsB, BINDING);
    expect(bindingA).not.toBe(bindingB);

    const duplicateOptions = await handleSessionAuthRequest(
      request("/api/v1/auth/register/options", {
        body: {},
        headers: {
          Cookie: `${BINDING}=${bindingA}; ${BINDING}=${bindingB}`,
        },
      }),
      authEnv(),
      deps,
    );
    expect(duplicateOptions.status).toBe(400);
    expect((await duplicateOptions.json()).error.code).toBe(
      "malformed_request",
    );
    expect(setCookies(duplicateOptions)).toEqual([]);

    const malformedOptions = await handleSessionAuthRequest(
      request("/api/v1/auth/register/options", {
        body: {},
        headers: { Cookie: `${BINDING}=not-a-binding` },
      }),
      authEnv(),
      deps,
    );
    expect(malformedOptions.status).toBe(200);
    const replacement = cookieValueFromResponse(malformedOptions, BINDING);
    expect(replacement).toHaveLength(43);
    expect(replacement).not.toBe("not-a-binding");

    const parsedA = await optionsA.json();
    const credential = await createCredential({ idFill: 0x55 });
    const registration = await buildRegistrationResponse({
      challenge: parsedA.publicKey.challenge,
      rpID: "localhost",
      origin: ORIGIN,
      credential,
    });

    const wrongBinding = await handleSessionAuthRequest(
      request("/api/v1/auth/register/verify", {
        body: {
          challenge_id: parsedA.challenge_id,
          credential: registration,
        },
        headers: { Cookie: `${BINDING}=${bindingB}` },
      }),
      authEnv(),
      deps,
    );
    expect(wrongBinding.status).toBe(401);
    expect((await wrongBinding.json()).error.code).toBe(
      "authentication_failed",
    );
    expect(setCookies(wrongBinding)).toEqual([]);

    const missingBinding = await handleSessionAuthRequest(
      request("/api/v1/auth/register/verify", {
        body: {
          challenge_id: parsedA.challenge_id,
          credential: registration,
        },
      }),
      authEnv(),
      deps,
    );
    expect(missingBinding.status).toBe(401);
    expect(setCookies(missingBinding)).toEqual([]);

    const correctBinding = await handleSessionAuthRequest(
      request("/api/v1/auth/register/verify", {
        body: {
          challenge_id: parsedA.challenge_id,
          credential: registration,
        },
        headers: { Cookie: `${BINDING}=${bindingA}` },
      }),
      authEnv(),
      deps,
    );
    expect(correctBinding.status).toBe(200);
    expect(cookieValueFromResponse(correctBinding, SESSION)).toHaveLength(43);
  });

  it("rejects registration with a valid session and still serves sign-in options", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    const sessionCookie = `${SESSION}=${account.session}`;

    const options = await handleSessionAuthRequest(
      request("/api/v1/auth/register/options", {
        body: {},
        headers: { Cookie: sessionCookie },
      }),
      account.env,
      account.deps,
    );
    expect(options.status).toBe(409);
    expect((await options.json()).error.code).toBe("already_authenticated");
    expect(setCookies(options)).toEqual([]);

    const verify = await handleSessionAuthRequest(
      request("/api/v1/auth/register/verify", {
        body: {},
        headers: { Cookie: sessionCookie },
      }),
      account.env,
      account.deps,
    );
    expect(verify.status).toBe(409);

    const signIn = await handleSessionAuthRequest(
      request("/api/v1/auth/sign-in/options", {
        body: {},
        headers: {
          Cookie: `${SESSION}=${account.session}; ${BINDING}=${account.binding}`,
        },
      }),
      account.env,
      account.deps,
    );
    expect(signIn.status).toBe(200);
    expect(setCookies(signIn)).toEqual([]);
  });

  it("rejects idle-expired, revoked, and digest-inconsistent sessions", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    clock.advance(30 * 60 * 1000 + 1);
    const expired = await sessionStatus(account);
    expect(expired.status).toBe(401);
    expect(setCookies(expired)).toHaveLength(1);
    expect((await expired.json()).error.code).toBe("unauthorized");

    const revokedClock = fakeClock();
    const revoked = await registerAccount({
      clock: revokedClock,
      handleFill: 0x41,
      accountName: "acct_revoked180",
      documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    const repository = createAuthRepository(env.DB, {
      now: revokedClock.now,
    });
    const row = await queryFirst(
      "SELECT digest FROM sessions WHERE user_id = (SELECT id FROM users WHERE handle = ?1)",
      revoked.handle,
    );
    await repository.revokeSession({
      sessionDigest: row.digest,
      reason: "logout",
    });
    const revokedStatus = await sessionStatus(revoked);
    expect(revokedStatus.status).toBe(401);
    expect(setCookies(revokedStatus)).toHaveLength(1);

    const inconsistentClock = fakeClock();
    const inconsistent = await registerAccount({
      clock: inconsistentClock,
      handleFill: 0x51,
      accountName: "acct_incons180",
      documentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    await env.DB.prepare(
      "UPDATE sessions SET csrf_digest = ?1 WHERE user_id = (SELECT id FROM users WHERE handle = ?2)",
    )
      .bind(bytes(32, 0xee), inconsistent.handle)
      .run();
    const inconsistentStatus = await sessionStatus(inconsistent);
    expect(inconsistentStatus.status).toBe(401);
    expect(setCookies(inconsistentStatus)).toHaveLength(1);
  });

  it("exposes a reusable Origin, CSRF, and recent-auth admission guard", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    const admission = createSessionAdmission({
      db: env.DB,
      now: clock.now,
    });
    const config = { mode: "session", origin: ORIGIN };
    const headers = {
      Origin: ORIGIN,
      Cookie: `${SESSION}=${account.session}`,
      "X-CSRF-Token": account.csrf,
    };

    const admitted = await admission.admitRequest(
      new Request(`${ORIGIN}/api/v1/sync/document`, {
        method: "POST",
        headers,
      }),
      config,
    );
    expect(admitted.session.account.handle).toBe(account.handle);
    expect(admitted.csrfToken).toBe(account.csrf);

    await expect(
      admission.admitRequest(
        new Request(`${ORIGIN}/api/v1/sync/document`, {
          method: "POST",
          headers: { Origin: ORIGIN, Cookie: headers.Cookie },
        }),
        config,
      ),
    ).rejects.toMatchObject({ code: "csrf_forbidden" });

    await expect(
      admission.admitRequest(
        new Request(`${ORIGIN}/api/v1/sync/document`, {
          method: "POST",
          headers: { ...headers, Authorization: "Bearer client-supplied" },
        }),
        config,
      ),
    ).rejects.toMatchObject({ code: "malformed_request" });

    await expect(
      admission.admitRequest(
        new Request(`${ORIGIN}/api/v1/sync/document`, {
          method: "POST",
          headers: { ...headers, Origin: "https://evil.example" },
        }),
        config,
      ),
    ).rejects.toMatchObject({ code: "origin_forbidden" });

    clock.advance(5 * 60 * 1000 + 1);
    await expect(
      admission.admitRequest(
        new Request(`${ORIGIN}/api/v1/sync/document`, {
          method: "POST",
          headers,
        }),
        config,
        { recent: true },
      ),
    ).rejects.toMatchObject({ code: "recent_auth_required" });

    await admission.auth.revokeSession({
      sessionDigest: admitted.session.digest,
      reason: "logout",
    });
    await expect(
      admission.admitRequest(
        new Request(`${ORIGIN}/api/v1/sync/document`, {
          method: "POST",
          headers,
        }),
        config,
      ),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("rejects malformed media, query, Authorization, and oversized bodies", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    const cookie = `${SESSION}=${account.session}; ${BINDING}=${account.binding}`;

    const statusQuery = await handleSessionAuthRequest(
      request("/api/v1/auth/session?extra=1", {
        method: "GET",
        origin: null,
      }),
      account.env,
      account.deps,
    );
    expect(statusQuery.status).toBe(400);

    const authorization = await handleSessionAuthRequest(
      request("/api/v1/auth/step-up/options", {
        body: {},
        headers: {
          Cookie: cookie,
          "X-CSRF-Token": account.csrf,
          Authorization: "Bearer client-supplied",
        },
      }),
      account.env,
      account.deps,
    );
    expect(authorization.status).toBe(400);

    const media = await handleSessionAuthRequest(
      request("/api/v1/auth/step-up/options", {
        body: "{}",
        contentType: "text/plain",
        headers: { Cookie: cookie, "X-CSRF-Token": account.csrf },
      }),
      account.env,
      account.deps,
    );
    expect(media.status).toBe(415);

    const query = await handleSessionAuthRequest(
      request("/api/v1/auth/register/options?extra=1", { body: {} }),
      account.env,
      account.deps,
    );
    expect(query.status).toBe(400);
    expect((await query.json()).error.code).toBe("malformed_request");

    const unknown = await handleSessionAuthRequest(
      request("/api/v1/auth/step-up/options", {
        body: { session: { digest: "client" } },
        headers: { Cookie: cookie, "X-CSRF-Token": account.csrf },
      }),
      account.env,
      account.deps,
    );
    expect(unknown.status).toBe(400);

    const oversized = await handleSessionAuthRequest(
      request("/api/v1/auth/register/options", {
        body: { display_name: "x".repeat(33 * 1024) },
      }),
      account.env,
      account.deps,
    );
    expect(oversized.status).toBe(413);
  });

  it("clears an invalid presented session on public options without failing them", async () => {
    const clock = fakeClock();
    const options = await handleSessionAuthRequest(
      request("/api/v1/auth/register/options", {
        body: {},
        headers: { Cookie: `${SESSION}=not-a-token` },
      }),
      authEnv(),
      dependencies(clock),
    );
    expect(options.status).toBe(200);
    const cookies = setCookies(options);
    expect(cookies).toContain(`${SESSION}=; ${SESSION_ATTRIBUTES}; Max-Age=0`);
    expect(cookies.some((value) => value.startsWith(`${BINDING}=`))).toBe(true);
  });

  it("keeps the session boundary unregistered and fails closed without an exact session config", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    const status = await worker.fetch(
      new Request(`${ORIGIN}/api/v1/auth/session`, {
        headers: { Cookie: `${SESSION}=${account.session}` },
      }),
      account.env,
    );
    expect(status.status).toBe(404);
    expect(status.headers.get("Access-Control-Allow-Origin")).toBeNull();

    for (const override of [
      { AUTH_MODE: undefined },
      { AUTH_MODE: "session", DEV_AUTH: "true" },
      { AUTH_MODE: "session", APP_ENV: "production" },
      { AUTH_MODE: "session", AUTH_ORIGIN: "https://example.test" },
      { AUTH_MODE: "session", RP_ID: "example.test" },
      { AUTH_MODE: "session", AUTH_RATE_LIMIT_KEY: undefined },
    ]) {
      const response = await handleSessionAuthRequest(
        request("/api/v1/auth/register/options", {
          body: {},
          headers: { Cookie: `${SESSION}=${account.session}` },
        }),
        authEnv(override),
        account.deps,
      );
      expect(response.status).toBe(404);
      expect(setCookies(response)).toEqual([]);
    }
  });
  it("writes last-seen at most once per minute during status admission", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    const row = () =>
      queryFirst(
        "SELECT last_seen_at, idle_expires_at FROM sessions WHERE user_id = (SELECT id FROM users WHERE handle = ?1)",
        account.handle,
      );
    const before = await row();

    clock.advance(59_000);
    expect((await sessionStatus(account)).status).toBe(200);
    expect(await row()).toEqual(before);

    clock.advance(2_000);
    expect((await sessionStatus(account)).status).toBe(200);
    expect(await row()).toEqual({
      last_seen_at: clock.current(),
      idle_expires_at: clock.current() + 30 * 60 * 1000,
    });
  });

  it("rejects absolute expiry even while the extended idle window is still valid", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    for (let index = 0; index < 24; index += 1) {
      clock.advance(29 * 60 * 1000);
      expect((await sessionStatus(account)).status).toBe(200);
    }
    // 24 touches leave idle_expires_at at +12h06m; absolute expiry is +12h.
    clock.advance(25 * 60 * 1000);
    const expired = await sessionStatus(account);
    expect(expired.status).toBe(401);
    expect((await expired.json()).error.code).toBe("unauthorized");
    expect(setCookies(expired)).toHaveLength(1);
  });
});
