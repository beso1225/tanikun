import { beforeEach, describe, expect, it } from "vitest";

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
  bytes,
  expectAuthError,
  fakeClock,
  queryFirst,
  resetAuthDatabase,
} from "./auth-fixtures.mts";
import {
  buildAssertionResponse,
  createCredential,
  verificationBody,
} from "./webauthn-ceremony-fixtures.mjs";

beforeEach(resetAuthDatabase);

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
