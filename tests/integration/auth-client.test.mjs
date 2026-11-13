import assert from "node:assert/strict";
import test from "node:test";

const {
  AuthClientError,
  createAuthClient,
  parseCredentialOptions,
  serializeAssertionCredential,
  serializeRegistrationCredential,
} = await import("../../apps/web/public/auth-client.js");

const PRF_CANARY = "prf-canary-183-must-not-leak";
const CREDENTIAL_CANARY = "credential-canary-183-must-not-leak";

function bytes(...values) {
  return Uint8Array.from(values).buffer;
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function registrationOptions(overrides = {}) {
  return {
    challenge_id: "AQEBAQEBAQEBAQEBAQEBAQ",
    publicKey: {
      rp: { id: "localhost", name: "Tanikun" },
      user: {
        id: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
        name: "Alice",
        displayName: "Alice",
      },
      challenge: "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      timeout: 120_000,
      excludeCredentials: [],
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
      attestation: "none",
      ...overrides,
    },
  };
}

function assertionOptions(overrides = {}) {
  return {
    challenge_id: "AgICAgICAgICAgICAgICAg",
    publicKey: {
      challenge: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      timeout: 120_000,
      rpId: "localhost",
      allowCredentials: [],
      userVerification: "required",
      ...overrides,
    },
  };
}

function syntheticRegistrationCredential() {
  const rawId = bytes(1, 2, 3, 4, 5, 6, 7, 8);
  const response = {
    clientDataJSON: bytes(9, 10, 11),
    attestationObject: bytes(12, 13, 14),
    authenticatorAttachment: CREDENTIAL_CANARY,
    transports: [CREDENTIAL_CANARY],
  };
  return {
    id: base64Url(rawId),
    rawId,
    type: "public-key",
    response,
    clientExtensionResults: {
      prf: { results: { first: PRF_CANARY } },
    },
    authenticatorAttachment: "platform",
    get toJSON() {
      throw new Error("toJSON must never be called");
    },
  };
}

function syntheticAssertionCredential() {
  const rawId = bytes(21, 22, 23, 24);
  return {
    id: base64Url(rawId),
    rawId,
    type: "public-key",
    response: {
      clientDataJSON: bytes(25, 26),
      authenticatorData: bytes(27, 28, 29),
      signature: bytes(30, 31, 32),
      userHandle: bytes(
        ...Array.from({ length: 32 }, (_, index) => 33 + index),
      ),
      clientExtensionResults: {
        prf: { results: { first: PRF_CANARY } },
      },
    },
    clientExtensionResults: {
      prf: { results: { first: PRF_CANARY } },
    },
    get toJSON() {
      throw new Error("toJSON must never be called");
    },
  };
}

const activeSession = {
  account: {
    handle: "BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ",
    display_name: "Alice",
  },
  expires_at: 1_760_000_000_000,
  idle_expires_at: 1_760_001_800_000,
  recent_auth: true,
  recent_auth_expires_at: 1_760_000_300_000,
  csrf_token: "BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU",
};

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function createFetch(responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next(url, init);
    return next;
  };
  return { fetch, calls };
}

test("registration serializer emits only the verification allowlist", () => {
  const serialized = serializeRegistrationCredential(
    syntheticRegistrationCredential(),
  );
  assert.deepEqual(Object.keys(serialized).toSorted(), [
    "id",
    "rawId",
    "response",
    "type",
  ]);
  assert.deepEqual(Object.keys(serialized.response).toSorted(), [
    "attestationObject",
    "clientDataJSON",
  ]);
  assert.equal(serialized.id, base64Url(bytes(1, 2, 3, 4, 5, 6, 7, 8)));
  assert.equal(serialized.rawId, serialized.id);
  assert.equal(serialized.type, "public-key");
  assert.equal(serialized.response.clientDataJSON, base64Url(bytes(9, 10, 11)));
  assert.equal(
    serialized.response.attestationObject,
    base64Url(bytes(12, 13, 14)),
  );
  const body = JSON.stringify(serialized);
  assert.equal(body.includes(PRF_CANARY), false);
  assert.equal(body.includes(CREDENTIAL_CANARY), false);
  assert.equal(body.includes("clientExtensionResults"), false);
  assert.equal(body.includes("prf"), false);
  assert.equal(body.includes("transports"), false);
});

