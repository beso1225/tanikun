import { beforeEach, describe, expect, it } from "vitest";

import { verifyRegistrationResponse } from "../webauthn/verify.mjs";
import {
  CEREMONY_CONFIG,
  activeSessionCount,
  ceremonyDocument,
  credentialRow,
  makeCeremonyService,
  registerCeremony,
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
  buildAssertionResponse,
  buildRegistrationResponse,
  createCredential,
  verificationBody,
} from "./webauthn-ceremony-fixtures.mjs";

beforeEach(resetAuthDatabase);

function registrationInput(service, bindingDigest, credential, overrides = {}) {
  return service
    .registrationOptions({ bindingDigest })
    .then(async (options) => {
      const response = await buildRegistrationResponse({
        challenge: options.publicKey.challenge,
        rpID: CEREMONY_CONFIG.rpID,
        origin: CEREMONY_CONFIG.origin,
        credential,
        ...overrides,
      });
      return { options, response };
    });
}

describe("registration rejection", () => {
  it("rejects wrong origin, RP ID, type, crossOrigin, topOrigin, UP, and UV after consuming the challenge", async () => {
    const cases = [
      { origin: "https://evil.example" },
      { corruptRpId: true },
      { type: "webauthn.get" },
      { crossOrigin: true },
      { topOrigin: "https://evil.example" },
      { userPresent: false },
      { userVerified: false },
      { malformedClientData: true },
      { challenge: "not-base64url" },
    ];
    for (let index = 0; index < cases.length; index += 1) {
      const clock = fakeClock();
      const service = makeCeremonyService({
        clock,
        account: `bad0000${index}`,
        handleFill: 0x40 + index,
        documentId: ceremonyDocument(20 + index),
        challengeFill: 0x20 + index * 4,
      });
      const binding = bytes(32, 0x60 + index);
      const credential = await createCredential({ idFill: 0x40 + index });
      const { options, response } = await registrationInput(
        service,
        binding,
        credential,
        cases[index],
      );
      await expectAuthError(
        () =>
          service.verifyRegistration({
            bindingDigest: binding,
            body: verificationBody(options.challenge_id, response),
          }),
        { code: "authentication_failed" },
      );
      expect(await queryFirst("SELECT COUNT(*) AS count FROM users")).toEqual({
        count: 0,
      });
      expect(
        await queryFirst(
          "SELECT consumed_at FROM challenges WHERE id = ?1",
          options.challenge_id,
        ),
      ).toEqual({ consumed_at: clock.current() });
    }
  });

  it("rejects non-none, nonempty, and unparseable attestations before the verifier", async () => {
    for (const [index, responseOverrides] of [
      { fmt: "packed", attStmt: new Map([["alg", -7]]) },
      { fmt: "none", attStmt: new Map([["unexpected", 1]]) },
    ].entries()) {
      const clock = fakeClock();
      let calls = 0;
      const service = makeCeremonyService({
        clock,
        account: `attest00${index}`,
        handleFill: 0x50 + index,
        documentId: ceremonyDocument(30 + index),
        challengeFill: 0x60 + index * 4,
        verifyRegistration: (...args) => {
          calls += 1;
          return verifyRegistrationResponse(...args);
        },
      });
      const binding = bytes(32, 0x70 + index);
      const credential = await createCredential({ idFill: 0x50 + index });
      const { options, response } = await registrationInput(
        service,
        binding,
        credential,
        responseOverrides,
      );
      await expectAuthError(
        () =>
          service.verifyRegistration({
            bindingDigest: binding,
            body: verificationBody(options.challenge_id, response),
          }),
        { code: "authentication_failed" },
      );
      expect(calls).toBe(0);
      expect(await queryFirst("SELECT COUNT(*) AS count FROM users")).toEqual({
        count: 0,
      });
    }

    const clock = fakeClock();
    let calls = 0;
    const service = makeCeremonyService({
      clock,
      account: "attest003",
      handleFill: 0x52,
      documentId: ceremonyDocument(33),
      challengeFill: 0x68,
      verifyRegistration: (...args) => {
        calls += 1;
        return verifyRegistrationResponse(...args);
      },
    });
    const binding = bytes(32, 0x72);
    const credential = await createCredential({ idFill: 0x52 });
    const { options, response } = await registrationInput(
      service,
      binding,
      credential,
    );
    response.response.attestationObject = base64Url(Uint8Array.of(0xff, 0x00));
    await expectAuthError(
      () =>
        service.verifyRegistration({
          bindingDigest: binding,
          body: verificationBody(options.challenge_id, response),
        }),
      { code: "authentication_failed" },
    );
    expect(calls).toBe(0);
  });

  it("accepts a valid none attestation with one real verifier call", async () => {
    const clock = fakeClock();
    let calls = 0;
    const service = makeCeremonyService({
      clock,
      account: "attest004",
      handleFill: 0x53,
      documentId: ceremonyDocument(34),
      challengeFill: 0x6c,
      verifyRegistration: (...args) => {
        calls += 1;
        return verifyRegistrationResponse(...args);
      },
    });
    await registerCeremony(service, {
      credential: await createCredential({ idFill: 0x53 }),
      bindingDigest: bytes(32, 0x73),
    });
    expect(calls).toBe(1);
  });

  it("rejects a non-ES256 credential algorithm", async () => {
    const clock = fakeClock();
    const service = makeCeremonyService({
      clock,
      account: "alg00001",
      handleFill: 0x54,
      documentId: ceremonyDocument(35),
    });
    const binding = bytes(32, 0x74);
    const credential = await createCredential({ idFill: 0x54 });
    const { options, response } = await registrationInput(
      service,
      binding,
      credential,
      { algorithm: -8 },
    );
    await expectAuthError(
      () =>
        service.verifyRegistration({
          bindingDigest: binding,
          body: verificationBody(options.challenge_id, response),
        }),
      { code: "authentication_failed" },
    );
    expect(await queryFirst("SELECT COUNT(*) AS count FROM users")).toEqual({
      count: 0,
    });
  });
});

