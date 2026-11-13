import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleWebAuthnRequest } from "../http/webauthn.mjs";
import {
  base64Url,
  bytes,
  fakeClock,
  resetAuthDatabase,
} from "./auth-fixtures.mts";
import {
  buildAssertionResponse,
  buildRegistrationResponse,
  createCredential,
} from "./webauthn-ceremony-fixtures.mjs";

const ORIGIN = "https://localhost:4300";
const BINDING = bytes(32, 0x31);
const RATE_KEY = base64Url(bytes(32, 0x7a));

beforeEach(resetAuthDatabase);

function authEnv(overrides = {}) {
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
    ...overrides,
  };
}

function request(
  path,
  body,
  { method = "POST", origin = ORIGIN, headers = {} } = {},
) {
  const requestHeaders = {
    Origin: origin,
    "Content-Type": "application/json",
    ...headers,
  };
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

let challengeSequence = 0;

function dependencies(clock, extra = {}) {
  return {
    now: clock.now,
    newChallengeId: () =>
      base64Url(bytes(16, 0x40 + (challengeSequence++ & 0xff))),
    newAccountId: () => "acct_http0001",
    newAccountHandle: () => base64Url(bytes(32, 0x21)),
    newDocumentId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ...extra,
  };
}

async function jsonResponse(response) {
  return { response, body: await response.json() };
}

describe("Phase 5 auth endpoint composition", () => {
  it("returns registration options and a server-only session handoff without a cookie", async () => {
    const clock = fakeClock();
    const options = await jsonResponse(
      (
        await handleWebAuthnRequest(
          request("/api/v1/auth/register/options", {}),
          authEnv(),
          { bindingDigest: BINDING },
          dependencies(clock),
        )
      ).response,
    );
    expect(options.response.status).toBe(200);
    expect(options.response.headers.get("Cache-Control")).toBe("no-store");
    expect(options.response.headers.get("Set-Cookie")).toBeNull();
    expect(options.body.challenge_id).toHaveLength(22);
    expect(options.body.publicKey.user.id).toHaveLength(43);
    expect(options.body.publicKey).not.toHaveProperty("extensions");
    expect(options.body.publicKey).not.toHaveProperty("hints");

    const credential = await createCredential();
    const registration = await buildRegistrationResponse({
      challenge: options.body.publicKey.challenge,
      rpID: "localhost",
      origin: ORIGIN,
      credential,
    });
    const verified = await handleWebAuthnRequest(
      request("/api/v1/auth/register/verify", {
        challenge_id: options.body.challenge_id,
        credential: registration,
      }),
      authEnv(),
      { bindingDigest: BINDING },
      dependencies(clock),
    );
    expect(verified.response.status).toBe(200);
    expect(verified.response.headers.get("Cache-Control")).toBe("no-store");
    expect(verified.response.headers.get("Set-Cookie")).toBeNull();
    const body = await verified.response.json();
    expect(body.session.account.handle).toBe(options.body.publicKey.user.id);
    expect(body.session.csrf_token).toHaveLength(43);
    expect(verified.handoff.kind).toBe("session");
    expect(JSON.stringify(body)).not.toContain(verified.handoff.token);
  });

  it("serves discoverable sign-in through the endpoint composition", async () => {
    const clock = fakeClock();
    const registrationOptions = await handleWebAuthnRequest(
      request("/api/v1/auth/register/options", {}),
      authEnv(),
      { bindingDigest: BINDING },
      dependencies(clock),
    );
    const registeredOptions = await registrationOptions.response.json();
    const credential = await createCredential();
    const registration = await buildRegistrationResponse({
      challenge: registeredOptions.publicKey.challenge,
      rpID: "localhost",
      origin: ORIGIN,
      credential,
    });
    const registered = await handleWebAuthnRequest(
      request("/api/v1/auth/register/verify", {
        challenge_id: registeredOptions.challenge_id,
        credential: registration,
      }),
      authEnv(),
      { bindingDigest: BINDING },
      dependencies(clock),
    );
    const registeredBody = await registered.response.json();

    const signInOptions = await handleWebAuthnRequest(
      request("/api/v1/auth/sign-in/options", {}),
      authEnv(),
      { bindingDigest: BINDING },
      dependencies(clock),
    );
    const begin = await signInOptions.response.json();
    const assertion = await buildAssertionResponse({
      challenge: begin.publicKey.challenge,
      rpID: "localhost",
      origin: ORIGIN,
      credential,
      userHandle: registeredBody.session.account.handle,
    });
    const verified = await handleWebAuthnRequest(
      request("/api/v1/auth/sign-in/verify", {
        challenge_id: begin.challenge_id,
        credential: assertion,
      }),
      authEnv(),
      {
        bindingDigest: BINDING,
        session: registered.handoff.session,
      },
      dependencies(clock),
    );
    expect(verified.response.status).toBe(200);
    const body = await verified.response.json();
    expect(body.session.account.handle).toBe(
      registeredBody.session.account.handle,
    );
    expect(verified.handoff.kind).toBe("session");
  });

  it("requires the configured mode, exact Origin, JSON media type, and POST", async () => {
    const clock = fakeClock();
    const noMode = await handleWebAuthnRequest(
      request("/api/v1/auth/register/options", {}),
      authEnv({ AUTH_MODE: undefined }),
      { bindingDigest: BINDING },
      dependencies(clock),
    );
    expect(noMode.response.status).toBe(404);

    const wrongOrigin = await handleWebAuthnRequest(
      request(
        "/api/v1/auth/register/options",
        {},
        { origin: "https://evil.example" },
      ),
      authEnv(),
      { bindingDigest: BINDING },
      dependencies(clock),
    );
    expect(wrongOrigin.response.status).toBe(403);
    expect((await wrongOrigin.response.json()).error.code).toBe(
      "origin_forbidden",
    );

    const authorization = await handleWebAuthnRequest(
      request(
        "/api/v1/auth/register/options",
        {},
        {
          headers: { Authorization: "Bearer client-supplied" },
        },
      ),
      authEnv(),
      { bindingDigest: BINDING },
      dependencies(clock),
    );
    expect(authorization.response.status).toBe(400);

    const media = await handleWebAuthnRequest(
      request("/api/v1/auth/register/options", undefined, {
        headers: { "Content-Type": "text/plain" },
      }),
      authEnv(),
      { bindingDigest: BINDING },
      dependencies(clock),
    );
    expect(media.response.status).toBe(415);

    const method = await handleWebAuthnRequest(
      request("/api/v1/auth/register/options", undefined, { method: "GET" }),
      authEnv(),
      { bindingDigest: BINDING },
      dependencies(clock),
    );
    expect(method.response.status).toBe(405);
    expect(method.response.headers.get("Allow")).toBe("POST");
  });

  it("fails closed without a server-only binding context", async () => {
    const clock = fakeClock();
    const result = await handleWebAuthnRequest(
      request("/api/v1/auth/register/options", {}),
      authEnv(),
      {},
      dependencies(clock),
    );
    expect(result.response.status).toBe(401);
    expect(result.handoff).toBeNull();
  });

  it("requires CSRF and recent auth on session-bound options", async () => {
    const clock = fakeClock();
    const registrationOptions = await handleWebAuthnRequest(
      request("/api/v1/auth/register/options", {}),
      authEnv(),
      { bindingDigest: BINDING },
      dependencies(clock),
    );
    const options = await registrationOptions.response.json();
    const credential = await createCredential();
    const registration = await buildRegistrationResponse({
      challenge: options.publicKey.challenge,
      rpID: "localhost",
      origin: ORIGIN,
      credential,
    });
    const registered = await handleWebAuthnRequest(
      request("/api/v1/auth/register/verify", {
        challenge_id: options.challenge_id,
        credential: registration,
      }),
      authEnv(),
      { bindingDigest: BINDING },
      dependencies(clock),
    );
    const handoff = registered.handoff;

    const noCsrf = await handleWebAuthnRequest(
      request("/api/v1/auth/step-up/options", {}),
      authEnv(),
      { bindingDigest: BINDING, session: handoff.session },
      dependencies(clock),
    );
    expect(noCsrf.response.status).toBe(403);
    expect((await noCsrf.response.json()).error.code).toBe("csrf_forbidden");

    const csrf = await handleWebAuthnRequest(
      request("/api/v1/auth/step-up/options", {}),
      authEnv(),
      {
        bindingDigest: BINDING,
        session: handoff.session,
        csrfVerified: true,
      },
      dependencies(clock),
    );
    expect(csrf.response.status).toBe(200);
    expect(await csrf.response.json()).toMatchObject({
      challenge_id: expect.any(String),
      publicKey: { allowCredentials: expect.any(Array) },
    });

    const stale = await handleWebAuthnRequest(
      request("/api/v1/auth/credentials/options", {}),
      authEnv(),
      {
        bindingDigest: BINDING,
        session: { ...handoff.session, recentAuth: false },
        csrfVerified: true,
      },
      dependencies(clock),
    );
    expect(stale.response.status).toBe(403);
    expect((await stale.response.json()).error.code).toBe(
      "recent_auth_required",
    );
  });

  it("returns 429 with Retry-After when the per-binding challenge cap is reached", async () => {
    const clock = fakeClock();
    for (let index = 0; index < 3; index += 1) {
      const result = await handleWebAuthnRequest(
        request("/api/v1/auth/sign-in/options", {}),
        authEnv(),
        { bindingDigest: BINDING },
        dependencies(clock),
      );
      expect(result.response.status).toBe(200);
    }
    const limited = await handleWebAuthnRequest(
      request("/api/v1/auth/sign-in/options", {}),
      authEnv(),
      { bindingDigest: BINDING },
      dependencies(clock),
    );
    expect(limited.response.status).toBe(429);
    expect(limited.response.headers.get("Retry-After")).toBe("300");
    expect((await limited.response.json()).error.code).toBe("rate_limited");
    expect(limited.response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects a PRF canary in a superset body without leaking it to response or logs", async () => {
    const clock = fakeClock();
    const options = await handleWebAuthnRequest(
      request("/api/v1/auth/register/options", {}),
      authEnv(),
      { bindingDigest: BINDING },
      dependencies(clock),
    );
    const parsedOptions = await options.response.json();
    const canary = "prf-canary-3d0b4c7e";
    const credential = await createCredential();
    const registration = await buildRegistrationResponse({
      challenge: parsedOptions.publicKey.challenge,
      rpID: "localhost",
      origin: ORIGIN,
      credential,
    });
    registration.clientExtensionResults = {
      prf: { results: { first: canary } },
    };
    registration.response.clientExtensionResults = {
      prf: { enabled: true },
    };
    const spies = ["debug", "info", "log", "warn", "error"].map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    let result;
    try {
      result = await handleWebAuthnRequest(
        request("/api/v1/auth/register/verify", {
          challenge_id: parsedOptions.challenge_id,
          credential: registration,
          clientExtensionResults: { prf: canary },
        }),
        authEnv(),
        { bindingDigest: BINDING },
        dependencies(clock),
      );
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(result.response.status).toBe(400);
    const responseText = await result.response.clone().text();
    expect(responseText).not.toContain(canary);
    expect((await result.response.json()).error.code).toBe("malformed_request");
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(canary);
    }
  });
});