test("assertion serializer emits only the verification allowlist", () => {
  const serialized = serializeAssertionCredential(
    syntheticAssertionCredential(),
  );
  assert.deepEqual(Object.keys(serialized).toSorted(), [
    "id",
    "rawId",
    "response",
    "type",
  ]);
  assert.deepEqual(Object.keys(serialized.response).toSorted(), [
    "authenticatorData",
    "clientDataJSON",
    "signature",
    "userHandle",
  ]);
  assert.equal(
    serialized.response.userHandle,
    base64Url(bytes(...Array.from({ length: 32 }, (_, index) => 33 + index))),
  );
  const body = JSON.stringify(serialized);
  assert.equal(body.includes(PRF_CANARY), false);
  assert.equal(body.includes(CREDENTIAL_CANARY), false);
  assert.equal(body.includes("clientExtensionResults"), false);
  assert.equal(body.includes("prf"), false);
});

test("serializers reject malformed credentials instead of passing fields through", () => {
  const wrongType = syntheticRegistrationCredential();
  Object.defineProperty(wrongType, "type", { value: "password" });
  assert.throws(
    () => serializeRegistrationCredential(wrongType),
    (error) => error.code === "unsupported",
  );
  const missingResponse = {
    id: "AQ",
    rawId: bytes(1),
    type: "public-key",
    response: {},
  };
  assert.throws(
    () => serializeRegistrationCredential(missingResponse),
    (error) => error.code === "unsupported",
  );
  const assertion = syntheticAssertionCredential();
  assertion.response.userHandle = null;
  assert.throws(
    () => serializeAssertionCredential(assertion),
    (error) => error.code === "unsupported",
  );
});

test("registration options are projected without extensions or hints", () => {
  const parsed = parseCredentialOptions(registrationOptions(), "registration");
  assert.equal(parsed.challengeId, "AQEBAQEBAQEBAQEBAQEBAQ");
  assert.deepEqual(Object.keys(parsed.publicKey).toSorted(), [
    "attestation",
    "authenticatorSelection",
    "challenge",
    "excludeCredentials",
    "pubKeyCredParams",
    "rp",
    "timeout",
    "user",
  ]);
  assert.equal(parsed.publicKey.challenge instanceof ArrayBuffer, true);
  assert.equal(parsed.publicKey.challenge.byteLength, 32);
  assert.equal(parsed.publicKey.user.id instanceof ArrayBuffer, true);
  assert.equal(parsed.publicKey.user.id.byteLength, 32);
  assert.equal(parsed.publicKey.attestation, "none");
  assert.equal(Object.hasOwn(parsed.publicKey, "extensions"), false);
});

test("credential options reject extension fields, mixed fields, and wrong policy", () => {
  assert.throws(
    () =>
      parseCredentialOptions(
        registrationOptions({ extensions: { prf: { eval: {} } } }),
        "registration",
      ),
    (error) =>
      error.code === "malformed" && !String(error).includes(PRF_CANARY),
  );
  assert.throws(
    () =>
      parseCredentialOptions(
        registrationOptions({
          rp: { id: "localhost", name: "Tanikun" },
          userVerification: "preferred",
        }),
        "registration",
      ),
    (error) => error.code === "malformed",
  );
  assert.throws(
    () =>
      parseCredentialOptions(
        assertionOptions({
          allowCredentials: [{ type: "public-key", id: "AQ" }],
        }),
        "sign_in",
      ),
    (error) => error.code === "malformed",
  );
  assert.throws(
    () =>
      parseCredentialOptions(
        registrationOptions({ attestation: "direct" }),
        "registration",
      ),
    (error) => error.code === "malformed",
  );
});

