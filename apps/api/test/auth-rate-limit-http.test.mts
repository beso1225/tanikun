import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import worker from "../bridges/worker.mjs";
import { handleSessionAuthRequest } from "../http/session-auth.mjs";
import { createAuthRepository } from "../repositories/auth.mjs";
import { createSessionAdmission } from "../session/admission.mjs";
import { createSessionMaterial } from "../webauthn/session-material.mjs";
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

beforeEach(resetAuthDatabase);

function alignedClock(windowMs) {
  return fakeClock(Math.ceil(1_760_000_000_000 / windowMs) * windowMs);
}

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
    cf = { colo: "TST" },
    noCf = true,
    address,
    forged = {},
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
  if (address !== undefined) requestHeaders["CF-Connecting-IP"] = address;
  Object.assign(requestHeaders, forged);
  const result = new Request(`${ORIGIN}${path}`, {
    method,
    headers: requestHeaders,
    ...(encoded === undefined ? {} : { body: encoded }),
  });
  if (!noCf)
    Object.defineProperty(result, "cf", {
      value: cf,
      configurable: true,
    });
  return result;
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

let identitySequence = 0;

function dependencies(clock, overrides = {}) {
  const identity = identitySequence++;
  let binding = 0x30 + identity * 8;
  return {
    now: clock.now,
    newAccountId: () => `acct_rate${String(identity).padStart(4, "0")}`,
    newAccountHandle: () => base64Url(bytes(32, 0x20 + (identity & 0xdf))),
    newDocumentId: () =>
      `aaaaaaaa-aaaa-4aaa-8aaa-${String(identity).padStart(12, "0")}`,
    newChallengeId: () => base64Url(crypto.getRandomValues(new Uint8Array(16))),
    newBinding: () => bytes(32, binding++),
    ...overrides,
  };
}

async function registerAccount({
  clock = fakeClock(),
  environment = authEnv(),
  deps = dependencies(clock),
  requestOptions = {},
} = {}) {
  const optionsResponse = await handleSessionAuthRequest(
    request("/api/v1/auth/register/options", {
      body: {},
      ...requestOptions,
    }),
    environment,
    deps,
  );
  expect(optionsResponse.status).toBe(200);
  const options = await optionsResponse.json();
  const binding = cookieValueFromResponse(optionsResponse, BINDING);
  expect(binding).toHaveLength(43);

  const credential = await createCredential({
    idFill: 0x40 + (identitySequence % 0x80),
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
      ...requestOptions,
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
    handle: verifyBody.session.account.handle,
    csrf: verifyBody.session.csrf_token,
  };
}

async function stepUp(account, requestOptions = {}) {
  const cookie = `${SESSION}=${account.session}; ${BINDING}=${account.binding}`;
  const optionsResponse = await handleSessionAuthRequest(
    request("/api/v1/auth/step-up/options", {
      body: {},
      headers: { Cookie: cookie, "X-CSRF-Token": account.csrf },
      ...requestOptions,
    }),
    account.env,
    account.deps,
  );
  expect(optionsResponse.status).toBe(200);
  const options = await optionsResponse.json();
  const assertion = await buildAssertionResponse({
    challenge: options.publicKey.challenge,
    rpID: "localhost",
    origin: ORIGIN,
    credential: account.credential,
    counter: 0,
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
      ...requestOptions,
    }),
    account.env,
    account.deps,
  );
  expect(verifyResponse.status).toBe(200);
  return verifyResponse.json();
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
  const repository = createAuthRepository(env.DB, { now: account.clock.now });
  const material = await createSessionMaterial({
    newToken: () => bytes(32, fill),
  });
  const session = await repository.createSession({
    userId: user.id,
    digest: material.digest,
    csrfDigest: material.csrfDigest,
  });
  return { session, material };
}