describe("assertion rejection and replay", () => {
  it("rejects signature, origin, RP ID, type, crossOrigin, topOrigin, UP, and UV failures", async () => {
    const clock = fakeClock();
    const service = makeCeremonyService({ clock });
    const credential = await createCredential();
    const registered = await registerCeremony(service, { credential });
    const handle = registered.options.publicKey.user.id;
    const cases = [
      { corruptSignature: true },
      { corruptRpId: true },
      { origin: "https://evil.example" },
      { type: "webauthn.create" },
      { crossOrigin: true },
      { topOrigin: "https://evil.example" },
      { userPresent: false },
      { userVerified: false },
      { malformedClientData: true },
      { challenge: "not-base64url" },
    ];
    for (let index = 0; index < cases.length; index += 1) {
      const binding = bytes(32, 0x80 + index);
      const begin = await service.signInOptions({ bindingDigest: binding });
      const response = await buildAssertionResponse({
        challenge: begin.publicKey.challenge,
        rpID: CEREMONY_CONFIG.rpID,
        origin: CEREMONY_CONFIG.origin,
        credential,
        userHandle: handle,
        ...cases[index],
      });
      await expectAuthError(
        () =>
          service.verifySignIn({
            bindingDigest: binding,
            body: verificationBody(begin.challenge_id, response),
          }),
        { code: "authentication_failed" },
      );
      expect(await credentialRow(credential.credentialId)).toMatchObject({
        counter: 0,
      });
      expect(await activeSessionCount(accountId("alice0001"))).toBe(1);
      expect(
        await queryFirst(
          "SELECT consumed_at FROM challenges WHERE id = ?1",
          begin.challenge_id,
        ),
      ).toEqual({ consumed_at: clock.current() });
    }
  });

  it("rejects a wrong challenge after consuming the valid challenge row", async () => {
    const clock = fakeClock();
    const service = makeCeremonyService({ clock });
    const credential = await createCredential();
    const registered = await registerCeremony(service, { credential });
    const binding = bytes(32, 0x90);
    const begin = await service.signInOptions({ bindingDigest: binding });
    const response = await buildAssertionResponse({
      challenge: base64Url(bytes(32, 0x99)),
      rpID: CEREMONY_CONFIG.rpID,
      origin: CEREMONY_CONFIG.origin,
      credential,
      userHandle: registered.options.publicKey.user.id,
    });
    await expectAuthError(
      () =>
        service.verifySignIn({
          bindingDigest: binding,
          body: verificationBody(begin.challenge_id, response),
        }),
      { code: "authentication_failed" },
    );
    expect(
      await queryFirst(
        "SELECT consumed_at FROM challenges WHERE id = ?1",
        begin.challenge_id,
      ),
    ).toEqual({ consumed_at: clock.current() });
  });

  it("requires and binds the discoverable user handle", async () => {
    const clock = fakeClock();
    const service = makeCeremonyService({ clock });
    const credential = await createCredential();
    const registered = await registerCeremony(service, { credential });
    const handle = registered.options.publicKey.user.id;

    const missingBinding = bytes(32, 0x91);
    const missing = await service.signInOptions({
      bindingDigest: missingBinding,
    });
    const missingResponse = await buildAssertionResponse({
      challenge: missing.publicKey.challenge,
      rpID: CEREMONY_CONFIG.rpID,
      origin: CEREMONY_CONFIG.origin,
      credential,
      includeUserHandle: false,
    });
    await expectAuthError(
      () =>
        service.verifySignIn({
          bindingDigest: missingBinding,
          body: verificationBody(missing.challenge_id, missingResponse),
        }),
      { code: "malformed_request" },
    );

    const wrongBinding = bytes(32, 0x92);
    const wrong = await service.signInOptions({ bindingDigest: wrongBinding });
    const wrongResponse = await buildAssertionResponse({
      challenge: wrong.publicKey.challenge,
      rpID: CEREMONY_CONFIG.rpID,
      origin: CEREMONY_CONFIG.origin,
      credential,
      userHandle: base64Url(bytes(32, 0xee)),
    });
    await expectAuthError(
      () =>
        service.verifySignIn({
          bindingDigest: wrongBinding,
          body: verificationBody(wrong.challenge_id, wrongResponse),
        }),
      { code: "authentication_failed" },
    );
    expect(handle).toHaveLength(43);
    expect(await activeSessionCount(accountId("alice0001"))).toBe(1);
  });

  it("burns the challenge on a failed signature and never accepts a replay", async () => {
    const clock = fakeClock();
    const service = makeCeremonyService({ clock });
    const credential = await createCredential();
    const registered = await registerCeremony(service, { credential });
    const handle = registered.options.publicKey.user.id;
    const binding = bytes(32, 0x93);
    const begin = await service.signInOptions({ bindingDigest: binding });
    const bad = await buildAssertionResponse({
      challenge: begin.publicKey.challenge,
      rpID: CEREMONY_CONFIG.rpID,
      origin: CEREMONY_CONFIG.origin,
      credential,
      userHandle: handle,
      corruptSignature: true,
    });
    const body = verificationBody(begin.challenge_id, bad);
    await expectAuthError(
      () => service.verifySignIn({ bindingDigest: binding, body }),
      { code: "authentication_failed" },
    );
    expect(
      await queryFirst(
        "SELECT consumed_at FROM challenges WHERE id = ?1",
        begin.challenge_id,
      ),
    ).toEqual({ consumed_at: clock.current() });
    await expectAuthError(
      () => service.verifySignIn({ bindingDigest: binding, body }),
      { code: "authentication_failed" },
    );
    expect(await activeSessionCount(accountId("alice0001"))).toBe(1);
  });

  it("allows exactly one concurrent consumer of a sign-in challenge", async () => {
    const clock = fakeClock();
    const service = makeCeremonyService({ clock });
    const credential = await createCredential();
    const registered = await registerCeremony(service, { credential });
    const handle = registered.options.publicKey.user.id;
    const binding = bytes(32, 0x94);
    const begin = await service.signInOptions({ bindingDigest: binding });
    const assertion = await buildAssertionResponse({
      challenge: begin.publicKey.challenge,
      rpID: CEREMONY_CONFIG.rpID,
      origin: CEREMONY_CONFIG.origin,
      credential,
      userHandle: handle,
    });
    const body = verificationBody(begin.challenge_id, assertion);
    const results = await Promise.allSettled([
      service.verifySignIn({
        bindingDigest: binding,
        body,
        presentedSession: { digest: registered.result.handoff.session.digest },
      }),
      service.verifySignIn({
        bindingDigest: binding,
        body,
        presentedSession: { digest: registered.result.handoff.session.digest },
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected.reason).toMatchObject({ code: "authentication_failed" });
    expect(await activeSessionCount(accountId("alice0001"))).toBe(1);
    expect(
      await queryFirst(
        "SELECT revoked_at FROM sessions WHERE digest = ?1",
        registered.result.handoff.session.digest,
      ),
    ).toEqual({ revoked_at: clock.current() });
  });

  it("does not create a session for an expired challenge", async () => {
    const clock = fakeClock();
    const service = makeCeremonyService({ clock });
    const credential = await createCredential();
    const registered = await registerCeremony(service, { credential });
    const handle = registered.options.publicKey.user.id;
    const binding = bytes(32, 0x95);
    const begin = await service.signInOptions({ bindingDigest: binding });
    const assertion = await buildAssertionResponse({
      challenge: begin.publicKey.challenge,
      rpID: CEREMONY_CONFIG.rpID,
      origin: CEREMONY_CONFIG.origin,
      credential,
      userHandle: handle,
    });
    clock.advance(300_001);
    await expectAuthError(
      () =>
        service.verifySignIn({
          bindingDigest: binding,
          body: verificationBody(begin.challenge_id, assertion),
        }),
      { code: "authentication_failed" },
    );
    expect(await activeSessionCount(accountId("alice0001"))).toBe(1);
    expect(
      await queryFirst(
        "SELECT consumed_at FROM challenges WHERE id = ?1",
        begin.challenge_id,
      ),
    ).toEqual({ consumed_at: null });
  });

  it("does not consume a challenge through the wrong binding or purpose", async () => {
    const clock = fakeClock();
    const service = makeCeremonyService({ clock });
    const credential = await createCredential();
    const registered = await registerCeremony(service, { credential });
    const binding = bytes(32, 0x96);
    const begin = await service.signInOptions({ bindingDigest: binding });
    const assertion = await buildAssertionResponse({
      challenge: begin.publicKey.challenge,
      rpID: CEREMONY_CONFIG.rpID,
      origin: CEREMONY_CONFIG.origin,
      credential,
      userHandle: registered.options.publicKey.user.id,
    });
    await expectAuthError(
      () =>
        service.verifySignIn({
          bindingDigest: bytes(32, 0x97),
          body: verificationBody(begin.challenge_id, assertion),
        }),
      { code: "authentication_failed" },
    );
    expect(
      await queryFirst(
        "SELECT consumed_at FROM challenges WHERE id = ?1",
        begin.challenge_id,
      ),
    ).toEqual({ consumed_at: null });
    expect(
      await service.verifySignIn({
        bindingDigest: binding,
        body: verificationBody(begin.challenge_id, assertion),
      }),
    ).toBeDefined();

    const registrationBinding = bytes(32, 0x98);
    const registrationService = makeCeremonyService({
      clock,
      account: "wrong001",
      handleFill: 0x99,
      documentId: ceremonyDocument(99),
      challengeFill: 0x98,
    });
    const registration = await registrationService.registrationOptions({
      bindingDigest: registrationBinding,
    });
    const wrongPurpose = await buildAssertionResponse({
      challenge: registration.publicKey.challenge,
      rpID: CEREMONY_CONFIG.rpID,
      origin: CEREMONY_CONFIG.origin,
      credential,
      userHandle: registered.options.publicKey.user.id,
    });
    await expectAuthError(
      () =>
        service.verifySignIn({
          bindingDigest: registrationBinding,
          body: verificationBody(registration.challenge_id, wrongPurpose),
        }),
      { code: "authentication_failed" },
    );
    expect(
      await queryFirst(
        "SELECT consumed_at FROM challenges WHERE id = ?1",
        registration.challenge_id,
      ),
    ).toEqual({ consumed_at: null });
  });
});