test("registration uses a projected PublicKeyCredentialCreationOptions", async () => {
  const calls = [];
  const credential = syntheticRegistrationCredential();
  const order = [
    jsonResponse(registrationOptions()),
    jsonResponse({ session: activeSession }),
  ];
  const { fetch, calls: fetchCalls } = createFetch(order);
  const client = createAuthClient({
    fetch,
    baseUrl: "https://localhost:4300",
    credentials: {
      async create(options) {
        calls.push(options);
        return credential;
      },
    },
  });

  const session = await client.register({ displayName: "Alice" });
  assert.equal(session.account.display_name, "Alice");
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].publicKey).toSorted(), [
    "attestation",
    "authenticatorSelection",
    "challenge",
    "excludeCredentials",
    "pubKeyCredParams",
    "rp",
    "timeout",
    "user",
  ]);
  assert.deepEqual(
    fetchCalls[0].url,
    "https://localhost:4300/api/v1/auth/register/options",
  );
  assert.equal(fetchCalls[0].init.method, "POST");
  assert.equal(fetchCalls[0].init.credentials, "same-origin");
  assert.equal(fetchCalls[0].init.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(fetchCalls[0].init.body), {
    display_name: "Alice",
  });
  assert.equal(
    fetchCalls[1].url,
    "https://localhost:4300/api/v1/auth/register/verify",
  );
  const verifyBody = JSON.parse(fetchCalls[1].init.body);
  assert.deepEqual(Object.keys(verifyBody).toSorted(), [
    "challenge_id",
    "credential",
  ]);
  assert.equal(JSON.stringify(verifyBody).includes(PRF_CANARY), false);
  assert.equal(
    JSON.stringify(verifyBody).includes("clientExtensionResults"),
    false,
  );
});

test("sign-in uses discoverable assertion options and serializes userHandle", async () => {
  const calls = [];
  const order = [
    jsonResponse(assertionOptions()),
    jsonResponse({ session: activeSession }),
  ];
  const { fetch, calls: fetchCalls } = createFetch(order);
  const client = createAuthClient({
    fetch,
    baseUrl: "https://localhost:4300",
    credentials: {
      async get(options) {
        calls.push(options);
        return syntheticAssertionCredential();
      },
    },
  });
  const session = await client.signIn();
  assert.equal(
    session.account.handle,
    "BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ",
  );
  assert.deepEqual(Object.keys(calls[0].publicKey).toSorted(), [
    "allowCredentials",
    "challenge",
    "rpId",
    "timeout",
    "userVerification",
  ]);
  const verifyBody = JSON.parse(fetchCalls[1].init.body);
  assert.equal(
    verifyBody.credential.response.userHandle,
    base64Url(bytes(...Array.from({ length: 32 }, (_, index) => 33 + index))),
  );
  assert.equal(
    Object.hasOwn(verifyBody.credential.response, "clientExtensionResults"),
    false,
  );
});

test("logout sends the in-memory CSRF token and never puts a token in the URL", async () => {
  const { fetch, calls } = createFetch([new Response(null, { status: 204 })]);
  const client = createAuthClient({ fetch, baseUrl: "https://localhost:4300" });
  await client.logout({
    csrfToken: "BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU",
  });
  assert.equal(calls[0].url, "https://localhost:4300/api/v1/auth/logout");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(
    calls[0].init.headers["X-CSRF-Token"],
    "BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU",
  );
  assert.equal(
    calls[0].url.includes("BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU"),
    false,
  );
  assert.equal(calls[0].init.body, undefined);
});

test("canceled, unsupported, expired, offline, and rate-limited outcomes are explicit", async () => {
  for (const [name, code] of [
    ["NotAllowedError", "canceled"],
    ["AbortError", "canceled"],
    ["SecurityError", "unsupported"],
  ]) {
    const { fetch } = createFetch([jsonResponse(registrationOptions())]);
    const client = createAuthClient({
      fetch,
      baseUrl: "https://localhost:4300",
      credentials: {
        async create() {
          const error = new Error(name);
          error.name = name;
          throw error;
        },
      },
    });
    await assert.rejects(
      client.register({ displayName: "Alice" }),
      (error) => error instanceof AuthClientError && error.code === code,
    );
  }

  {
    const { fetch } = createFetch([
      jsonResponse({ error: { code: "authentication_failed" } }, 401),
    ]);
    const client = createAuthClient({
      fetch,
      baseUrl: "https://localhost:4300",
      credentials: {
        async get() {
          return null;
        },
      },
    });
    await assert.rejects(client.signIn(), (error) => error.code === "expired");
  }
  {
    const { fetch } = createFetch([new TypeError("network down")]);
    const client = createAuthClient({
      fetch,
      baseUrl: "https://localhost:4300",
      credentials: {
        async get() {
          return null;
        },
      },
    });
    await assert.rejects(client.signIn(), (error) => error.code === "offline");
  }
  {
    const { fetch } = createFetch([
      jsonResponse({ error: { code: "rate_limited" } }, 429, {
        "retry-after": "7",
      }),
    ]);
    const client = createAuthClient({
      fetch,
      baseUrl: "https://localhost:4300",
      credentials: {
        async get() {
          return null;
        },
      },
    });
    await assert.rejects(
      client.signIn(),
      (error) => error.code === "rate_limited" && error.retryAfter === 7,
    );
  }
});

