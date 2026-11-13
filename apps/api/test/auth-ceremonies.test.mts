import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { createAuthRepository } from "../repositories/auth.mjs";
import { createAuthCeremonyService } from "../webauthn/service.mjs";
import {
  accountHandle,
  accountId,
  bytes,
  challengeId,
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

const config = {
  mode: "session",
  origin: "https://localhost:4300",
  rpID: "localhost",
  rpName: "Tanikun",
};
const BINDING = bytes(32, 0x31);

beforeEach(resetAuthDatabase);

function makeService({
  clock,
  account = "alice0001",
  handleFill = 0x11,
  documentId = "11111111-1111-4111-8111-111111111111",
  challengeFill = 0x21,
  sessionMaterial,
} = {}) {
  let challenge = 0;
  const repository = createAuthRepository(env.DB, {
    now: clock.now,
    newChallengeId: () => challengeId((challengeFill + challenge++) & 0xff),
    newAccountId: () => accountId(account),
    newAccountHandle: () => accountHandle(handleFill),
    newDocumentId: () => documentId,
  });
  return createAuthCeremonyService({
    db: env.DB,
    config,
    repository,
    ...(sessionMaterial ? { sessionMaterial } : {}),
  });
}

async function register(
  service,
  {
    credential,
    displayName = "Alice Example",
    counter = 0,
    backupEligible = false,
    backupState = false,
  } = {},
) {
  const fixture = credential ?? (await createCredential());
  const options = await service.registrationOptions({
    bindingDigest: BINDING,
    displayName,
  });
  const response = await buildRegistrationResponse({
    challenge: options.publicKey.challenge,
    rpID: config.rpID,
    origin: config.origin,
    credential: fixture,
    counter,
    backupEligible,
    backupState,
  });
  const result = await service.verifyRegistration({
    bindingDigest: BINDING,
    body: verificationBody(options.challenge_id, response),
  });
  return { credential: fixture, options, response, result };
}

describe("Phase 5 registration ceremony", () => {
  it("projects exact registration options, derives the handle from the challenge row, and creates the account atomically", async () => {
    const clock = fakeClock();
    const service = makeService({ clock });
    const credential = await createCredential();
    const { options, result } = await register(service, {
      credential,
      displayName: "Alice Example",
    });

    expect(Object.keys(options)).toEqual(["challenge_id", "publicKey"]);
    expect(Object.keys(options.publicKey).toSorted()).toEqual(
      [
        "rp",
        "user",
        "challenge",
        "pubKeyCredParams",
        "timeout",
        "excludeCredentials",
        "authenticatorSelection",
        "attestation",
      ].toSorted(),
    );
    expect(options.publicKey.rp).toEqual({ id: "localhost", name: "Tanikun" });
    expect(options.publicKey.pubKeyCredParams).toEqual([
      { type: "public-key", alg: -7 },
    ]);
    expect(options.publicKey.timeout).toBe(120000);
    expect(options.publicKey.attestation).toBe("none");
    expect(options.publicKey.authenticatorSelection).toEqual({
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    });
    expect(options.publicKey.excludeCredentials).toEqual([]);
    expect(options.publicKey.user.name).toBe("Alice Example");
    expect(options.publicKey.user.displayName).toBe("Alice Example");
    expect(options.publicKey.user.id).toHaveLength(43);
    expect(Buffer.from(options.publicKey.user.id, "base64url").length).toBe(32);
    expect(options.publicKey).not.toHaveProperty("extensions");
    expect(options.publicKey).not.toHaveProperty("hints");
    expect(JSON.stringify(options)).not.toMatch(
      /credProps|extensions|hints|prf/u,
    );

    expect(result.body.session.account.handle).toBe(options.publicKey.user.id);
    expect(result.body.session.account.display_name).toBe("Alice Example");
    expect(result.body.session.csrf_token).toHaveLength(43);
    expect(result.handoff.token).toHaveLength(43);
    expect(result.handoff.csrfToken).toBe(result.body.session.csrf_token);
    expect(JSON.stringify(result.body)).not.toContain(result.handoff.token);

    expect(
      await queryFirst(
        "SELECT id, handle, display_name FROM users WHERE id = ?1",
        accountId("alice0001"),
      ),
    ).toEqual({
      id: accountId("alice0001"),
      handle: options.publicKey.user.id,
      display_name: "Alice Example",
    });
    expect(
      await queryFirst(
        "SELECT credential_id, user_id, counter, backup_eligible, backup_state FROM credentials WHERE credential_id = ?1",
        credential.credentialId,
      ),
    ).toEqual({
      credential_id: credential.credentialId,
      user_id: accountId("alice0001"),
      counter: 0,
      backup_eligible: 0,
      backup_state: 0,
    });
    expect(
      await queryFirst(
        "SELECT consumed_at FROM challenges WHERE id = ?1",
        options.challenge_id,
      ),
    ).toEqual({ consumed_at: clock.current() });
    expect(
      await queryFirst(
        "SELECT COUNT(*) AS count FROM sessions WHERE digest = ?1",
        result.handoff.session.digest,
      ),
    ).toEqual({ count: 1 });
  });

  it("rejects a registration with a wrong origin or RP ID after consuming the challenge", async () => {
    const clock = fakeClock();
    const service = makeService({ clock });
    const credential = await createCredential();
    const options = await service.registrationOptions({
      bindingDigest: BINDING,
      displayName: "Wrong origin",
    });
    const response = await buildRegistrationResponse({
      challenge: options.publicKey.challenge,
      rpID: config.rpID,
      origin: "https://evil.example",
      credential,
    });
    await expectAuthError(
      () =>
        service.verifyRegistration({
          bindingDigest: BINDING,
          body: verificationBody(options.challenge_id, response),
        }),
      { code: "authentication_failed" },
    );
    expect(
      await queryFirst(
        "SELECT consumed_at FROM challenges WHERE id = ?1",
        options.challenge_id,
      ),
    ).toEqual({ consumed_at: clock.current() });
    expect(await queryFirst("SELECT COUNT(*) AS count FROM users")).toEqual({
      count: 0,
    });
  });

  it("does not create a second account when a completed registration is replayed", async () => {
    const clock = fakeClock();
    const service = makeService({ clock });
    const credential = await createCredential();
    const registered = await register(service, { credential });
    await expectAuthError(
      () =>
        service.verifyRegistration({
          bindingDigest: BINDING,
          body: verificationBody(
            registered.options.challenge_id,
            registered.response,
          ),
        }),
      { code: "authentication_failed" },
    );
    expect(await queryFirst("SELECT COUNT(*) AS count FROM users")).toEqual({
      count: 1,
    });
    expect(await queryFirst("SELECT COUNT(*) AS count FROM sessions")).toEqual({
      count: 1,
    });
  });

  it("does not create an account or session for an expired registration challenge", async () => {
    const clock = fakeClock();
    const service = makeService({ clock });
    const credential = await createCredential();
    const options = await service.registrationOptions({
      bindingDigest: BINDING,
      displayName: "Expired",
    });
    const response = await buildRegistrationResponse({
      challenge: options.publicKey.challenge,
      rpID: config.rpID,
      origin: config.origin,
      credential,
    });
    clock.advance(300_001);
    await expectAuthError(
      () =>
        service.verifyRegistration({
          bindingDigest: BINDING,
          body: verificationBody(options.challenge_id, response),
        }),
      { code: "authentication_failed" },
    );
    expect(await queryFirst("SELECT COUNT(*) AS count FROM users")).toEqual({
      count: 0,
    });
    expect(await queryFirst("SELECT COUNT(*) AS count FROM sessions")).toEqual({
      count: 0,
    });
    expect(
      await queryFirst(
        "SELECT consumed_at FROM challenges WHERE id = ?1",
        options.challenge_id,
      ),
    ).toEqual({ consumed_at: null });
  });
});

describe("Phase 5 discoverable sign-in", () => {
  it("rotates the presented session, updates the counter, and never puts the token in JSON", async () => {
    const clock = fakeClock();
    const service = makeService({ clock });
    const credential = await createCredential();
    const registered = await register(service, { credential });
    const handle = registered.options.publicKey.user.id;

    const begin = await service.signInOptions({ bindingDigest: BINDING });
    const assertion = await buildAssertionResponse({
      challenge: begin.publicKey.challenge,
      rpID: config.rpID,
      origin: config.origin,
      credential,
      counter: 4,
      userHandle: handle,
    });
    const result = await service.verifySignIn({
      bindingDigest: BINDING,
      body: verificationBody(begin.challenge_id, assertion),
      presentedSession: { digest: registered.result.handoff.session.digest },
    });

    expect(result.body.session.account.handle).toBe(handle);
    expect(result.handoff.token).toHaveLength(43);
    expect(JSON.stringify(result.body)).not.toContain(result.handoff.token);
    expect(
      await queryFirst(
        "SELECT counter, last_used_at FROM credentials WHERE credential_id = ?1",
        credential.credentialId,
      ),
    ).toEqual({ counter: 4, last_used_at: clock.current() });
    expect(
      await queryFirst(
        "SELECT revoked_at, revoke_reason FROM sessions WHERE digest = ?1",
        registered.result.handoff.session.digest,
      ),
    ).toEqual({
      revoked_at: clock.current(),
      revoke_reason: "sign_in_rotation",
    });
    expect(
      await queryFirst(
        "SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?1 AND revoked_at IS NULL",
        accountId("alice0001"),
      ),
    ).toEqual({ count: 1 });
  });

  it("does not authenticate a removed credential after successful verification", async () => {
    const clock = fakeClock();
    const service = makeService({ clock });
    const credential = await createCredential();
    const registered = await register(service, { credential });
    const handle = registered.options.publicKey.user.id;
    const begin = await service.signInOptions({ bindingDigest: BINDING });
    const assertion = await buildAssertionResponse({
      challenge: begin.publicKey.challenge,
      rpID: config.rpID,
      origin: config.origin,
      credential,
      userHandle: handle,
    });
    await env.DB.prepare("DELETE FROM credentials WHERE credential_id = ?1")
      .bind(credential.credentialId)
      .run();
    await expectAuthError(
      () =>
        service.verifySignIn({
          bindingDigest: BINDING,
          body: verificationBody(begin.challenge_id, assertion),
          presentedSession: {
            digest: registered.result.handoff.session.digest,
          },
        }),
      { code: "authentication_failed" },
    );
    expect(
      await queryFirst(
        "SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?1 AND revoked_at IS NULL",
        accountId("alice0001"),
      ),
    ).toEqual({ count: 1 });
  });
});

describe("Phase 5 step-up and account-bound credential addition", () => {
  it("raises recent auth without rotating the session or adding a second session", async () => {
    const clock = fakeClock();
    const service = makeService({ clock });
    const credential = await createCredential();
    const registered = await register(service, { credential });
    const handle = registered.options.publicKey.user.id;
    const session = registered.result.handoff.session;
    clock.advance(6 * 60 * 1000);

    const begin = await service.stepUpOptions({
      bindingDigest: BINDING,
      session: { ...session, recentAuth: false },
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
    expect(begin.publicKey.allowCredentials).toEqual([
      { type: "public-key", id: credential.credentialId },
    ]);
    expect(begin.publicKey).not.toHaveProperty("extensions");
    const assertion = await buildAssertionResponse({
      challenge: begin.publicKey.challenge,
      rpID: config.rpID,
      origin: config.origin,
      credential,
      counter: 2,
      userHandle: handle,
    });
    const result = await service.verifyStepUp({
      bindingDigest: BINDING,
      body: verificationBody(begin.challenge_id, assertion),
      session: { ...session, recentAuth: false },
    });
    expect(result.body).toEqual({
      recent_auth: true,
      recent_auth_expires_at: clock.current() + 300000,
    });
    expect(result.handoff.kind).toBe("recent_auth");
    expect(
      await queryFirst(
        "SELECT counter, last_used_at FROM credentials WHERE credential_id = ?1",
        credential.credentialId,
      ),
    ).toEqual({ counter: 2, last_used_at: clock.current() });
    expect(
      await queryFirst(
        "SELECT recent_auth_at, revoked_at FROM sessions WHERE digest = ?1",
        session.digest,
      ),
    ).toEqual({ recent_auth_at: clock.current(), revoked_at: null });
    expect(
      await queryFirst(
        "SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?1",
        accountId("alice0001"),
      ),
    ).toEqual({ count: 1 });
  });

  it("adds a second credential to the current account and keeps existing sessions", async () => {
    const clock = fakeClock();
    const service = makeService({ clock });
    const first = await createCredential({ idFill: 1 });
    const second = await createCredential({ idFill: 40 });
    const registered = await register(service, { credential: first });
    const handle = registered.options.publicKey.user.id;
    const session = registered.result.handoff.session;

    const begin = await service.addCredentialOptions({
      bindingDigest: BINDING,
      session,
    });
    expect(begin.publicKey.user.id).toBe(handle);
    expect(begin.publicKey.excludeCredentials).toEqual([
      { type: "public-key", id: first.credentialId },
    ]);
    const response = await buildRegistrationResponse({
      challenge: begin.publicKey.challenge,
      rpID: config.rpID,
      origin: config.origin,
      credential: second,
      backupEligible: true,
      backupState: true,
    });
    const result = await service.verifyAddCredential({
      bindingDigest: BINDING,
      body: verificationBody(begin.challenge_id, response),
      session,
    });
    expect(result.body.credential).toMatchObject({
      id: second.credentialId,
      backup_eligible: true,
      backup_state: true,
    });
    expect(result.body.credential).not.toHaveProperty("public_key");
    expect(result.handoff.kind).toBe("credential");
    expect(
      await queryAll(
        "SELECT credential_id, backup_eligible, backup_state FROM credentials WHERE user_id = ?1 ORDER BY credential_id",
        accountId("alice0001"),
      ),
    ).toHaveLength(2);
    expect(
      await queryFirst(
        "SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?1 AND revoked_at IS NULL",
        accountId("alice0001"),
      ),
    ).toEqual({ count: 1 });
  });
});