function registrationVerifyBody(challengeId, credentialId, attestation = "AQ") {
  return {
    challenge_id: challengeId,
    credential: {
      id: credentialId,
      rawId: credentialId,
      type: "public-key",
      response: {
        clientDataJSON: "AQ",
        attestationObject: attestation,
      },
    },
  };
}

function assertionBody({ credentialFill, userHandle }) {
  const credentialId = base64Url(bytes(1, credentialFill));
  return {
    challenge_id: base64Url(bytes(16, credentialFill)),
    credential: {
      id: credentialId,
      rawId: credentialId,
      type: "public-key",
      response: {
        clientDataJSON: base64Url(bytes(4, credentialFill)),
        authenticatorData: base64Url(bytes(4, credentialFill + 1)),
        signature: base64Url(bytes(4, credentialFill + 2)),
        ...(userHandle === undefined
          ? {}
          : { userHandle: base64Url(bytes(32, userHandle)) }),
      },
    },
  };
}

function bindingCookie(fill) {
  return `${BINDING}=${base64Url(bytes(32, fill))}`;
}

describe("challenge-issue fixed windows", () => {
  it("limits trusted addresses, rejects forged forwarding headers, and isolates addresses", async () => {
    const clock = alignedClock(3_600_000);
    const environment = authEnv();
    const deps = dependencies(clock);
    const trusted = {
      noCf: false,
      cf: { colo: "TST" },
      address: "203.0.113.7",
    };
    for (let index = 0; index < 30; index += 1) {
      const response = await handleSessionAuthRequest(
        request("/api/v1/auth/sign-in/options", { body: {}, ...trusted }),
        environment,
        deps,
      );
      expect(response.status).toBe(200);
    }
    const blocked = await handleSessionAuthRequest(
      request("/api/v1/auth/sign-in/options", {
        body: {},
        ...trusted,
        forged: { "X-Forwarded-For": "198.51.100.99" },
      }),
      environment,
      deps,
    );
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: { code: "rate_limited" } });
    expect(blocked.headers.get("Retry-After")).toBe("600");
    expect(setCookies(blocked)).toEqual([]);

    const other = await handleSessionAuthRequest(
      request("/api/v1/auth/sign-in/options", {
        body: {},
        noCf: false,
        cf: { colo: "TST" },
        address: "203.0.113.8",
      }),
      environment,
      deps,
    );
    expect(other.status).toBe(200);
  });

  it("keeps the three-challenge cap and the binding fixed window distinct", async () => {
    const clock = alignedClock(600_000);
    const environment = authEnv();
    const deps = dependencies(clock);
    const trusted = {
      noCf: false,
      cf: { colo: "TST" },
      address: "203.0.113.9",
    };
    const first = await handleSessionAuthRequest(
      request("/api/v1/auth/sign-in/options", { body: {}, ...trusted }),
      environment,
      deps,
    );
    expect(first.status).toBe(200);
    const binding = cookieValueFromResponse(first, BINDING);
    const cookie = `${BINDING}=${binding}`;
    for (let index = 0; index < 2; index += 1) {
      const response = await handleSessionAuthRequest(
        request("/api/v1/auth/sign-in/options", {
          body: {},
          headers: { Cookie: cookie },
          ...trusted,
        }),
        environment,
        deps,
      );
      expect(response.status).toBe(200);
    }
    const cap = await handleSessionAuthRequest(
      request("/api/v1/auth/sign-in/options", {
        body: {},
        headers: { Cookie: cookie },
        ...trusted,
      }),
      environment,
      deps,
    );
    expect(cap.status).toBe(429);
    expect(cap.headers.get("Retry-After")).toBe("300");

    clock.advance(301_000);
    for (let index = 0; index < 2; index += 1) {
      const afterExpiry = await handleSessionAuthRequest(
        request("/api/v1/auth/sign-in/options", {
          body: {},
          headers: { Cookie: cookie },
          ...trusted,
        }),
        environment,
        deps,
      );
      expect(afterExpiry.status).toBe(200);
    }
    const fixedWindow = await handleSessionAuthRequest(
      request("/api/v1/auth/sign-in/options", {
        body: {},
        headers: { Cookie: cookie },
        ...trusted,
      }),
      environment,
      deps,
    );
    expect(fixedWindow.status).toBe(429);
    expect(fixedWindow.headers.get("Retry-After")).toBe("299");
    expect(await fixedWindow.json()).toEqual({
      error: { code: "rate_limited" },
    });

    clock.advance(299_000);
    const recovered = await handleSessionAuthRequest(
      request("/api/v1/auth/sign-in/options", {
        body: {},
        headers: { Cookie: cookie },
        ...trusted,
      }),
      environment,
      deps,
    );
    expect(recovered.status).toBe(200);
  });
});