test("auth requests never carry a bearer token or cross-origin credentials", async () => {
  const { fetch, calls } = createFetch([jsonResponse({ session: null })]);
  const client = createAuthClient({ fetch, baseUrl: "https://localhost:4300" });
  await client.status();
  assert.equal(calls[0].url, "https://localhost:4300/api/v1/auth/session");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].url.includes("token"), false);
});

test("aborting a pending native ceremony prevents the verify request", async () => {
  let createOptions;
  let verifyCalls = 0;
  const { fetch } = createFetch([
    jsonResponse(registrationOptions()),
    () => {
      verifyCalls += 1;
      return jsonResponse({ session: activeSession });
    },
  ]);
  const controller = new AbortController();
  const client = createAuthClient({
    fetch,
    baseUrl: "https://localhost:4300",
    credentials: {
      create(options) {
        createOptions = options;
        controller.abort();
        return Promise.resolve(syntheticRegistrationCredential());
      },
    },
  });
  await assert.rejects(
    client.register({ displayName: "Alice", signal: controller.signal }),
    (error) => error.code === "canceled",
  );
  assert.equal(createOptions.signal, controller.signal);
  assert.equal(verifyCalls, 0);
});

test("aborting a pending assertion prevents the verify request", async () => {
  let getOptions;
  let verifyCalls = 0;
  const { fetch } = createFetch([
    jsonResponse(assertionOptions()),
    () => {
      verifyCalls += 1;
      return jsonResponse({ session: activeSession });
    },
  ]);
  const controller = new AbortController();
  const client = createAuthClient({
    fetch,
    baseUrl: "https://localhost:4300",
    credentials: {
      get(options) {
        getOptions = options;
        controller.abort();
        return Promise.resolve(syntheticAssertionCredential());
      },
    },
  });
  await assert.rejects(
    client.signIn({ signal: controller.signal }),
    (error) => error.code === "canceled",
  );
  assert.equal(getOptions.signal, controller.signal);
  assert.equal(verifyCalls, 0);
});

test("a stale account fence after native credentials stops verification without broadcasts", async () => {
  for (const operation of ["register", "signIn"]) {
    const { fetch, calls } = createFetch([
      jsonResponse(
        operation === "register" ? registrationOptions() : assertionOptions(),
      ),
      jsonResponse({ session: activeSession }),
    ]);
    const client = createAuthClient({
      fetch,
      baseUrl: "https://localhost:4300",
      credentials: {
        create: async () => syntheticRegistrationCredential(),
        get: async () => syntheticAssertionCredential(),
      },
    });
    await assert.rejects(
      client[operation]({
        beforeVerify: async () => {
          throw Object.assign(new Error("stale"), { code: "stale_account" });
        },
      }),
      { code: "stale_account" },
    );
    assert.equal(calls.length, 1);
  }
});

function credentialMetadata(overrides = {}) {
  return {
    id: "AQ",
    created_at: 1_760_000_000_000,
    last_used_at: 1_760_000_010_000,
    backup_eligible: false,
    backup_state: false,
    ...overrides,
  };
}

function stepUpOptions(overrides = {}) {
  const options = assertionOptions(overrides);
  options.publicKey.allowCredentials = [
    { type: "public-key", id: "AQ" },
    { type: "public-key", id: "Ag" },
  ];
  return options;
}

