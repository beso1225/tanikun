import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";

import { createAuthRepository } from "../repositories/auth.mjs";
import {
  accountHandle,
  accountId,
  beginRegistration,
  bytes,
  challengeId,
  credential,
  credentialId,
  expectAuthError,
  fakeClock,
  makeRepository,
  queryAll,
  queryFirst,
  registerAccount,
  resetAuthDatabase,
  sessionSecrets,
} from "./auth-fixtures.mts";

beforeEach(resetAuthDatabase);

function accountCounts(id) {
  return Promise.all([
    queryFirst("SELECT COUNT(*) AS count FROM users WHERE id = ?1", id),
    queryFirst(
      "SELECT COUNT(*) AS count FROM credentials WHERE user_id = ?1",
      id,
    ),
    queryFirst(
      "SELECT COUNT(*) AS count FROM documents WHERE owner_id = ?1",
      id,
    ),
    queryFirst("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?1", id),
  ]).then((rows) => rows.map((row) => row.count));
}

it("creates one account, credential, document, and session atomically after challenge consumption", async () => {
  const clock = fakeClock();
  const begun = await registerAccount({ clock });
  const {
    repo,
    issued,
    session,
    credential: credentialValue,
    completed,
  } = begun;

  expect(completed.account).toEqual({
    userId: accountId("alice0001"),
    handle: accountHandle(0x11),
    displayName: "Alice Example",
  });
  expect(completed.credential).toMatchObject({
    credentialId: credentialValue.id,
    userId: accountId("alice0001"),
    counter: 0,
    backupEligible: false,
    backupState: false,
    createdAt: clock.current(),
    lastUsedAt: clock.current(),
  });
  expect(completed.document).toEqual({
    documentId: "11111111-1111-4111-8111-111111111111",
    cursor: 0,
  });
  expect(completed.session).toMatchObject({
    userId: accountId("alice0001"),
    createdAt: clock.current(),
    lastSeenAt: clock.current(),
    expiresAt: clock.current() + 43200000,
    idleExpiresAt: clock.current() + 1800000,
    recentAuthAt: clock.current(),
    recentAuth: true,
  });

  expect(
    await queryFirst(
      "SELECT id, handle, display_name, created_at FROM users WHERE id = ?1",
      accountId("alice0001"),
    ),
  ).toEqual({
    id: accountId("alice0001"),
    handle: accountHandle(0x11),
    display_name: "Alice Example",
    created_at: clock.current(),
  });
  expect(
    await queryFirst(
      "SELECT credential_id, user_id, hex(public_key) AS public_key, counter, backup_eligible, backup_state, created_at, last_used_at FROM credentials WHERE credential_id = ?1",
      credentialValue.id,
    ),
  ).toEqual({
    credential_id: credentialValue.id,
    user_id: accountId("alice0001"),
    public_key: "A1A1A1A1",
    counter: 0,
    backup_eligible: 0,
    backup_state: 0,
    created_at: clock.current(),
    last_used_at: clock.current(),
  });
  expect(
    await queryAll(
      "SELECT id, owner_id, last_seq, created_at FROM documents WHERE owner_id = ?1",
      accountId("alice0001"),
    ),
  ).toEqual([
    {
      id: "11111111-1111-4111-8111-111111111111",
      owner_id: accountId("alice0001"),
      last_seq: 0,
      created_at: clock.current(),
    },
  ]);
  expect(
    await queryFirst(
      "SELECT length(digest) AS digest_bytes, length(csrf_digest) AS csrf_bytes, user_id FROM sessions WHERE digest = ?1",
      session.digest,
    ),
  ).toEqual({
    digest_bytes: 32,
    csrf_bytes: 32,
    user_id: accountId("alice0001"),
  });
  expect(
    await queryFirst(
      "SELECT consumed_at FROM challenges WHERE id = ?1",
      issued.challengeId,
    ),
  ).toEqual({ consumed_at: clock.current() });

  expect(await repo.resolveSession(session.digest)).toMatchObject({
    account: { handle: accountHandle(0x11) },
    recentAuth: true,
  });
  expect(await repo.findCredential(credentialValue.id)).toMatchObject({
    credentialId: credentialValue.id,
    userId: accountId("alice0001"),
    counter: 0,
    backupEligible: false,
    backupState: false,
    accountHandle: accountHandle(0x11),
    displayName: "Alice Example",
  });
  expect(await repo.listCredentials(accountId("alice0001"))).toHaveLength(1);
});