describe("verification fixed windows", () => {
  it("limits registration verify by address and binding before challenge work", async () => {
    const clock = alignedClock(3_600_000);
    const environment = authEnv();
    const deps = dependencies(clock);
    const trusted = {
      noCf: false,
      cf: { colo: "TST" },
      address: "203.0.113.10",
    };
    const body = registrationVerifyBody(
      base64Url(bytes(16, 0x11)),
      base64Url(bytes(1, 0x21)),
    );
    for (let index = 0; index < 5; index += 1) {
      const response = await handleSessionAuthRequest(
        request("/api/v1/auth/register/verify", {
          body,
          headers: { Cookie: bindingCookie(0x30) },
          ...trusted,
        }),
        environment,
        deps,
      );
      expect(response.status).toBe(401);
    }
    const bindingBlocked = await handleSessionAuthRequest(
      request("/api/v1/auth/register/verify", {
        body,
        headers: { Cookie: bindingCookie(0x30) },
        ...trusted,
      }),
      environment,
      deps,
    );
    expect(bindingBlocked.status).toBe(429);
    expect(bindingBlocked.headers.get("Retry-After")).toBe("600");

    for (let index = 0; index < 4; index += 1) {
      const response = await handleSessionAuthRequest(
        request("/api/v1/auth/register/verify", {
          body,
          headers: { Cookie: bindingCookie(0x40 + index) },
          ...trusted,
        }),
        environment,
        deps,
      );
      expect(response.status).toBe(401);
    }
    const addressBlocked = await handleSessionAuthRequest(
      request("/api/v1/auth/register/verify", {
        body,
        headers: { Cookie: bindingCookie(0x50) },
        ...trusted,
      }),
      environment,
      deps,
    );
    expect(addressBlocked.status).toBe(429);
    expect(addressBlocked.headers.get("Retry-After")).toBe("3600");
    expect(setCookies(addressBlocked)).toEqual([]);

    const otherAddress = await handleSessionAuthRequest(
      request("/api/v1/auth/register/verify", {
        body,
        headers: { Cookie: bindingCookie(0x51) },
        noCf: false,
        cf: { colo: "TST" },
        address: "203.0.113.11",
      }),
      environment,
      deps,
    );
    expect(otherAddress.status).toBe(401);
  });

  it("never mints a binding on a rate-limited verify", async () => {
    const clock = fakeClock();
    const environment = authEnv();
    const deps = dependencies(clock);
    const trusted = {
      noCf: false,
      cf: { colo: "TST" },
      address: "203.0.113.12",
    };
    const body = registrationVerifyBody(
      base64Url(bytes(16, 0x61)),
      base64Url(bytes(1, 0x61)),
    );
    for (let index = 0; index < 10; index += 1) {
      const response = await handleSessionAuthRequest(
        request("/api/v1/auth/register/verify", {
          body,
          headers: { Cookie: bindingCookie(0x60 + index) },
          ...trusted,
        }),
        environment,
        deps,
      );
      expect(response.status).toBe(401);
    }
    const missing = await handleSessionAuthRequest(
      request("/api/v1/auth/register/verify", { body, ...trusted }),
      environment,
      deps,
    );
    expect(missing.status).toBe(429);
    expect(setCookies(missing)).toEqual([]);
    expect(await countRows("challenges")).toBe(0);
  });

  it("consumes unknown credential budgets without lookup enumeration", async () => {
    const clock = fakeClock();
    const environment = authEnv();
    const deps = dependencies(clock);
    const canary = "unknown-credential-canary";
    const credentialId = base64Url(new TextEncoder().encode(canary));
    for (let index = 0; index < 10; index += 1) {
      const response = await handleSessionAuthRequest(
        request("/api/v1/auth/sign-in/verify", {
          body: {
            challenge_id: base64Url(bytes(16, 0x11)),
            credential: {
              id: credentialId,
              rawId: credentialId,
              type: "public-key",
              response: {
                clientDataJSON: "AQ",
                authenticatorData: "AQ",
                signature: "AQ",
                userHandle: base64Url(bytes(32, 0x12)),
              },
            },
          },
          headers: { Cookie: bindingCookie(0x70 + index) },
        }),
        environment,
        deps,
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: { code: "authentication_failed" },
      });
    }
    const spies = ["debug", "info", "log", "warn", "error"].map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    let blocked;
    try {
      blocked = await handleSessionAuthRequest(
        request("/api/v1/auth/sign-in/verify", {
          body: {
            challenge_id: base64Url(bytes(16, 0x11)),
            credential: {
              id: credentialId,
              rawId: credentialId,
              type: "public-key",
              response: {
                clientDataJSON: "AQ",
                authenticatorData: "AQ",
                signature: "AQ",
                userHandle: base64Url(bytes(32, 0x12)),
              },
            },
          },
          headers: { Cookie: bindingCookie(0x7a) },
        }),
        environment,
        deps,
      );
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(blocked.status).toBe(429);
    const text = await blocked.clone().text();
    expect(text).toBe('{"error":{"code":"rate_limited"}}');
    expect(text).not.toContain(canary);
    for (const spy of spies)
      expect(JSON.stringify(spy.mock.calls)).not.toContain(canary);
    const keys = await queryFirst(
      "SELECT group_concat(bucket_key) AS keys FROM auth_rate_limit_counters",
    );
    expect(keys.keys).not.toContain(canary);
    expect(keys.keys).not.toContain(base64Url(bytes(32, 0x7a)));

    const otherCredential = await handleSessionAuthRequest(
      request("/api/v1/auth/sign-in/verify", {
        body: assertionBody({ credentialFill: 0x7b, userHandle: 0x12 }),
        headers: { Cookie: bindingCookie(0x7b) },
      }),
      environment,
      deps,
    );
    expect(otherCredential.status).toBe(401);
  });

  it("limits binding and credential budgets independently", async () => {
    const clock = alignedClock(600_000);
    const environment = authEnv();
    const deps = dependencies(clock);
    for (let index = 0; index < 10; index += 1) {
      const response = await handleSessionAuthRequest(
        request("/api/v1/auth/sign-in/verify", {
          body: assertionBody({
            credentialFill: 0x20 + index,
            userHandle: 0x30,
          }),
          headers: { Cookie: bindingCookie(0x80) },
        }),
        environment,
        deps,
      );
      expect(response.status).toBe(401);
    }
    const bindingBlocked = await handleSessionAuthRequest(
      request("/api/v1/auth/sign-in/verify", {
        body: assertionBody({ credentialFill: 0x40, userHandle: 0x30 }),
        headers: { Cookie: bindingCookie(0x80) },
      }),
      environment,
      deps,
    );
    expect(bindingBlocked.status).toBe(429);
    expect(bindingBlocked.headers.get("Retry-After")).toBe("600");

    const otherBinding = await handleSessionAuthRequest(
      request("/api/v1/auth/sign-in/verify", {
        body: assertionBody({ credentialFill: 0x41, userHandle: 0x30 }),
        headers: { Cookie: bindingCookie(0x81) },
      }),
      environment,
      deps,
    );
    expect(otherBinding.status).toBe(401);
  });

  it("limits step-up verification by session and isolates another session", async () => {
    const clock = alignedClock(600_000);
    const account = await registerAccount({ clock });
    const body = assertionBody({ credentialFill: 0x90, userHandle: undefined });
    for (let index = 0; index < 10; index += 1) {
      const response = await handleSessionAuthRequest(
        request("/api/v1/auth/step-up/verify", {
          body,
          headers: {
            Cookie: `${SESSION}=${account.session}`,
            "X-CSRF-Token": account.csrf,
          },
        }),
        account.env,
        account.deps,
      );
      expect(response.status).toBe(401);
    }
    const blocked = await handleSessionAuthRequest(
      request("/api/v1/auth/step-up/verify", {
        body,
        headers: {
          Cookie: `${SESSION}=${account.session}`,
          "X-CSRF-Token": account.csrf,
        },
      }),
      account.env,
      account.deps,
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("600");
    expect(setCookies(blocked)).toEqual([]);

    const second = await createSecondSession(account, 0x91);
    const other = await handleSessionAuthRequest(
      request("/api/v1/auth/step-up/verify", {
        body,
        headers: {
          Cookie: `${SESSION}=${second.material.token}`,
          "X-CSRF-Token": second.material.csrfToken,
        },
      }),
      account.env,
      account.deps,
    );
    expect(other.status).toBe(401);
  });
});

describe("account and session fixed windows", () => {
  it("limits credential addition per account and keeps CSRF/recent-auth order", async () => {
    const clock = alignedClock(3_600_000);
    const account = await registerAccount({ clock });
    await stepUp(account);
    const cookie = `${SESSION}=${account.session}`;
    for (let index = 0; index < 10; index += 1) {
      const response = await handleSessionAuthRequest(
        request("/api/v1/auth/credentials/options", {
          body: {},
          headers: { Cookie: cookie, "X-CSRF-Token": account.csrf },
        }),
        account.env,
        account.deps,
      );
      expect(response.status).toBe(200);
    }
    const blocked = await handleSessionAuthRequest(
      request("/api/v1/auth/credentials/options", {
        body: {},
        headers: { Cookie: cookie, "X-CSRF-Token": account.csrf },
      }),
      account.env,
      account.deps,
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("3600");
    expect(setCookies(blocked)).toEqual([]);

    const verifyBlocked = await handleSessionAuthRequest(
      request("/api/v1/auth/credentials/verify", {
        body: registrationVerifyBody(
          base64Url(bytes(16, 0x71)),
          base64Url(bytes(1, 0x71)),
        ),
        headers: {
          Cookie: `${SESSION}=${account.session}; ${BINDING}=${account.binding}`,
          "X-CSRF-Token": account.csrf,
        },
      }),
      account.env,
      account.deps,
    );
    expect(verifyBlocked.status).toBe(429);
    expect(verifyBlocked.headers.get("Retry-After")).toBe("3600");

    const noCsrf = await handleSessionAuthRequest(
      request("/api/v1/auth/credentials/options", {
        body: {},
        headers: { Cookie: cookie },
      }),
      account.env,
      account.deps,
    );
    expect(noCsrf.status).toBe(403);
    expect((await noCsrf.json()).error.code).toBe("csrf_forbidden");

    clock.advance(5 * 60 * 1000 + 1);
    const stale = await handleSessionAuthRequest(
      request("/api/v1/auth/credentials/options", {
        body: {},
        headers: { Cookie: cookie, "X-CSRF-Token": account.csrf },
      }),
      account.env,
      account.deps,
    );
    expect(stale.status).toBe(403);
    expect((await stale.json()).error.code).toBe("recent_auth_required");

    const second = await registerAccount({ clock });
    await stepUp(second);
    const other = await handleSessionAuthRequest(
      request("/api/v1/auth/credentials/options", {
        body: {},
        headers: {
          Cookie: `${SESSION}=${second.session}`,
          "X-CSRF-Token": second.csrf,
        },
      }),
      second.env,
      second.deps,
    );
    expect(other.status).toBe(200);
  });

  it("limits logout-all per account before revocation and fails closed", async () => {
    const clock = alignedClock(3_600_000);
    const account = await registerAccount({ clock });
    const cookie = `${SESSION}=${account.session}`;
    await env.DB.exec(
      "CREATE TRIGGER reject_logout_all BEFORE UPDATE ON sessions WHEN NEW.revoked_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'synthetic_logout_all'); END",
    );
    try {
      for (let index = 0; index < 5; index += 1) {
        const response = await handleSessionAuthRequest(
          request("/api/v1/auth/logout-all", {
            headers: { Cookie: cookie, "X-CSRF-Token": account.csrf },
          }),
          account.env,
          account.deps,
        );
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          error: { code: "temporarily_unavailable" },
        });
        expect(setCookies(response)).toEqual([]);
      }
      const blocked = await handleSessionAuthRequest(
        request("/api/v1/auth/logout-all", {
          headers: { Cookie: cookie, "X-CSRF-Token": account.csrf },
        }),
        account.env,
        account.deps,
      );
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBe("3600");
      expect(setCookies(blocked)).toEqual([]);
    } finally {
      await env.DB.exec("DROP TRIGGER reject_logout_all");
    }

    clock.advance(3_600_000);
    const second = await createSecondSession(account, 0x94);
    const recovered = await handleSessionAuthRequest(
      request("/api/v1/auth/logout-all", {
        headers: {
          Cookie: `${SESSION}=${second.material.token}`,
          "X-CSRF-Token": second.material.csrfToken,
        },
      }),
      account.env,
      account.deps,
    );
    expect(recovered.status).toBe(204);
    expect(setCookies(recovered)).toHaveLength(1);
  });

  it("admits 120 concurrent session-status requests and rejects the rest", async () => {
    const clock = alignedClock(60_000);
    const account = await registerAccount({ clock });
    const cookie = `${SESSION}=${account.session}`;
    const responses = await Promise.all(
      Array.from({ length: 125 }, () =>
        handleSessionAuthRequest(
          request("/api/v1/auth/session", {
            method: "GET",
            origin: null,
            headers: { Cookie: cookie },
          }),
          account.env,
          account.deps,
        ),
      ),
    );
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(120);
    const blocked = responses.filter((response) => response.status === 429);
    expect(blocked).toHaveLength(5);
    for (const response of blocked) {
      expect(await response.json()).toEqual({
        error: { code: "rate_limited" },
      });
      expect(response.headers.get("Retry-After")).toBe("60");
      expect(setCookies(response)).toEqual([]);
    }
    const second = await createSecondSession(account, 0x92);
    const other = await sessionStatus(
      account,
      `${SESSION}=${second.material.token}`,
    );
    expect(other.status).toBe(200);
  });

  it("exposes a reusable session-sync guard without registering sync auth", async () => {
    const clock = alignedClock(60_000);
    const account = await registerAccount({ clock });
    const admission = createSessionAdmission({ db: env.DB, now: clock.now });
    const config = { mode: "session", origin: ORIGIN };
    const countersBefore = await countRows("auth_rate_limit_counters");
    const authHeaders = {
      Origin: ORIGIN,
      Cookie: `${SESSION}=${account.session}`,
      "X-CSRF-Token": account.csrf,
    };
    const syncRequest = (headers = authHeaders) =>
      new Request(`${ORIGIN}/api/v1/sync/document`, {
        method: "POST",
        headers,
      });

    const noCsrf = await admission
      .admitSessionSync(
        syncRequest({ Origin: ORIGIN, Cookie: authHeaders.Cookie }),
        config,
        account.env,
      )
      .then(
        () => null,
        (error) => error,
      );
    expect(noCsrf).toMatchObject({ code: "csrf_forbidden" });
    expect(await countRows("auth_rate_limit_counters")).toBe(countersBefore);

    for (let index = 0; index < 120; index += 1) {
      const admitted = await admission.admitSessionSync(
        syncRequest(),
        config,
        account.env,
      );
      expect(admitted.session.account.handle).toBe(account.handle);
    }
    const blocked = await admission
      .admitSessionSync(syncRequest(), config, account.env)
      .then(
        () => null,
        (error) => error,
      );
    expect(blocked).toMatchObject({ code: "rate_limited", retryAfter: 60 });
    expect(await countRows("documents")).toBe(1);

    const second = await createSecondSession(account, 0x93);
    const other = await admission.admitSessionSync(
      syncRequest({
        Origin: ORIGIN,
        Cookie: `${SESSION}=${second.material.token}`,
        "X-CSRF-Token": second.material.csrfToken,
      }),
      config,
      account.env,
    );
    expect(other.session.account.handle).toBe(account.handle);

    const pull = await admission.admitSessionSync(
      new Request(
        `${ORIGIN}/api/v1/sync/documents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/changes`,
        {
          method: "GET",
          headers: {
            Origin: ORIGIN,
            Cookie: `${SESSION}=${second.material.token}`,
          },
        },
      ),
      config,
      account.env,
      { csrf: false },
    );
    expect(pull.session.account.handle).toBe(account.handle);

    const bridge = await worker.fetch(
      new Request(`${ORIGIN}/api/v1/sync/document`, {
        method: "POST",
        headers: { Cookie: `${SESSION}=${account.session}` },
      }),
      account.env,
    );
    expect(bridge.status).toBe(404);
  });
});