test("listCredentials reads only minimal owned metadata without tokens", async () => {
  const { fetch, calls } = createFetch([
    jsonResponse({
      credentials: [
        credentialMetadata(),
        credentialMetadata({
          id: "Ag",
          backup_eligible: true,
          backup_state: true,
        }),
      ],
    }),
  ]);
  const client = createAuthClient({ fetch, baseUrl: "https://localhost:4300" });
  const credentials = await client.listCredentials();
  assert.deepEqual(credentials, [
    credentialMetadata(),
    credentialMetadata({
      id: "Ag",
      backup_eligible: true,
      backup_state: true,
    }),
  ]);
  assert.equal(calls[0].url, "https://localhost:4300/api/v1/auth/credentials");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.body, undefined);
  assert.equal(JSON.stringify(credentials).includes("csrf"), false);
  assert.equal(JSON.stringify(credentials).includes("public_key"), false);
});

test("listCredentials rejects unknown, duplicate, or malformed metadata", async () => {
  for (const body of [
    { credentials: [credentialMetadata({ public_key: "canary" })] },
    {
      credentials: [credentialMetadata(), credentialMetadata()],
    },
    { credentials: [credentialMetadata({ id: "not/base64url!" })] },
    { credentials: [credentialMetadata({ created_at: -1 })] },
  ]) {
    const { fetch } = createFetch([jsonResponse(body)]);
    const client = createAuthClient({
      fetch,
      baseUrl: "https://localhost:4300",
    });
    await assert.rejects(
      client.listCredentials(),
      (error) => error.code === "malformed",
    );
  }
});

test("addCredential uses projected options, CSRF, and only allowlisted fields", async () => {
  const { fetch, calls } = createFetch([
    jsonResponse(registrationOptions()),
    jsonResponse({ credential: credentialMetadata() }),
  ]);
  const nativelyCreated = syntheticRegistrationCredential();
  const client = createAuthClient({
    fetch,
    baseUrl: "https://localhost:4300",
    credentials: {
      async create() {
        return nativelyCreated;
      },
    },
  });
  const csrf = activeSession.csrf_token;
  const added = await client.addCredential({ csrfToken: csrf });
  assert.equal(added.id, "AQ");
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].url,
    "https://localhost:4300/api/v1/auth/credentials/options",
  );
  assert.equal(
    calls[1].url,
    "https://localhost:4300/api/v1/auth/credentials/verify",
  );
  assert.equal(calls[0].init.headers["X-CSRF-Token"], csrf);
  assert.equal(calls[1].init.headers["X-CSRF-Token"], csrf);
  const verifyBody = JSON.parse(calls[1].init.body);
  assert.deepEqual(Object.keys(verifyBody).toSorted(), [
    "challenge_id",
    "credential",
  ]);
  assert.deepEqual(Object.keys(verifyBody.credential.response).toSorted(), [
    "attestationObject",
    "clientDataJSON",
  ]);
  assert.equal(JSON.stringify(verifyBody).includes(PRF_CANARY), false);
  assert.equal(
    JSON.stringify(verifyBody).includes("clientExtensionResults"),
    false,
  );
});

test("stepUp accepts a nonempty allow list and an omitted userHandle", async () => {
  const { fetch, calls } = createFetch([
    jsonResponse(stepUpOptions()),
    jsonResponse({
      recent_auth: true,
      recent_auth_expires_at: 1_760_000_300_000,
    }),
  ]);
  const assertion = syntheticAssertionCredential();
  assertion.response.userHandle = null;
  let nativeOptions;
  const client = createAuthClient({
    fetch,
    baseUrl: "https://localhost:4300",
    credentials: {
      async get(options) {
        nativeOptions = options;
        return assertion;
      },
    },
  });
  const result = await client.stepUp({
    csrfToken: activeSession.csrf_token,
  });
  assert.deepEqual(result, {
    recent_auth: true,
    recent_auth_expires_at: 1_760_000_300_000,
  });
  assert.deepEqual(nativeOptions.publicKey.allowCredentials, [
    { type: "public-key", id: bytes(1) },
    { type: "public-key", id: bytes(2) },
  ]);
  assert.equal(calls[0].init.headers["X-CSRF-Token"], activeSession.csrf_token);
  assert.equal(calls[1].init.headers["X-CSRF-Token"], activeSession.csrf_token);
  const verifyBody = JSON.parse(calls[1].init.body);
  assert.equal(
    Object.hasOwn(verifyBody.credential.response, "userHandle"),
    false,
  );
  assert.equal(JSON.stringify(verifyBody).includes(PRF_CANARY), false);
});