it("does not create rows without a consumed, unexpired, correctly bound registration challenge", async () => {
  const clock = fakeClock();
  const alice = await registerAccount({ clock });
  const before = await Promise.all([
    queryFirst("SELECT COUNT(*) AS count FROM users"),
    queryFirst("SELECT COUNT(*) AS count FROM credentials"),
    queryFirst("SELECT COUNT(*) AS count FROM documents"),
    queryFirst("SELECT COUNT(*) AS count FROM sessions"),
  ]);

  const unconsumedRepository = makeRepository({
    clock,
    id: "bob00001",
    handle: accountHandle(0x21),
    documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    challenge: challengeId(0x23),
  });
  const unconsumed = await unconsumedRepository.issueRegistrationChallenge({
    challengeDigest: bytes(32, 0x91),
    bindingDigest: bytes(32, 0x92),
    displayName: "Bob Example",
  });
  await expectAuthError(
    () =>
      unconsumedRepository.completeRegistration({
        challengeId: unconsumed.challengeId,
        bindingDigest: bytes(32, 0x92),
        credential: credential({ idFill: 3 }),
        session: sessionSecrets(0x93),
      }),
    { code: "authentication_failed" },
  );
  expect(await accountCounts(accountId("bob00001"))).toEqual([0, 0, 0, 0]);

  const expiredRepository = makeRepository({
    clock,
    id: "carla0001",
    handle: accountHandle(0x31),
    documentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    challenge: challengeId(0x24),
  });
  const expiredChallenge = bytes(32, 0x94);
  const expiredBinding = bytes(32, 0x95);
  const expired = await expiredRepository.issueRegistrationChallenge({
    challengeDigest: expiredChallenge,
    bindingDigest: expiredBinding,
    displayName: "Carla Example",
  });
  await expiredRepository.consumeChallenge({
    challengeId: expired.challengeId,
    challengeDigest: expiredChallenge,
    bindingDigest: expiredBinding,
    purpose: "register",
    accountHandle: expired.accountHandle,
  });
  clock.advance(300001);
  await expectAuthError(
    () =>
      expiredRepository.completeRegistration({
        challengeId: expired.challengeId,
        bindingDigest: expiredBinding,
        credential: credential({ idFill: 4 }),
        session: sessionSecrets(0x96),
      }),
    { code: "authentication_failed" },
  );
  expect(await accountCounts(accountId("carla0001"))).toEqual([0, 0, 0, 0]);

  const wrongBindingRepository = makeRepository({
    clock,
    id: "dave0001",
    handle: accountHandle(0x41),
    documentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    challenge: challengeId(0x25),
  });
  const wrongBinding = bytes(32, 0x97);
  const wrong = await wrongBindingRepository.issueRegistrationChallenge({
    challengeDigest: bytes(32, 0x98),
    bindingDigest: wrongBinding,
    displayName: "Dave Example",
  });
  await wrongBindingRepository.consumeChallenge({
    challengeId: wrong.challengeId,
    challengeDigest: bytes(32, 0x98),
    bindingDigest: wrongBinding,
    purpose: "register",
    accountHandle: wrong.accountHandle,
  });
  await expectAuthError(
    () =>
      wrongBindingRepository.completeRegistration({
        challengeId: wrong.challengeId,
        bindingDigest: bytes(32, 0x99),
        credential: credential({ idFill: 5 }),
        session: sessionSecrets(0x9a),
      }),
    { code: "authentication_failed" },
  );
  expect(await accountCounts(accountId("dave0001"))).toEqual([0, 0, 0, 0]);

  const after = await Promise.all([
    queryFirst("SELECT COUNT(*) AS count FROM users"),
    queryFirst("SELECT COUNT(*) AS count FROM credentials"),
    queryFirst("SELECT COUNT(*) AS count FROM documents"),
    queryFirst("SELECT COUNT(*) AS count FROM sessions"),
  ]);
  expect(after.map((row) => row.count)).toEqual(before.map((row) => row.count));
  expect(await alice.repo.resolveSession(alice.session.digest)).not.toBeNull();
});

