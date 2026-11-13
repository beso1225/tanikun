import { isoCBOR } from "@simplewebauthn/server/helpers";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { handleWebAuthnRequest } from "../http/webauthn.mjs";
import { createAuthRepository } from "../repositories/auth.mjs";
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "../webauthn/verify.mjs";
import {
  CEREMONY_CONFIG,
  activeSessionCount,
  ceremonyDocument,
  credentialRow,
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
  queryAll,
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

it.each([-8, -7])(
  "rejects real Ed25519 assertions with COSE alg %s in sign-in and step-up",
  async (algorithm) => {
    const clock = fakeClock();
    const service = makeCeremonyService({ clock });
    const registered = await registerCeremony(service);
    const session = registered.result.handoff.session;
    const repository = createAuthRepository(env.DB, { now: clock.now });
    const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ]);
    const publicKey = isoCBOR.encode(
      new Map([
        [1, 1],
        [3, algorithm],
        [-1, 6],
        [
          -2,
          new Uint8Array(
            await crypto.subtle.exportKey("raw", keyPair.publicKey),
          ),
        ],
      ]),
    );
    const credential = { credentialId: base64Url(bytes(16, 0xe1)), keyPair };
    await repository.addCredential({
      userId: session.userId,
      sessionDigest: session.digest,
      credential: {
        credentialId: credential.credentialId,
        publicKey,
        counter: 0,
        backupEligible: false,
        backupState: false,
      },
    });
    clock.advance(6 * 60 * 1000);
    const stale = { ...session, recentAuth: false };
    for (const [index, purpose] of ["sign_in", "step_up"].entries()) {
      const binding = bytes(32, 0xe2 + index);
      const begin =
        purpose === "sign_in"
          ? await service.signInOptions({ bindingDigest: binding })
          : await service.stepUpOptions({
              bindingDigest: binding,
              session: stale,
            });
      const assertion = await buildAssertionResponse({
        challenge: begin.publicKey.challenge,
        rpID: CEREMONY_CONFIG.rpID,
        origin: CEREMONY_CONFIG.origin,
        credential,
        userHandle: registered.options.publicKey.user.id,
        counter: 1,
      });
      const verified = await verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: begin.publicKey.challenge,
        expectedOrigin: CEREMONY_CONFIG.origin,
        expectedRPID: CEREMONY_CONFIG.rpID,
        credential: { id: credential.credentialId, publicKey, counter: 0 },
        requireUserVerification: true,
      });
      expect(verified.verified).toBe(true);
      const input = {
        bindingDigest: binding,
        body: verificationBody(begin.challenge_id, assertion),
      };
      await expectAuthError(
        () =>
          purpose === "sign_in"
            ? service.verifySignIn({ ...input, presentedSession: stale })
            : service.verifyStepUp({ ...input, session: stale }),
        { code: "authentication_failed" },
      );
      expect(await credentialRow(credential.credentialId)).toMatchObject({
        counter: 0,
      });
      expect(await activeSessionCount(session.userId)).toBe(1);
      expect(
        await queryFirst(
          "SELECT recent_auth_at, revoked_at FROM sessions WHERE digest = ?1",
          session.digest,
        ),
      ).toEqual({ recent_auth_at: session.createdAt, revoked_at: null });
      expect(
        await queryFirst(
          "SELECT consumed_at FROM challenges WHERE id = ?1",
          begin.challenge_id,
        ),
      ).toEqual({ consumed_at: clock.current() });
    }
  },
);