test("removeCredential sends only the owned ID and CSRF with a fresh scope fence", async () => {
  const { fetch, calls } = createFetch([new Response(null, { status: 204 })]);
  const client = createAuthClient({ fetch, baseUrl: "https://localhost:4300" });
  let fenceCalls = 0;
  await client.removeCredential({
    credentialId: "AQ",
    csrfToken: activeSession.csrf_token,
    async beforeVerify() {
      fenceCalls += 1;
      return { csrfToken: activeSession.csrf_token };
    },
  });
  assert.equal(fenceCalls, 1);
  assert.equal(
    calls[0].url,
    "https://localhost:4300/api/v1/auth/credentials/AQ/remove",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["X-CSRF-Token"], activeSession.csrf_token);
  assert.equal(calls[0].init.body, undefined);
});

test("credential management errors are explicit and never echo credential data", async () => {
  for (const [code, expected] of [
    ["recent_auth_required", "recent_auth_required"],
    ["credential_limit", "credential_limit"],
    ["last_credential", "last_credential"],
    ["not_found", "not_found"],
  ]) {
    const { fetch } = createFetch([
      jsonResponse(
        { error: { code } },
        code === "recent_auth_required" ? 403 : 409,
      ),
    ]);
    const client = createAuthClient({
      fetch,
      baseUrl: "https://localhost:4300",
    });
    await assert.rejects(
      client.removeCredential({
        credentialId: "AQ",
        csrfToken: activeSession.csrf_token,
      }),
      (error) =>
        error.code === expected &&
        !String(error).includes(PRF_CANARY) &&
        !String(error).includes("AQ"),
    );
  }
});

test("aborting a pending step-up ceremony prevents verification", async () => {
  let verifyCalls = 0;
  const controller = new AbortController();
  const { fetch } = createFetch([
    jsonResponse(stepUpOptions()),
    () => {
      verifyCalls += 1;
      return jsonResponse({
        recent_auth: true,
        recent_auth_expires_at: 1_760_000_300_000,
      });
    },
  ]);
  const client = createAuthClient({
    fetch,
    baseUrl: "https://localhost:4300",
    credentials: {
      get() {
        controller.abort();
        return Promise.resolve(syntheticAssertionCredential());
      },
    },
  });
  await assert.rejects(
    client.stepUp({
      csrfToken: activeSession.csrf_token,
      signal: controller.signal,
    }),
    (error) => error.code === "canceled",
  );
  assert.equal(verifyCalls, 0);
});

test("credential mutations use only the CSRF token from the final scope fence", async () => {
  const fresh = "D".repeat(43);
  const { fetch, calls } = createFetch([new Response(null, { status: 204 })]);
  const client = createAuthClient({ fetch, baseUrl: "https://localhost:4300" });
  await client.removeCredential({
    credentialId: "AQ",
    csrfToken: activeSession.csrf_token,
    async beforeVerify() {
      await Promise.resolve();
      return { csrfToken: fresh };
    },
  });
  assert.equal(calls[0].init.headers["X-CSRF-Token"], fresh);
});

test("a failed final scope fence prevents a credential mutation request", async () => {
  let fetches = 0;
  const client = createAuthClient({
    fetch: async () => {
      fetches += 1;
      return new Response(null, { status: 204 });
    },
    baseUrl: "https://localhost:4300",
  });
  await assert.rejects(
    client.removeCredential({
      credentialId: "AQ",
      csrfToken: activeSession.csrf_token,
      async beforeVerify() {
        throw Object.assign(new Error("stale"), { code: "stale_account" });
      },
    }),
    (error) => error.code === "stale_account",
  );
  assert.equal(fetches, 0);
});
