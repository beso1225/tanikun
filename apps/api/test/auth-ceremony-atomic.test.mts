import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { createAuthRepository } from "../repositories/auth.mjs";
import { createAuthCeremonyService } from "../webauthn/service.mjs";
import { createSessionMaterial } from "../webauthn/session-material.mjs";
import { verifyAuthenticationResponse } from "../webauthn/verify.mjs";
import {
  CEREMONY_CONFIG,
  ceremonyDocument,
  credentialRow,
  makeCeremonyService,
  registerCeremony,
} from "./auth-ceremony-helpers.mts";
import {
  accountHandle,
  accountId,
  base64Url,
  bytes,
  challengeId,
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

const deterministicSession = async () => ({
  token: base64Url(bytes(32, 0xaa)),
  digest: bytes(32, 0xaa),
  csrfToken: base64Url(bytes(32, 0xab)),
  csrfDigest: bytes(32, 0xab),
});

describe("atomic sign-in and step-up finalization", () => {
  it("rolls back the counter update and old-session revocation when the session insert fails", async () => {
    const clock = fakeClock();
    const registered = await registerCeremony(makeCeremonyService({ clock }));
    const credential = registered.credential;
    const oldSession = registered.result.handoff.session;
    const binding = bytes(32, 0xb0);
    const service = makeCeremonyService({
      clock,
      challengeFill: 0x40,
      sessionMaterial: deterministicSession,
    });
    const begin = await service.signInOptions({ bindingDigest: binding });
    const assertion = await buildAssertionResponse({
      challenge: begin.publicKey.challenge,
      rpID: CEREMONY_CONFIG.rpID,
      origin: CEREMONY_CONFIG.origin,
      credential,
      userHandle: registered.options.publicKey.user.id,
      counter: 3,
    });
    await env.DB.exec(
      `CREATE TRIGGER reject_sign_in_session BEFORE INSERT ON sessions WHEN hex(NEW.digest) = '${"AA".repeat(32)}' BEGIN SELECT RAISE(ABORT, 'synthetic_session_failure'); END`,
    );
    await expectAuthError(
      () =>
        service.verifySignIn({
          bindingDigest: binding,
          body: verificationBody(begin.challenge_id, assertion),
          presentedSession: { digest: oldSession.digest },
        }),
      { code: "temporarily_unavailable" },
    );
    await env.DB.exec("DROP TRIGGER reject_sign_in_session");

    expect(await credentialRow(credential.credentialId)).toMatchObject({
      counter: 0,
    });
    expect(
      await queryFirst(
        "SELECT revoked_at FROM sessions WHERE digest = ?1",
        oldSession.digest,
      ),
    ).toEqual({ revoked_at: null });
    expect(
      await queryFirst(
        "SELECT COUNT(*) AS count FROM sessions WHERE digest = ?1",
        bytes(32, 0xaa),
      ),
    ).toEqual({ count: 0 });
    expect(
      await queryFirst(
        "SELECT consumed_at FROM challenges WHERE id = ?1",
        begin.challenge_id,
      ),
    ).toEqual({ consumed_at: clock.current() });
  });

  it("rolls back the counter update when the recent-auth session update fails", async () => {
    const clock = fakeClock();
    const service = makeCeremonyService({ clock });
    const registered = await registerCeremony(service);
    const credential = registered.credential;
    const session = registered.result.handoff.session;
    const before = await queryFirst(
      "SELECT recent_auth_at FROM sessions WHERE digest = ?1",
      session.digest,
    );
    clock.advance(6 * 60 * 1000);
    const binding = bytes(32, 0xb1);
    const begin = await service.stepUpOptions({
      bindingDigest: binding,
      session: { ...session, recentAuth: false },
    });
    const assertion = await buildAssertionResponse({
      challenge: begin.publicKey.challenge,
      rpID: CEREMONY_CONFIG.rpID,
      origin: CEREMONY_CONFIG.origin,
      credential,
      userHandle: registered.options.publicKey.user.id,
      counter: 4,
    });
    await env.DB.exec(
      `CREATE TRIGGER reject_step_up_session BEFORE UPDATE ON sessions WHEN hex(OLD.digest) = '${Array.from(
        session.digest,
        (byte) => byte.toString(16).padStart(2, "0"),
      )
        .join("")
        .toUpperCase()}' BEGIN SELECT RAISE(ABORT, 'synthetic_step_up_failure'); END`,
    );
    await expectAuthError(
      () =>
        service.verifyStepUp({
          bindingDigest: binding,
          body: verificationBody(begin.challenge_id, assertion),
          session: { ...session, recentAuth: false },
        }),
      { code: "temporarily_unavailable" },
    );
    await env.DB.exec("DROP TRIGGER reject_step_up_session");

    expect(await credentialRow(credential.credentialId)).toMatchObject({
      counter: 0,
    });
    expect(
      await queryFirst(
        "SELECT recent_auth_at FROM sessions WHERE digest = ?1",
        session.digest,
      ),
    ).toEqual(before);
  });

  it("rechecks a removed credential after a successful real assertion verification", async () => {
    const clock = fakeClock();
    let nextChallenge = 0;
    const repository = createAuthRepository(env.DB, {
      now: clock.now,
      newChallengeId: () => challengeId(0x50 + nextChallenge++),
      newAccountId: () => accountId("removed01"),
      newAccountHandle: () => accountHandle(0x31),
      newDocumentId: () => ceremonyDocument(60),
    });
    const service = createAuthCeremonyService({
      db: env.DB,
      config: CEREMONY_CONFIG,
      repository,
    });
    const credential = await createCredential({ idFill: 0x70 });
    const registered = await registerCeremony(service, { credential });
    const binding = bytes(32, 0xb2);
    const begin = await service.signInOptions({ bindingDigest: binding });
    await repository.consumeCeremonyChallenge({
      challengeId: begin.challenge_id,
      bindingDigest: binding,
      purpose: "sign_in",
    });
    const assertion = await buildAssertionResponse({
      challenge: begin.publicKey.challenge,
      rpID: CEREMONY_CONFIG.rpID,
      origin: CEREMONY_CONFIG.origin,
      credential,
      userHandle: registered.options.publicKey.user.id,
      counter: 1,
    });
    const stored = await repository.findCredential(credential.credentialId);
    const verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: begin.publicKey.challenge,
      expectedOrigin: CEREMONY_CONFIG.origin,
      expectedRPID: CEREMONY_CONFIG.rpID,
      credential: {
        id: stored.credentialId,
        publicKey: stored.publicKey,
        counter: stored.counter,
      },
      requireUserVerification: true,
    });
    expect(verification.verified).toBe(true);
    expect(verification.authenticationInfo.newCounter).toBe(1);

    await env.DB.prepare("DELETE FROM credentials WHERE credential_id = ?1")
      .bind(credential.credentialId)
      .run();
    const material = await createSessionMaterial();
    await expectAuthError(
      () =>
        repository.completeSignIn({
          challengeId: begin.challenge_id,
          bindingDigest: binding,
          credentialId: credential.credentialId,
          userId: accountId("removed01"),
          newCounter: 1,
          backupEligible: false,
          backupState: false,
          session: {
            digest: material.digest,
            csrfDigest: material.csrfDigest,
          },
          presentedSessionDigest: registered.result.handoff.session.digest,
        }),
      { code: "authentication_failed" },
    );
    expect(
      await queryFirst(
        "SELECT COUNT(*) AS count FROM sessions WHERE digest = ?1",
        material.digest,
      ),
    ).toEqual({ count: 0 });
    expect(
      await queryFirst(
        "SELECT revoked_at FROM sessions WHERE digest = ?1",
        registered.result.handoff.session.digest,
      ),
    ).toEqual({ revoked_at: null });
  });
});

