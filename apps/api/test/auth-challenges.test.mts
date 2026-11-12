import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";

import { createAuthRepository } from "../repositories/auth.mjs";
import {
  AUTH_STORAGE_LIMITS,
  accountHandle,
  accountId,
  bytes,
  challengeId,
  countRows,
  expectAuthError,
  fakeClock,
  queryAll,
  queryFirst,
  registerAccount,
  resetAuthDatabase,
} from "./auth-fixtures.mts";

beforeEach(resetAuthDatabase);

function repositoryFor(clock) {
  let next = 0;
  return createAuthRepository(env.DB, {
    now: clock.now,
    newChallengeId: () => challengeId(0x30 + next++),
    newAccountHandle: () => accountHandle(0x51),
    newAccountId: () => accountId("challenge0001"),
    newDocumentId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
}

it("caps outstanding challenges at three per browser binding and reports Retry-After", async () => {
  const clock = fakeClock();
  const repository = repositoryFor(clock);
  const binding = bytes(32, 0x31);
  for (let index = 0; index < 3; index += 1) {
    await repository.issueSignInChallenge({
      challengeDigest: bytes(32, 0x40 + index),
      bindingDigest: binding,
    });
  }
  const error = await expectAuthError(
    () =>
      repository.issueSignInChallenge({
        challengeDigest: bytes(32, 0x44),
        bindingDigest: binding,
      }),
    { code: "rate_limited" },
  );
  expect(error.retryAfter).toBe(300);
  expect(await countRows("challenges")).toBe(3);

  await repository.issueSignInChallenge({
    challengeDigest: bytes(32, 0x45),
    bindingDigest: bytes(32, 0x32),
  });
  expect(await countRows("challenges")).toBe(4);
});

it("expires challenges before cleanup and frees the binding cap", async () => {
  const clock = fakeClock();
  const repository = repositoryFor(clock);
  const binding = bytes(32, 0x31);
  const challengeDigest = bytes(32, 0x41);
  const issued = await repository.issueSignInChallenge({
    challengeDigest,
    bindingDigest: binding,
  });
  expect(issued.expiresAt).toBe(
    clock.current() + AUTH_STORAGE_LIMITS.challengeLifetimeMs,
  );

  clock.advance(AUTH_STORAGE_LIMITS.challengeLifetimeMs + 1);
  await expectAuthError(
    () =>
      repository.consumeChallenge({
        challengeId: issued.challengeId,
        challengeDigest,
        bindingDigest: binding,
        purpose: "sign_in",
      }),
    { code: "authentication_failed" },
  );
  expect(await countRows("challenges")).toBe(1);

  await repository.issueSignInChallenge({
    challengeDigest: bytes(32, 0x42),
    bindingDigest: binding,
  });
  expect(await countRows("challenges")).toBe(1);
});

it("allows exactly one concurrent consumer of a challenge", async () => {
  const clock = fakeClock();
  const repository = repositoryFor(clock);
  const binding = bytes(32, 0x31);
  const challengeDigest = bytes(32, 0x41);
  const issued = await repository.issueSignInChallenge({
    challengeDigest,
    bindingDigest: binding,
  });

  const results = await Promise.allSettled([
    repository.consumeChallenge({
      challengeId: issued.challengeId,
      challengeDigest,
      bindingDigest: binding,
      purpose: "sign_in",
    }),
    repository.consumeChallenge({
      challengeId: issued.challengeId,
      challengeDigest,
      bindingDigest: binding,
      purpose: "sign_in",
    }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  expect(
    results.find((result) => result.status === "rejected").reason,
  ).toMatchObject({ code: "authentication_failed" });
  const row = await queryFirst(
    "SELECT consumed_at FROM challenges WHERE id = ?1",
    issued.challengeId,
  );
  expect(row.consumed_at).toBe(clock.current());

  await expectAuthError(
    () =>
      repository.consumeChallenge({
        challengeId: issued.challengeId,
        challengeDigest,
        bindingDigest: binding,
        purpose: "sign_in",
      }),
    { code: "authentication_failed" },
  );
});

it("rejects the wrong digest, purpose, binding, or account without burning the real challenge", async () => {
  const clock = fakeClock();
  const repository = repositoryFor(clock);
  const binding = bytes(32, 0x31);
  const challengeDigest = bytes(32, 0x41);
  const issued = await repository.issueRegistrationChallenge({
    challengeDigest,
    bindingDigest: binding,
    displayName: "Alice Example",
  });

  for (const rejection of [
    {
      challengeDigest: bytes(32, 0x99),
      bindingDigest: binding,
      purpose: "register",
      accountHandle: issued.accountHandle,
    },
    {
      challengeDigest,
      bindingDigest: bytes(32, 0x99),
      purpose: "register",
      accountHandle: issued.accountHandle,
    },
    {
      challengeDigest,
      bindingDigest: binding,
      purpose: "sign_in",
    },
    {
      challengeDigest,
      bindingDigest: binding,
      purpose: "register",
      accountHandle: accountHandle(0x99),
    },
    {
      challengeDigest: bytes(31, 0x41),
      bindingDigest: binding,
      purpose: "register",
      accountHandle: issued.accountHandle,
    },
  ]) {
    await expectAuthError(
      () =>
        repository.consumeChallenge({
          challengeId: issued.challengeId,
          ...rejection,
        }),
      { code: "authentication_failed" },
    );
    const row = await queryFirst(
      "SELECT consumed_at FROM challenges WHERE id = ?1",
      issued.challengeId,
    );
    expect(row.consumed_at).toBeNull();
  }

  await repository.consumeChallenge({
    challengeId: issued.challengeId,
    challengeDigest,
    bindingDigest: binding,
    purpose: "register",
    accountHandle: issued.accountHandle,
  });
});

it("binds session challenges to the active session account", async () => {
  const clock = fakeClock();
  let next = 0;
  const repository = createAuthRepository(env.DB, {
    now: clock.now,
    newChallengeId: () => challengeId(0x30 + next++),
    newAccountHandle: () => accountHandle(0x11),
    newAccountId: () => accountId("alice0001"),
    newDocumentId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  const registration = await registerAccount({ clock, repository });
  const binding = bytes(32, 0x61);

  await expectAuthError(
    () =>
      repository.issueSessionChallenge({
        purpose: "step_up",
        challengeDigest: bytes(32, 0x62),
        bindingDigest: binding,
        userId: accountId("other0001"),
        sessionDigest: registration.session.digest,
      }),
    { code: "unauthorized" },
  );

  const issued = await repository.issueSessionChallenge({
    purpose: "step_up",
    challengeDigest: bytes(32, 0x63),
    bindingDigest: binding,
    userId: accountId("alice0001"),
    sessionDigest: registration.session.digest,
  });
  expect(issued).toMatchObject({
    purpose: "step_up",
    userId: accountId("alice0001"),
  });

  await expectAuthError(
    () =>
      repository.consumeChallenge({
        challengeId: issued.challengeId,
        challengeDigest: bytes(32, 0x63),
        bindingDigest: binding,
        purpose: "step_up",
        userId: accountId("other0001"),
        sessionDigest: registration.session.digest,
      }),
    { code: "authentication_failed" },
  );
  await repository.revokeSession({
    sessionDigest: registration.session.digest,
    reason: "logout",
  });
  await expectAuthError(
    () =>
      repository.consumeChallenge({
        challengeId: issued.challengeId,
        challengeDigest: bytes(32, 0x63),
        bindingDigest: binding,
        purpose: "step_up",
        userId: accountId("alice0001"),
        sessionDigest: registration.session.digest,
      }),
    { code: "authentication_failed" },
  );
});

it("cleans expired abandoned registration state in bounded batches", async () => {
  const clock = fakeClock();
  const repository = repositoryFor(clock);
  await env.DB.prepare(
    "INSERT INTO challenges (id, challenge_digest, binding_digest, purpose, account_handle, display_name, user_id, session_digest, created_at, expires_at, consumed_at) VALUES (?1, ?2, ?3, 'register', ?4, 'Abandoned', NULL, NULL, 0, 300000, NULL)",
  )
    .bind(
      challengeId(0x70),
      bytes(32, 0x71),
      bytes(32, 0x72),
      accountHandle(0x73),
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO challenges (id, challenge_digest, binding_digest, purpose, account_handle, display_name, user_id, session_digest, created_at, expires_at, consumed_at) VALUES (?1, ?2, ?3, 'register', ?4, 'Abandoned', NULL, NULL, 0, 300000, 1000)",
  )
    .bind(
      challengeId(0x74),
      bytes(32, 0x75),
      bytes(32, 0x76),
      accountHandle(0x77),
    )
    .run();
  clock.set(400_000);

  expect(await repository.cleanupChallenges(1)).toBe(1);
  expect(await countRows("challenges")).toBe(1);
  expect(await repository.cleanupChallenges(10)).toBe(1);
  expect(await countRows("challenges")).toBe(0);
});

it("does not write a raw challenge and leaves only a 32-byte digest", async () => {
  const clock = fakeClock();
  const repository = repositoryFor(clock);
  const issued = await repository.issueSignInChallenge({
    challengeDigest: bytes(32, 0x41),
    bindingDigest: bytes(32, 0x42),
  });
  const row = await queryFirst(
    "SELECT length(challenge_digest) AS challenge_bytes, length(binding_digest) AS binding_bytes, hex(challenge_digest) AS digest FROM challenges WHERE id = ?1",
    issued.challengeId,
  );
  expect(row).toEqual({
    challenge_bytes: 32,
    binding_bytes: 32,
    digest: "41".repeat(32),
  });
  expect(
    (await queryAll("SELECT name FROM pragma_table_info('challenges')")).map(
      (entry) => entry.name,
    ),
  ).not.toContain("challenge");
});