describe("rejection order and failure redaction", () => {
  it("keeps mode, Origin, route, method, media, and body failures ahead of 429", async () => {
    const clock = fakeClock();
    const environment = authEnv();
    const deps = dependencies(clock);
    const trusted = {
      noCf: false,
      cf: { colo: "TST" },
      address: "203.0.113.13",
    };
    const body = registrationVerifyBody(
      base64Url(bytes(16, 0x31)),
      base64Url(bytes(1, 0x31)),
    );
    for (let index = 0; index < 10; index += 1) {
      const response = await handleSessionAuthRequest(
        request("/api/v1/auth/register/verify", {
          body,
          headers: { Cookie: bindingCookie(0xa0 + index) },
          ...trusted,
        }),
        environment,
        deps,
      );
      expect(response.status).toBe(401);
    }

    const wrongOrigin = await handleSessionAuthRequest(
      request("/api/v1/auth/register/verify", {
        body,
        origin: "https://evil.example",
        headers: { Cookie: bindingCookie(0xb0) },
        ...trusted,
      }),
      environment,
      deps,
    );
    expect(wrongOrigin.status).toBe(403);

    const unknownRoute = await handleSessionAuthRequest(
      request("/api/v1/auth/unknown", { body: {}, ...trusted }),
      environment,
      deps,
    );
    expect(unknownRoute.status).toBe(404);

    const wrongMethod = await handleSessionAuthRequest(
      request("/api/v1/auth/register/verify", {
        method: "GET",
        origin: null,
        ...trusted,
      }),
      environment,
      deps,
    );
    expect(wrongMethod.status).toBe(405);

    const wrongMedia = await handleSessionAuthRequest(
      request("/api/v1/auth/register/verify", {
        body: "{}",
        contentType: "text/plain",
        headers: { Cookie: bindingCookie(0xb1) },
        ...trusted,
      }),
      environment,
      deps,
    );
    expect(wrongMedia.status).toBe(415);

    const oversized = await handleSessionAuthRequest(
      request("/api/v1/auth/register/verify", {
        body: `{"x":"${"a".repeat(33 * 1024)}"}`,
        ...trusted,
      }),
      environment,
      deps,
    );
    expect(oversized.status).toBe(413);

    const malformed = await handleSessionAuthRequest(
      request("/api/v1/auth/register/verify", {
        body: "{",
        ...trusted,
      }),
      environment,
      deps,
    );
    expect(malformed.status).toBe(400);

    const missingBinding = await handleSessionAuthRequest(
      request("/api/v1/auth/register/verify", { body, ...trusted }),
      environment,
      deps,
    );
    expect(missingBinding.status).toBe(429);
    expect(setCookies(missingBinding)).toEqual([]);

    const noMode = await handleSessionAuthRequest(
      request("/api/v1/auth/register/verify", {
        body,
        headers: { Cookie: bindingCookie(0xb2) },
        ...trusted,
      }),
      authEnv({ AUTH_MODE: undefined }),
      deps,
    );
    expect(noMode.status).toBe(404);
  });

  it("applies the rate limit before challenge consumption and attestation parsing", async () => {
    const clock = fakeClock();
    const environment = authEnv();
    const deps = dependencies(clock);
    const trusted = {
      noCf: false,
      cf: { colo: "TST" },
      address: "203.0.113.14",
    };
    const optionsResponse = await handleSessionAuthRequest(
      request("/api/v1/auth/register/options", { body: {}, ...trusted }),
      environment,
      deps,
    );
    expect(optionsResponse.status).toBe(200);
    const options = await optionsResponse.json();
    const binding = cookieValueFromResponse(optionsResponse, BINDING);
    const fakeBody = registrationVerifyBody(
      base64Url(bytes(16, 0x41)),
      base64Url(bytes(1, 0x41)),
    );
    for (let index = 0; index < 10; index += 1) {
      const response = await handleSessionAuthRequest(
        request("/api/v1/auth/register/verify", {
          body: fakeBody,
          headers: { Cookie: bindingCookie(0xc0 + index) },
          ...trusted,
        }),
        environment,
        deps,
      );
      expect(response.status).toBe(401);
    }
    const blocked = await handleSessionAuthRequest(
      request("/api/v1/auth/register/verify", {
        body: registrationVerifyBody(
          options.challenge_id,
          base64Url(bytes(1, 0x42)),
        ),
        headers: { Cookie: `${BINDING}=${binding}` },
        ...trusted,
      }),
      environment,
      deps,
    );
    expect(blocked.status).toBe(429);
    expect(
      await queryFirst(
        "SELECT consumed_at FROM challenges WHERE id = ?1",
        options.challenge_id,
      ),
    ).toEqual({ consumed_at: null });
  });

  it("returns a redacted 503 on rate counter storage failure without clearing the cookie", async () => {
    const clock = fakeClock();
    const account = await registerAccount({ clock });
    const canary = "sql-canary-rate-storage";
    await env.DB.exec(
      `CREATE TRIGGER reject_rate_storage BEFORE INSERT ON auth_rate_limit_counters BEGIN SELECT RAISE(ABORT, '${canary}'); END`,
    );
    const spies = ["debug", "info", "log", "warn", "error"].map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    let response;
    try {
      response = await sessionStatus(account);
    } finally {
      for (const spy of spies) spy.mockRestore();
      await env.DB.exec("DROP TRIGGER reject_rate_storage");
    }
    expect(response.status).toBe(503);
    const text = await response.clone().text();
    expect(text).toBe('{"error":{"code":"temporarily_unavailable"}}');
    expect(text).not.toContain(canary);
    expect(text).not.toContain(account.session);
    expect(setCookies(response)).toEqual([]);
    for (const spy of spies)
      expect(JSON.stringify(spy.mock.calls)).not.toContain(canary);

    const recovered = await sessionStatus(account);
    expect(recovered.status).toBe(200);
  });
});