describe("credential uniqueness and enrollment atomicity", () => {
  it("rolls back a second account when its credential ID already exists", async () => {
    const clock = fakeClock();
    const credential = await createCredential({ idFill: 0x71 });
    const alice = makeCeremonyService({
      clock,
      challengeFill: 0x60,
      documentId: ceremonyDocument(61),
    });
    await registerCeremony(alice, { credential });
    const bob = makeCeremonyService({
      clock,
      account: "bob00001",
      handleFill: 0x41,
      challengeFill: 0x61,
      documentId: ceremonyDocument(62),
    });
    const begin = await bob.registrationOptions({
      bindingDigest: bytes(32, 0xb3),
      displayName: "Bob Example",
    });
    const response = await buildRegistrationResponse({
      challenge: begin.publicKey.challenge,
      rpID: CEREMONY_CONFIG.rpID,
      origin: CEREMONY_CONFIG.origin,
      credential,
    });
    await expectAuthError(
      () =>
        bob.verifyRegistration({
          bindingDigest: bytes(32, 0xb3),
          body: verificationBody(begin.challenge_id, response),
        }),
      { code: "credential_conflict" },
    );
    expect(await queryFirst("SELECT COUNT(*) AS count FROM users")).toEqual({
      count: 1,
    });
    expect(
      await queryFirst("SELECT COUNT(*) AS count FROM credentials"),
    ).toEqual({ count: 1 });
    expect(await queryFirst("SELECT COUNT(*) AS count FROM documents")).toEqual(
      { count: 1 },
    );
    expect(await queryFirst("SELECT COUNT(*) AS count FROM sessions")).toEqual({
      count: 1,
    });
    expect(
      await queryFirst(
        "SELECT consumed_at FROM challenges WHERE id = ?1",
        begin.challenge_id,
      ),
    ).toEqual({ consumed_at: clock.current() });
  });

  it("rolls back a duplicate credential addition without revoking sessions", async () => {
    const clock = fakeClock();
    const service = makeCeremonyService({ clock, challengeFill: 0x62 });
    const credential = await createCredential({ idFill: 0x72 });
    const registered = await registerCeremony(service, { credential });
    const session = registered.result.handoff.session;
    const binding = bytes(32, 0xb4);
    const begin = await service.addCredentialOptions({
      bindingDigest: binding,
      session,
    });
    const response = await buildRegistrationResponse({
      challenge: begin.publicKey.challenge,
      rpID: CEREMONY_CONFIG.rpID,
      origin: CEREMONY_CONFIG.origin,
      credential,
    });
    await expectAuthError(
      () =>
        service.verifyAddCredential({
          bindingDigest: binding,
          body: verificationBody(begin.challenge_id, response),
          session,
        }),
      { code: "credential_conflict" },
    );
    expect(
      await queryFirst("SELECT COUNT(*) AS count FROM credentials"),
    ).toEqual({ count: 1 });
    expect(
      await queryFirst(
        "SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?1 AND revoked_at IS NULL",
        accountId("alice0001"),
      ),
    ).toEqual({ count: 1 });
    expect(
      await queryFirst(
        "SELECT consumed_at FROM challenges WHERE id = ?1",
        begin.challenge_id,
      ),
    ).toEqual({ consumed_at: clock.current() });
  });

  it("rejects an add-credential ceremony with an inconsistent session principal", async () => {
    const clock = fakeClock();
    const service = makeCeremonyService({ clock, challengeFill: 0x63 });
    const credential = await createCredential({ idFill: 0x73 });
    const registered = await registerCeremony(service, { credential });
    const session = registered.result.handoff.session;
    const binding = bytes(32, 0xb5);
    const begin = await service.addCredentialOptions({
      bindingDigest: binding,
      session,
    });
    const response = await buildRegistrationResponse({
      challenge: begin.publicKey.challenge,
      rpID: CEREMONY_CONFIG.rpID,
      origin: CEREMONY_CONFIG.origin,
      credential,
    });
    await expectAuthError(
      () =>
        service.verifyAddCredential({
          bindingDigest: binding,
          body: verificationBody(begin.challenge_id, response),
          session: { ...session, userId: accountId("other0001") },
        }),
      { code: "unauthorized" },
    );
    expect(
      await queryFirst("SELECT COUNT(*) AS count FROM credentials"),
    ).toEqual({ count: 1 });
  });
});