it.each(["documents", "sessions"])(
  "rolls back every registration row when the %s insert fails",
  async (failingTable) => {
    const clock = fakeClock();
    const repository = makeRepository({
      clock,
      id: "erin0001",
      handle: accountHandle(0x51),
      documentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      challenge: challengeId(0x26),
    });
    const challengeDigest = bytes(32, 0xa1);
    const bindingDigest = bytes(32, 0xa2);
    const issued = await repository.issueRegistrationChallenge({
      challengeDigest,
      bindingDigest,
      displayName: "Erin Example",
    });
    await repository.consumeChallenge({
      challengeId: issued.challengeId,
      challengeDigest,
      bindingDigest,
      purpose: "register",
      accountHandle: issued.accountHandle,
    });
    const credentialValue = credential({ idFill: 6 });
    const session = sessionSecrets(0xa3);

    await env.DB.exec(
      `CREATE TRIGGER reject_registration BEFORE INSERT ON ${failingTable} BEGIN SELECT RAISE(ABORT, 'synthetic_registration_failure'); END`,
    );
    await expectAuthError(
      () =>
        repository.completeRegistration({
          challengeId: issued.challengeId,
          bindingDigest,
          credential: credentialValue,
          session,
        }),
      { code: "temporarily_unavailable" },
    );
    expect(await accountCounts(accountId("erin0001"))).toEqual([0, 0, 0, 0]);
    expect(
      await queryFirst(
        "SELECT consumed_at FROM challenges WHERE id = ?1",
        issued.challengeId,
      ),
    ).toEqual({ consumed_at: clock.current() });

    await env.DB.exec("DROP TRIGGER reject_registration");
    const completed = await repository.completeRegistration({
      challengeId: issued.challengeId,
      bindingDigest,
      credential: credentialValue,
      session,
    });
    expect(completed.account.userId).toBe(accountId("erin0001"));
    expect(await accountCounts(accountId("erin0001"))).toEqual([1, 1, 1, 1]);
  },
);

it("maps account-handle, document, and credential uniqueness collisions to rollback without partial rows", async () => {
  const clock = fakeClock();
  const alice = await registerAccount({ clock });
  await env.DB.prepare("DELETE FROM challenges").run();

  const handleCollision = makeRepository({
    clock,
    id: "collision01",
    handle: accountHandle(0x11),
    documentId: "abababab-abab-4bab-8bab-abababababab",
    challenge: challengeId(0x27),
  });
  const handleRegistration = await beginRegistration({
    clock,
    repository: handleCollision,
    session: sessionSecrets(0x53),
    credential: credential({ idFill: 17 }),
  });
  await expectAuthError(
    () =>
      handleCollision.completeRegistration({
        challengeId: handleRegistration.issued.challengeId,
        bindingDigest: handleRegistration.bindingDigest,
        credential: handleRegistration.credential,
        session: handleRegistration.session,
      }),
    { code: "temporarily_unavailable" },
  );
  expect(await accountCounts(accountId("collision01"))).toEqual([0, 0, 0, 0]);

  const documentCollision = makeRepository({
    clock,
    id: "collision02",
    handle: accountHandle(0x12),
    documentId: "11111111-1111-4111-8111-111111111111",
    challenge: challengeId(0x28),
  });
  const documentRegistration = await beginRegistration({
    clock,
    repository: documentCollision,
    session: sessionSecrets(0x54),
    credential: credential({ idFill: 18 }),
  });
  await expectAuthError(
    () =>
      documentCollision.completeRegistration({
        challengeId: documentRegistration.issued.challengeId,
        bindingDigest: documentRegistration.bindingDigest,
        credential: documentRegistration.credential,
        session: documentRegistration.session,
      }),
    { code: "temporarily_unavailable" },
  );
  expect(await accountCounts(accountId("collision02"))).toEqual([0, 0, 0, 0]);
  expect(
    await queryFirst(
      "SELECT COUNT(*) AS count FROM documents WHERE owner_id = ?1",
      accountId("alice0001"),
    ),
  ).toEqual({ count: 1 });

  const credentialCollision = makeRepository({
    clock,
    id: "collision03",
    handle: accountHandle(0x13),
    documentId: "cdcdcdcd-cdcd-4cdc-8dcd-cdcdcdcdcdcd",
    challenge: challengeId(0x29),
  });
  const credentialRegistration = await beginRegistration({
    clock,
    repository: credentialCollision,
    session: sessionSecrets(0x55),
    credential: credential({ idFill: 1 }),
  });
  await expectAuthError(
    () =>
      credentialCollision.completeRegistration({
        challengeId: credentialRegistration.issued.challengeId,
        bindingDigest: credentialRegistration.bindingDigest,
        credential: credentialRegistration.credential,
        session: credentialRegistration.session,
      }),
    { code: "credential_conflict" },
  );
  expect(await accountCounts(accountId("collision03"))).toEqual([0, 0, 0, 0]);
  expect(await alice.repo.findCredential(alice.credential.id)).not.toBeNull();
});