it.each(["register", "add_credential"])(
  "rejects an OKP key mislabeled ES256 before %s persistence",
  async (purpose) => {
    const clock = fakeClock();
    const service = makeCeremonyService({ clock });
    const registered =
      purpose === "add_credential" ? await registerCeremony(service) : null;
    const session = registered?.result.handoff.session;
    const binding = bytes(32, 0xe4);
    const begin =
      purpose === "register"
        ? await service.registrationOptions({ bindingDigest: binding })
        : await service.addCredentialOptions({
            bindingDigest: binding,
            session,
          });
    const credential = await createCredential({ idFill: 0xe5 });
    credential.keyPair = await crypto.subtle.generateKey(
      { name: "Ed25519" },
      true,
      ["sign", "verify"],
    );
    const response = await buildRegistrationResponse({
      challenge: begin.publicKey.challenge,
      rpID: CEREMONY_CONFIG.rpID,
      origin: CEREMONY_CONFIG.origin,
      credential,
      algorithm: -7,
    });
    const verified = await verifyRegistrationResponse({
      response,
      expectedChallenge: begin.publicKey.challenge,
      expectedOrigin: CEREMONY_CONFIG.origin,
      expectedRPID: CEREMONY_CONFIG.rpID,
      requireUserPresence: true,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-7],
    });
    expect(verified.verified).toBe(true);
    const path = purpose === "register" ? "register" : "credentials";
    const result = await handleWebAuthnRequest(
      new Request(`${CEREMONY_CONFIG.origin}/api/v1/auth/${path}/verify`, {
        method: "POST",
        headers: {
          Origin: CEREMONY_CONFIG.origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(verificationBody(begin.challenge_id, response)),
      }),
      {
        ...env,
        AUTH_MODE: "session",
        APP_ENV: "test",
        DEV_AUTH: undefined,
        DEV_AUTH_IDENTITIES: undefined,
        AUTH_ORIGIN: CEREMONY_CONFIG.origin,
        RP_ID: CEREMONY_CONFIG.rpID,
        AUTH_RATE_LIMIT_KEY: base64Url(bytes(32, 0xe6)),
      },
      { bindingDigest: binding, session, csrfVerified: true },
      { now: clock.now },
    );
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toEqual({
      error: { code: "authentication_failed" },
    });
    expect(result.handoff).toBeNull();
    const expectedCount = registered ? 1 : 0;
    for (const table of ["users", "credentials", "documents", "sessions"]) {
      expect(
        await queryFirst(`SELECT COUNT(*) AS count FROM ${table}`),
      ).toEqual({ count: expectedCount });
    }
    expect(
      await queryFirst(
        "SELECT consumed_at FROM challenges WHERE id = ?1",
        begin.challenge_id,
      ),
    ).toEqual({ consumed_at: clock.current() });
    expect(
      await queryAll("SELECT recent_auth_at, revoked_at FROM sessions"),
    ).toEqual(
      session ? [{ recent_auth_at: session.createdAt, revoked_at: null }] : [],
    );
    expect(await queryAll("SELECT counter FROM credentials")).toEqual(
      registered ? [{ counter: 0 }] : [],
    );
  },
);

async function serviceWithCredential({ backupEligible, backupState, counter }) {
  const clock = fakeClock();
  const service = makeCeremonyService({
    clock,
    challengeFill: 0x20,
    documentId: ceremonyDocument(40),
  });
  const credential = await createCredential({ idFill: 0x60 });
  const registered = await registerCeremony(service, {
    credential,
    counter,
    backupEligible,
    backupState,
  });
  return { clock, service, credential, registered };
}

