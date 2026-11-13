import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CEREMONY_CONFIG,
  makeCeremonyService,
  registerCeremony,
  signInCeremony,
} from "./auth-ceremony-helpers.mts";
import {
  accountId,
  base64Url,
  bytes,
  expectAuthError,
  fakeClock,
  queryFirst,
  resetAuthDatabase,
} from "./auth-fixtures.mts";
import {
  buildRegistrationResponse,
  createCredential,
  verificationBody,
} from "./webauthn-ceremony-fixtures.mjs";

beforeEach(resetAuthDatabase);

describe("strict ceremony allowlist and PRF absence", () => {
  it("rejects client owner, account, session, and extension fields before consuming the challenge", async () => {
    const clock = fakeClock();
    const service = makeCeremonyService({ clock, challengeFill: 0x70 });
    const credential = await createCredential({ idFill: 0x80 });
    const options = await service.registrationOptions({
      bindingDigest: bytes(32, 0xc1),
    });
    const response = await buildRegistrationResponse({
      challenge: options.publicKey.challenge,
      rpID: CEREMONY_CONFIG.rpID,
      origin: CEREMONY_CONFIG.origin,
      credential,
    });
    const base = {
      challenge_id: options.challenge_id,
      credential: response,
    };
    for (const extra of [
      { account_handle: base64Url(bytes(32, 0xdd)) },
      { user_id: accountId("attacker01") },
      { owner_id: "dev-attacker" },
      { session: "client-session" },
      { clientExtensionResults: { prf: "canary" } },
    ]) {
      await expectAuthError(
        () =>
          service.verifyRegistration({
            bindingDigest: bytes(32, 0xc1),
            body: { ...base, ...extra },
          }),
        { code: "malformed_request" },
      );
      expect(
        await queryFirst(
          "SELECT consumed_at FROM challenges WHERE id = ?1",
          options.challenge_id,
        ),
      ).toEqual({ consumed_at: null });
      expect(await queryFirst("SELECT COUNT(*) AS count FROM users")).toEqual({
        count: 0,
      });
    }
  });

  it("rejects unknown response keys and noncanonical base64url", async () => {
    const clock = fakeClock();
    const service = makeCeremonyService({ clock, challengeFill: 0x71 });
    const credential = await createCredential({ idFill: 0x81 });
    const options = await service.registrationOptions({
      bindingDigest: bytes(32, 0xc2),
    });
    const response = await buildRegistrationResponse({
      challenge: options.publicKey.challenge,
      rpID: CEREMONY_CONFIG.rpID,
      origin: CEREMONY_CONFIG.origin,
      credential,
    });
    const variants = [
      {
        ...response,
        response: { ...response.response, transports: ["internal"] },
      },
      {
        ...response,
        clientExtensionResults: { prf: {} },
      },
      {
        ...response,
        rawId: `${response.rawId}=`,
      },
      {
        ...response,
        id: `${response.id}=`,
        rawId: `${response.id}=`,
      },
    ];
    for (const variant of variants) {
      await expectAuthError(
        () =>
          service.verifyRegistration({
            bindingDigest: bytes(32, 0xc2),
            body: verificationBody(options.challenge_id, variant),
          }),
        { code: "malformed_request" },
      );
      expect(
        await queryFirst(
          "SELECT consumed_at FROM challenges WHERE id = ?1",
          options.challenge_id,
        ),
      ).toEqual({ consumed_at: null });
    }
    await expectAuthError(
      () =>
        service.verifyRegistration({
          bindingDigest: bytes(32, 0xc2),
          body: {
            challenge_id: `${options.challenge_id}=`,
            credential: response,
          },
        }),
      { code: "malformed_request" },
    );
    await expectAuthError(
      () =>
        service.verifyRegistration({
          bindingDigest: bytes(32, 0xc2),
          body: {
            challenge_id: options.challenge_id,
            credential: {
              ...response,
              response: {
                ...response.response,
                clientDataJSON: `${response.response.clientDataJSON}=`,
              },
            },
          },
        }),
      { code: "malformed_request" },
    );
  });

  it("keeps a positive registration working after rejecting a PRF superset on the same challenge", async () => {
    const clock = fakeClock();
    const service = makeCeremonyService({
      clock,
      account: "positive1",
      handleFill: 0x51,
      challengeFill: 0x72,
      documentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });
    const credential = await createCredential({ idFill: 0x82 });
    const options = await service.registrationOptions({
      bindingDigest: bytes(32, 0xc3),
    });
    const response = await buildRegistrationResponse({
      challenge: options.publicKey.challenge,
      rpID: CEREMONY_CONFIG.rpID,
      origin: CEREMONY_CONFIG.origin,
      credential,
    });
    const canary = "prf-canary-9371b9";
    await expectAuthError(
      () =>
        service.verifyRegistration({
          bindingDigest: bytes(32, 0xc3),
          body: {
            challenge_id: options.challenge_id,
            credential: response,
            clientExtensionResults: {
              prf: { results: { first: canary } },
            },
          },
        }),
      { code: "malformed_request" },
    );
    expect(
      await queryFirst(
        "SELECT consumed_at FROM challenges WHERE id = ?1",
        options.challenge_id,
      ),
    ).toEqual({ consumed_at: null });

    const completed = await service.verifyRegistration({
      bindingDigest: bytes(32, 0xc3),
      body: verificationBody(options.challenge_id, response),
    });
    expect(completed.body.session.account.handle).toBe(
      options.publicKey.user.id,
    );
    expect(JSON.stringify(completed.body)).not.toContain(canary);
    expect(JSON.stringify(completed.handoff)).not.toContain(canary);
  });

  it("projects sign-in options and assertion bodies without extension output", async () => {
    const clock = fakeClock();
    const service = makeCeremonyService({ clock, challengeFill: 0x73 });
    const credential = await createCredential({ idFill: 0x83 });
    const registered = await registerCeremony(service, { credential });
    const begin = await service.signInOptions({
      bindingDigest: bytes(32, 0xc4),
    });
    expect(Object.keys(begin.publicKey).toSorted()).toEqual(
      [
        "challenge",
        "timeout",
        "rpId",
        "allowCredentials",
        "userVerification",
      ].toSorted(),
    );
    expect(begin.publicKey.allowCredentials).toEqual([]);
    expect(begin.publicKey).not.toHaveProperty("extensions");
    expect(begin.publicKey).not.toHaveProperty("hints");
    expect(JSON.stringify(begin)).not.toMatch(
      /prf|credProps|extensions|hints/u,
    );

    const signed = await signInCeremony(service, credential, {
      handle: registered.options.publicKey.user.id,
      bindingDigest: bytes(32, 0xc5),
    });
    expect(signed.response).not.toHaveProperty("clientExtensionResults");
    expect(signed.response.response).not.toHaveProperty(
      "clientExtensionResults",
    );
    expect(JSON.stringify(signed.response)).not.toMatch(/prf|credProps/u);
  });
});

describe("verifier network and logging boundaries", () => {
  it("makes no MDS, CRL, or other HTTP request during registration and assertion verification", async () => {
    const clock = fakeClock();
    const service = makeCeremonyService({ clock, challengeFill: 0x74 });
    const credential = await createCredential({ idFill: 0x84 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("unexpected verifier network request");
    });
    try {
      const registered = await registerCeremony(service, { credential });
      await signInCeremony(service, credential, {
        handle: registered.options.publicKey.user.id,
        bindingDigest: bytes(32, 0xc6),
      });
    } finally {
      fetchSpy.mockRestore();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