it("adds credentials with ownership, recent-auth, and session guards", async () => {
  const clock = fakeClock();
  const alice = await registerAccount({ clock });
  const second = await alice.repo.addCredential({
    sessionDigest: alice.session.digest,
    userId: accountId("alice0001"),
    credential: credential({
      idFill: 7,
      publicKey: bytes(3, 0xb2),
      counter: 1,
      backupEligible: true,
      backupState: true,
    }),
  });
  expect(second).toMatchObject({
    credentialId: credentialId(7),
    userId: accountId("alice0001"),
    counter: 1,
    backupEligible: true,
    backupState: true,
    createdAt: clock.current(),
    lastUsedAt: clock.current(),
  });
  expect(await alice.repo.listCredentials(accountId("alice0001"))).toHaveLength(
    2,
  );

  const bob = await registerAccount({
    clock,
    repository: makeRepository({
      clock,
      id: "bob00001",
      handle: accountHandle(0x21),
      documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      challenge: challengeId(0x23),
    }),
    session: sessionSecrets(0x51),
    credential: credential({ idFill: 8 }),
  });
  await expectAuthError(
    () =>
      bob.repo.addCredential({
        sessionDigest: bob.session.digest,
        userId: accountId("bob00001"),
        credential: credential({ idFill: 7 }),
      }),
    { code: "credential_conflict" },
  );
  expect(await bob.repo.listCredentials(accountId("bob00001"))).toHaveLength(1);
  expect(await alice.repo.listCredentials(accountId("alice0001"))).toHaveLength(
    2,
  );

  await expectAuthError(
    () =>
      alice.repo.addCredential({
        sessionDigest: alice.session.digest,
        userId: accountId("bob00001"),
        credential: credential({ idFill: 9 }),
      }),
    { code: "unauthorized" },
  );
  expect(await alice.repo.listCredentials(accountId("alice0001"))).toHaveLength(
    2,
  );

  clock.advance(300001);
  await expectAuthError(
    () =>
      alice.repo.addCredential({
        sessionDigest: alice.session.digest,
        userId: accountId("alice0001"),
        credential: credential({ idFill: 9 }),
      }),
    { code: "recent_auth_required" },
  );
  expect(await alice.repo.listCredentials(accountId("alice0001"))).toHaveLength(
    2,
  );
  await alice.repo.recordRecentAuth({
    sessionDigest: alice.session.digest,
    userId: accountId("alice0001"),
  });
  await alice.repo.addCredential({
    sessionDigest: alice.session.digest,
    userId: accountId("alice0001"),
    credential: credential({ idFill: 9 }),
  });
  expect(await alice.repo.listCredentials(accountId("alice0001"))).toHaveLength(
    3,
  );

  await alice.repo.revokeSession({
    sessionDigest: alice.session.digest,
    reason: "logout",
  });
  await expectAuthError(
    () =>
      alice.repo.addCredential({
        sessionDigest: alice.session.digest,
        userId: accountId("alice0001"),
        credential: credential({ idFill: 10 }),
      }),
    { code: "unauthorized" },
  );
  expect(await alice.repo.listCredentials(accountId("alice0001"))).toHaveLength(
    3,
  );
});