describe("backup eligibility and counter policy", () => {
  it("keeps backup eligibility immutable and accepts max updates for an eligible credential", async () => {
    const { clock, service, credential, registered } =
      await serviceWithCredential({
        backupEligible: true,
        backupState: true,
        counter: 5,
      });
    const handle = registered.options.publicKey.user.id;
    for (const [index, counter] of [3, 7, 2].entries()) {
      await signInCeremony(service, credential, {
        handle,
        bindingDigest: bytes(32, 0xa0 + index),
        counter,
        backupEligible: true,
        backupState: true,
      });
    }
    expect(await credentialRow(credential.credentialId)).toMatchObject({
      counter: 7,
      backup_eligible: 1,
      backup_state: 1,
    });
    expect(await activeSessionCount(accountId("alice0001"))).toBe(4);
    expect(
      await queryFirst(
        "SELECT last_used_at FROM credentials WHERE credential_id = ?1",
        credential.credentialId,
      ),
    ).toEqual({ last_used_at: clock.current() });
  });

  it("stores backup state changes without revoking sessions", async () => {
    const { service, credential, registered } = await serviceWithCredential({
      backupEligible: true,
      backupState: false,
      counter: 0,
    });
    const handle = registered.options.publicKey.user.id;
    await signInCeremony(service, credential, {
      handle,
      bindingDigest: bytes(32, 0xa4),
      backupEligible: true,
      backupState: true,
    });
    expect(await credentialRow(credential.credentialId)).toMatchObject({
      backup_eligible: 1,
      backup_state: 1,
    });
    await signInCeremony(service, credential, {
      handle,
      bindingDigest: bytes(32, 0xa5),
      backupEligible: true,
      backupState: false,
    });
    expect(await credentialRow(credential.credentialId)).toMatchObject({
      backup_eligible: 1,
      backup_state: 0,
    });
    expect(await activeSessionCount(accountId("alice0001"))).toBe(3);
  });

  it("keeps the strict library counter check for a non-backup credential", async () => {
    const { service, credential, registered } = await serviceWithCredential({
      backupEligible: false,
      backupState: false,
      counter: 5,
    });
    const handle = registered.options.publicKey.user.id;

    await expectAuthError(
      () =>
        signInCeremony(service, credential, {
          handle,
          bindingDigest: bytes(32, 0xa6),
          counter: 0,
        }),
      { code: "authentication_failed" },
    );
    expect(await credentialRow(credential.credentialId)).toMatchObject({
      counter: 5,
    });

    await expectAuthError(
      () =>
        signInCeremony(service, credential, {
          handle,
          bindingDigest: bytes(32, 0xa7),
          counter: 5,
        }),
      { code: "authentication_failed" },
    );
    expect(await credentialRow(credential.credentialId)).toMatchObject({
      counter: 5,
    });

    await signInCeremony(service, credential, {
      handle,
      bindingDigest: bytes(32, 0xa8),
      counter: 6,
    });
    expect(await credentialRow(credential.credentialId)).toMatchObject({
      counter: 6,
    });
  });

  it("accepts zero counters when the stored non-backup counter is zero", async () => {
    const { service, credential, registered } = await serviceWithCredential({
      backupEligible: false,
      backupState: false,
      counter: 0,
    });
    const handle = registered.options.publicKey.user.id;
    await signInCeremony(service, credential, {
      handle,
      bindingDigest: bytes(32, 0xa9),
      counter: 0,
    });
    expect(await credentialRow(credential.credentialId)).toMatchObject({
      counter: 0,
    });
  });

  it("rejects a changed backup-device type", async () => {
    const { service, credential, registered } = await serviceWithCredential({
      backupEligible: true,
      backupState: false,
      counter: 0,
    });
    const handle = registered.options.publicKey.user.id;
    await expectAuthError(
      () =>
        signInCeremony(service, credential, {
          handle,
          bindingDigest: bytes(32, 0xaa),
          backupEligible: false,
          backupState: false,
        }),
      { code: "authentication_failed" },
    );
    expect(await credentialRow(credential.credentialId)).toMatchObject({
      backup_eligible: 1,
    });
    expect(await activeSessionCount(accountId("alice0001"))).toBe(1);
  });

  it("rejects a single-device credential that claims backup", async () => {
    const clock = fakeClock();
    const service = makeCeremonyService({
      clock,
      challengeFill: 0x30,
      documentId: ceremonyDocument(41),
    });
    const credential = await createCredential({ idFill: 0x61 });
    await expectAuthError(
      () =>
        registerCeremony(service, {
          credential,
          backupEligible: false,
          backupState: true,
        }),
      { code: "authentication_failed" },
    );
    expect(await queryFirst("SELECT COUNT(*) AS count FROM users")).toEqual({
      count: 0,
    });

    const secondService = makeCeremonyService({
      clock,
      handleFill: 0x12,
      challengeFill: 0x31,
      documentId: ceremonyDocument(42),
    });
    const registered = await registerCeremony(secondService, {
      credential,
      bindingDigest: bytes(32, 0xab),
    });
    const handle = registered.options.publicKey.user.id;
    await expectAuthError(
      () =>
        signInCeremony(secondService, credential, {
          handle,
          bindingDigest: bytes(32, 0xac),
          backupEligible: false,
          backupState: true,
        }),
      { code: "authentication_failed" },
    );
    expect(await credentialRow(credential.credentialId)).toMatchObject({
      backup_eligible: 0,
      backup_state: 0,
    });
  });

  it("keeps a monotonic maximum when backup-eligible assertions race", async () => {
    const { service, credential, registered } = await serviceWithCredential({
      backupEligible: true,
      backupState: true,
      counter: 0,
    });
    const handle = registered.options.publicKey.user.id;
    const firstBinding = bytes(32, 0xad);
    const secondBinding = bytes(32, 0xae);
    const [firstOptions, secondOptions] = await Promise.all([
      service.signInOptions({ bindingDigest: firstBinding }),
      service.signInOptions({ bindingDigest: secondBinding }),
    ]);
    const [firstAssertion, secondAssertion] = await Promise.all([
      buildAssertionResponse({
        challenge: firstOptions.publicKey.challenge,
        rpID: CEREMONY_CONFIG.rpID,
        origin: CEREMONY_CONFIG.origin,
        credential,
        userHandle: handle,
        counter: 1,
        backupEligible: true,
        backupState: true,
      }),
      buildAssertionResponse({
        challenge: secondOptions.publicKey.challenge,
        rpID: CEREMONY_CONFIG.rpID,
        origin: CEREMONY_CONFIG.origin,
        credential,
        userHandle: handle,
        counter: 2,
        backupEligible: true,
        backupState: true,
      }),
    ]);
    const results = await Promise.allSettled([
      service.verifySignIn({
        bindingDigest: firstBinding,
        body: verificationBody(firstOptions.challenge_id, firstAssertion),
      }),
      service.verifySignIn({
        bindingDigest: secondBinding,
        body: verificationBody(secondOptions.challenge_id, secondAssertion),
      }),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(await credentialRow(credential.credentialId)).toMatchObject({
      counter: 2,
      backup_eligible: 1,
    });
  });

  it("allows only one strict non-backup counter update when assertions race", async () => {
    const { service, credential, registered } = await serviceWithCredential({
      backupEligible: false,
      backupState: false,
      counter: 0,
    });
    const handle = registered.options.publicKey.user.id;
    const firstBinding = bytes(32, 0xaf);
    const secondBinding = bytes(32, 0xb8);
    const [firstOptions, secondOptions] = await Promise.all([
      service.signInOptions({ bindingDigest: firstBinding }),
      service.signInOptions({ bindingDigest: secondBinding }),
    ]);
    const [firstAssertion, secondAssertion] = await Promise.all([
      buildAssertionResponse({
        challenge: firstOptions.publicKey.challenge,
        rpID: CEREMONY_CONFIG.rpID,
        origin: CEREMONY_CONFIG.origin,
        credential,
        userHandle: handle,
        counter: 1,
      }),
      buildAssertionResponse({
        challenge: secondOptions.publicKey.challenge,
        rpID: CEREMONY_CONFIG.rpID,
        origin: CEREMONY_CONFIG.origin,
        credential,
        userHandle: handle,
        counter: 1,
      }),
    ]);
    const results = await Promise.allSettled([
      service.verifySignIn({
        bindingDigest: firstBinding,
        body: verificationBody(firstOptions.challenge_id, firstAssertion),
      }),
      service.verifySignIn({
        bindingDigest: secondBinding,
        body: verificationBody(secondOptions.challenge_id, secondAssertion),
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected").reason,
    ).toMatchObject({ code: "authentication_failed" });
    expect(await credentialRow(credential.credentialId)).toMatchObject({
      counter: 1,
    });
    expect(await activeSessionCount(accountId("alice0001"))).toBe(2);
  });
});