it("leaves exactly 20 credentials when two additions race from 19", async () => {
  const clock = fakeClock();
  const alice = await registerAccount({ clock });
  for (let index = 0; index < 18; index += 1) {
    await alice.repo.addCredential({
      sessionDigest: alice.session.digest,
      userId: accountId("alice0001"),
      credential: credential({ idFill: 20 + index }),
    });
  }
  expect(await alice.repo.listCredentials(accountId("alice0001"))).toHaveLength(
    19,
  );

  const results = await Promise.allSettled([
    alice.repo.addCredential({
      sessionDigest: alice.session.digest,
      userId: accountId("alice0001"),
      credential: credential({ idFill: 60 }),
    }),
    alice.repo.addCredential({
      sessionDigest: alice.session.digest,
      userId: accountId("alice0001"),
      credential: credential({ idFill: 61 }),
    }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected.reason).toMatchObject({ code: "credential_limit" });
  expect(await alice.repo.listCredentials(accountId("alice0001"))).toHaveLength(
    20,
  );
});

it("rechecks the session inside the add-credential batch", async () => {
  const clock = fakeClock();
  const registration = await registerAccount({ clock });
  const database = {
    prepare: (sql) => env.DB.prepare(sql),
    batch: async (statements) => {
      await env.DB.prepare(
        "UPDATE sessions SET revoked_at = ?1, revoke_reason = 'logout' WHERE digest = ?2",
      )
        .bind(clock.current(), registration.session.digest)
        .run();
      return env.DB.batch(statements);
    },
  };
  const repository = createAuthRepository(database, {
    now: clock.now,
    newAccountId: () => accountId("alice0001"),
    newAccountHandle: () => accountHandle(0x11),
    newDocumentId: () => "11111111-1111-4111-8111-111111111111",
    newChallengeId: () => challengeId(0x22),
  });
  await expectAuthError(
    () =>
      repository.addCredential({
        sessionDigest: registration.session.digest,
        userId: accountId("alice0001"),
        credential: credential({ idFill: 70 }),
      }),
    { code: "unauthorized" },
  );
  expect(
    await queryFirst(
      "SELECT COUNT(*) AS count FROM credentials WHERE credential_id = ?1",
      credentialId(70),
    ),
  ).toEqual({ count: 0 });
});

it("enforces credential counts and session revocation when removing credentials", async () => {
  const clock = fakeClock();
  const alice = await registerAccount({ clock });

  await expectAuthError(
    () =>
      alice.repo.removeCredential({
        sessionDigest: alice.session.digest,
        userId: accountId("alice0001"),
        credentialId: alice.credential.id,
      }),
    { code: "last_credential" },
  );
  expect(await alice.repo.listCredentials(accountId("alice0001"))).toHaveLength(
    1,
  );
  expect(await alice.repo.resolveSession(alice.session.digest)).not.toBeNull();

  await alice.repo.addCredential({
    sessionDigest: alice.session.digest,
    userId: accountId("alice0001"),
    credential: credential({ idFill: 11 }),
  });
  await expect(
    alice.repo.removeCredential({
      sessionDigest: alice.session.digest,
      userId: accountId("alice0001"),
      credentialId: credentialId(99),
    }),
  ).rejects.toMatchObject({ code: "not_found" });
  expect(await alice.repo.resolveSession(alice.session.digest)).not.toBeNull();

  clock.advance(300001);
  await expectAuthError(
    () =>
      alice.repo.removeCredential({
        sessionDigest: alice.session.digest,
        userId: accountId("alice0001"),
        credentialId: credentialId(11),
      }),
    { code: "recent_auth_required" },
  );
  expect(await alice.repo.listCredentials(accountId("alice0001"))).toHaveLength(
    2,
  );
  expect(await alice.repo.resolveSession(alice.session.digest)).not.toBeNull();

  await alice.repo.recordRecentAuth({
    sessionDigest: alice.session.digest,
    userId: accountId("alice0001"),
  });
  await alice.repo.revokeSession({
    sessionDigest: alice.session.digest,
    reason: "logout",
  });
  await expectAuthError(
    () =>
      alice.repo.removeCredential({
        sessionDigest: alice.session.digest,
        userId: accountId("alice0001"),
        credentialId: credentialId(11),
      }),
    { code: "unauthorized" },
  );
  expect(await alice.repo.listCredentials(accountId("alice0001"))).toHaveLength(
    2,
  );

  const replacement = await alice.repo.createSession({
    userId: accountId("alice0001"),
    digest: bytes(32, 0xb1),
    csrfDigest: bytes(32, 0xb2),
  });
  const removed = await alice.repo.removeCredential({
    sessionDigest: replacement.digest,
    userId: accountId("alice0001"),
    credentialId: credentialId(11),
  });
  expect(removed).toEqual({ removed: true, revokedSessions: 1 });
  expect(await alice.repo.listCredentials(accountId("alice0001"))).toHaveLength(
    1,
  );
  expect(await alice.repo.resolveSession(replacement.digest)).toBeNull();
  expect(
    await queryFirst(
      "SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?1 AND revoked_at IS NULL",
      accountId("alice0001"),
    ),
  ).toEqual({ count: 0 });
});

it("leaves one credential when two removals race and never revokes on a failed guard", async () => {
  const clock = fakeClock();
  const alice = await registerAccount({ clock });
  await alice.repo.addCredential({
    sessionDigest: alice.session.digest,
    userId: accountId("alice0001"),
    credential: credential({ idFill: 12 }),
  });

  const results = await Promise.allSettled([
    alice.repo.removeCredential({
      sessionDigest: alice.session.digest,
      userId: accountId("alice0001"),
      credentialId: alice.credential.id,
    }),
    alice.repo.removeCredential({
      sessionDigest: alice.session.digest,
      userId: accountId("alice0001"),
      credentialId: credentialId(12),
    }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    results.find((result) => result.status === "rejected").reason.code,
  ).toBe("unauthorized");
  expect(await alice.repo.listCredentials(accountId("alice0001"))).toHaveLength(
    1,
  );
  expect(
    await queryFirst(
      "SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?1 AND revoked_at IS NULL",
      accountId("alice0001"),
    ),
  ).toEqual({ count: 0 });
});

it("rechecks the session inside the remove-credential batch", async () => {
  const clock = fakeClock();
  const registration = await registerAccount({ clock });
  await registration.repo.addCredential({
    sessionDigest: registration.session.digest,
    userId: accountId("alice0001"),
    credential: credential({ idFill: 13 }),
  });
  const database = {
    prepare: (sql) => env.DB.prepare(sql),
    batch: async (statements) => {
      await env.DB.prepare(
        "UPDATE sessions SET revoked_at = ?1, revoke_reason = 'logout' WHERE digest = ?2",
      )
        .bind(clock.current(), registration.session.digest)
        .run();
      return env.DB.batch(statements);
    },
  };
  const repository = createAuthRepository(database, {
    now: clock.now,
    newAccountId: () => accountId("alice0001"),
    newAccountHandle: () => accountHandle(0x11),
    newDocumentId: () => "11111111-1111-4111-8111-111111111111",
    newChallengeId: () => challengeId(0x22),
  });
  await expectAuthError(
    () =>
      repository.removeCredential({
        sessionDigest: registration.session.digest,
        userId: accountId("alice0001"),
        credentialId: credentialId(13),
      }),
    { code: "unauthorized" },
  );
  expect(
    await queryFirst(
      "SELECT COUNT(*) AS count FROM credentials WHERE credential_id = ?1",
      credentialId(13),
    ),
  ).toEqual({ count: 1 });
  expect(
    await queryFirst(
      "SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL",
    ),
  ).toEqual({ count: 0 });
});

it("maps an unexpected D1 read failure to a redacted storage error", async () => {
  const clock = fakeClock();
  const alice = await registerAccount({ clock });
  await env.DB.exec(
    "ALTER TABLE credentials RENAME TO credentials_unavailable",
  );
  const error = await expectAuthError(
    () => alice.repo.listCredentials(accountId("alice0001")),
    { code: "temporarily_unavailable" },
  );
  expect(error.message).toBe("temporarily_unavailable");
});

it("applies the single-device strict and backup-eligible max counter policies", async () => {
  const clock = fakeClock();
  const strict = await registerAccount({ clock });
  const strictId = strict.credential.id;

  expect(
    await strict.repo.recordAssertion({
      credentialId: strictId,
      userId: accountId("alice0001"),
      newCounter: 0,
      backupEligible: false,
      backupState: false,
    }),
  ).toMatchObject({ counter: 0, backupEligible: false, backupState: false });
  expect(
    await strict.repo.recordAssertion({
      credentialId: strictId,
      userId: accountId("alice0001"),
      newCounter: 1,
      backupEligible: false,
      backupState: false,
    }),
  ).toMatchObject({ counter: 1, lastUsedAt: clock.current() });
  for (const newCounter of [0, 1]) {
    await expectAuthError(
      () =>
        strict.repo.recordAssertion({
          credentialId: strictId,
          userId: accountId("alice0001"),
          newCounter,
          backupEligible: false,
          backupState: false,
        }),
      { code: "authentication_failed" },
    );
  }
  expect(
    await strict.repo.recordAssertion({
      credentialId: strictId,
      userId: accountId("alice0001"),
      newCounter: 2,
      backupEligible: false,
      backupState: false,
    }),
  ).toMatchObject({ counter: 2 });
  await expectAuthError(
    () =>
      strict.repo.recordAssertion({
        credentialId: strictId,
        userId: accountId("alice0001"),
        newCounter: 3,
        backupEligible: true,
        backupState: false,
      }),
    { code: "authentication_failed" },
  );
  await expectAuthError(
    () =>
      strict.repo.recordAssertion({
        credentialId: strictId,
        userId: accountId("alice0001"),
        newCounter: 3,
        backupEligible: false,
        backupState: true,
      }),
    { code: "authentication_failed" },
  );
  expect(
    await queryFirst(
      "SELECT counter, backup_eligible, backup_state FROM credentials WHERE credential_id = ?1",
      strictId,
    ),
  ).toEqual({ counter: 2, backup_eligible: 0, backup_state: 0 });

  const eligible = await registerAccount({
    clock,
    repository: makeRepository({
      clock,
      id: "bob00001",
      handle: accountHandle(0x21),
      documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      challenge: challengeId(0x23),
    }),
    session: sessionSecrets(0x51),
    credential: credential({
      idFill: 14,
      counter: 5,
      backupEligible: true,
      backupState: false,
    }),
  });
  const eligibleId = eligible.credential.id;
  expect(
    await eligible.repo.recordAssertion({
      credentialId: eligibleId,
      userId: accountId("bob00001"),
      newCounter: 2,
      backupEligible: true,
      backupState: true,
    }),
  ).toMatchObject({ counter: 5, backupEligible: true, backupState: true });
  expect(
    await eligible.repo.recordAssertion({
      credentialId: eligibleId,
      userId: accountId("bob00001"),
      newCounter: 7,
      backupEligible: true,
      backupState: true,
    }),
  ).toMatchObject({ counter: 7, backupState: true });
  expect(
    await eligible.repo.recordAssertion({
      credentialId: eligibleId,
      userId: accountId("bob00001"),
      newCounter: 0,
      backupEligible: true,
      backupState: false,
    }),
  ).toMatchObject({ counter: 7, backupState: false });
  await expectAuthError(
    () =>
      eligible.repo.recordAssertion({
        credentialId: eligibleId,
        userId: accountId("bob00001"),
        newCounter: 8,
        backupEligible: false,
        backupState: false,
      }),
    { code: "authentication_failed" },
  );
});

it("serializes concurrent counter updates without lowering the stored maximum or bypassing strict guards", async () => {
  const strictClock = fakeClock();
  const strict = await registerAccount({ clock: strictClock });
  const strictResults = await Promise.allSettled([
    strict.repo.recordAssertion({
      credentialId: strict.credential.id,
      userId: accountId("alice0001"),
      newCounter: 1,
      backupEligible: false,
      backupState: false,
    }),
    strict.repo.recordAssertion({
      credentialId: strict.credential.id,
      userId: accountId("alice0001"),
      newCounter: 1,
      backupEligible: false,
      backupState: false,
    }),
  ]);
  expect(
    strictResults.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    strictResults.find((result) => result.status === "rejected").reason.code,
  ).toBe("authentication_failed");
  expect(
    await queryFirst(
      "SELECT counter FROM credentials WHERE credential_id = ?1",
      strict.credential.id,
    ),
  ).toEqual({ counter: 1 });

  const eligibleClock = fakeClock();
  const eligible = await registerAccount({
    clock: eligibleClock,
    repository: makeRepository({
      clock: eligibleClock,
      id: "bob00001",
      handle: accountHandle(0x21),
      documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      challenge: challengeId(0x23),
    }),
    session: sessionSecrets(0x51),
    credential: credential({
      idFill: 15,
      counter: 5,
      backupEligible: true,
      backupState: false,
    }),
  });
  const eligibleResults = await Promise.all([
    eligible.repo.recordAssertion({
      credentialId: eligible.credential.id,
      userId: accountId("bob00001"),
      newCounter: 9,
      backupEligible: true,
      backupState: true,
    }),
    eligible.repo.recordAssertion({
      credentialId: eligible.credential.id,
      userId: accountId("bob00001"),
      newCounter: 2,
      backupEligible: true,
      backupState: true,
    }),
  ]);
  expect(eligibleResults.every((result) => result.counter >= 5)).toBe(true);
  expect(
    await queryFirst(
      "SELECT counter FROM credentials WHERE credential_id = ?1",
      eligible.credential.id,
    ),
  ).toEqual({ counter: 9 });
});

it("scopes credential lookup and assertion updates by owner", async () => {
  const clock = fakeClock();
  const alice = await registerAccount({ clock });
  const bob = await registerAccount({
    clock,
    repository: makeRepository({
      clock,
      id: "bob00001",
      handle: accountHandle(0x21),
      documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      challenge: challengeId(0x23),
    }),
    session: sessionSecrets(0x51),
    credential: credential({ idFill: 16 }),
  });

  expect(await alice.repo.findCredential(bob.credential.id)).toMatchObject({
    credentialId: bob.credential.id,
    userId: accountId("bob00001"),
  });
  expect(await alice.repo.findCredential(credentialId(99))).toBeNull();
  await expectAuthError(
    () =>
      alice.repo.recordAssertion({
        credentialId: bob.credential.id,
        userId: accountId("alice0001"),
        newCounter: 1,
        backupEligible: false,
        backupState: false,
      }),
    { code: "not_found" },
  );
  await expectAuthError(
    () =>
      alice.repo.removeCredential({
        sessionDigest: alice.session.digest,
        userId: accountId("alice0001"),
        credentialId: bob.credential.id,
      }),
    { code: "not_found" },
  );
  expect(
    await queryFirst(
      "SELECT counter FROM credentials WHERE credential_id = ?1",
      bob.credential.id,
    ),
  ).toEqual({ counter: 0 });
  expect(await bob.repo.listCredentials(accountId("bob00001"))).toHaveLength(1);
  expect(await alice.repo.listCredentials(accountId("alice0001"))).toHaveLength(
    1,
  );
});
