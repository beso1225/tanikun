import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";

import {
  AUTH_STORAGE_LIMITS,
  accountHandle,
  accountId,
  bytes,
  challengeId,
  countRows,
  credential,
  expectAuthError,
  fakeClock,
  makeRepository,
  queryFirst,
  registerAccount,
  resetAuthDatabase,
  sessionSecrets,
} from "./auth-fixtures.mts";

beforeEach(resetAuthDatabase);

async function sessionRow(digest) {
  return queryFirst(
    "SELECT user_id, created_at, last_seen_at, expires_at, idle_expires_at, recent_auth_at, revoked_at, revoke_reason FROM sessions WHERE digest = ?1",
    digest,
  );
}

it("resolves active sessions, computes recent auth, and writes last-seen at most once per minute", async () => {
  const clock = fakeClock();
  const { repo, session, completed } = await registerAccount({ clock });
  const resolved = await repo.resolveSession(session.digest);
  expect(resolved).toMatchObject({
    userId: accountId("alice0001"),
    account: {
      userId: accountId("alice0001"),
      handle: accountHandle(0x11),
      displayName: "Alice Example",
    },
    recentAuth: true,
    recentAuthAt: clock.current(),
    recentAuthExpiresAt:
      clock.current() + AUTH_STORAGE_LIMITS.recentAuthWindowMs,
    expiresAt: completed.session.expiresAt,
    idleExpiresAt: completed.session.idleExpiresAt,
  });

  const initial = await sessionRow(session.digest);
  clock.advance(AUTH_STORAGE_LIMITS.sessionLastSeenWriteMs - 1000);
  expect((await repo.resolveSession(session.digest)).lastSeenAt).toBe(
    initial.last_seen_at,
  );
  expect((await sessionRow(session.digest)).last_seen_at).toBe(
    initial.last_seen_at,
  );

  clock.advance(2000);
  const touched = await repo.resolveSession(session.digest);
  expect(touched.lastSeenAt).toBe(clock.current());
  expect(touched.idleExpiresAt).toBe(
    clock.current() + AUTH_STORAGE_LIMITS.sessionIdleLifetimeMs,
  );
  expect((await sessionRow(session.digest)).last_seen_at).toBe(clock.current());

  clock.advance(AUTH_STORAGE_LIMITS.recentAuthWindowMs);
  const expiredRecent = await repo.resolveSession(session.digest, {
    touch: false,
  });
  expect(expiredRecent.recentAuth).toBe(false);
  expect(expiredRecent.recentAuthExpiresAt).toBe(
    initial.recent_auth_at + AUTH_STORAGE_LIMITS.recentAuthWindowMs,
  );

  const stepped = await repo.recordRecentAuth({
    sessionDigest: session.digest,
    userId: accountId("alice0001"),
  });
  expect(stepped).toMatchObject({
    recentAuth: true,
    recentAuthAt: clock.current(),
    recentAuthExpiresAt:
      clock.current() + AUTH_STORAGE_LIMITS.recentAuthWindowMs,
  });
});

it("rejects idle-expired and absolute-expired sessions before cleanup", async () => {
  const idleClock = fakeClock();
  const idle = await registerAccount({ clock: idleClock });
  idleClock.advance(AUTH_STORAGE_LIMITS.sessionIdleLifetimeMs + 1);
  expect(await idle.repo.resolveSession(idle.session.digest)).toBeNull();
  expect(await countRows("sessions")).toBe(1);
  expect(await idle.repo.cleanupSessions(10)).toBe(1);
  expect(await countRows("sessions")).toBe(0);

  const absoluteClock = fakeClock();
  const absolute = await registerAccount({
    clock: absoluteClock,
    repository: makeRepository({
      clock: absoluteClock,
      id: "absolute01",
      handle: accountHandle(0x31),
      documentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      challenge: challengeId(0x24),
    }),
    session: sessionSecrets(0x52),
    credential: credential({ idFill: 2 }),
  });
  for (let index = 0; index < 24; index += 1) {
    absoluteClock.advance(29 * 60 * 1000);
    expect(
      await absolute.repo.resolveSession(absolute.session.digest),
    ).not.toBeNull();
  }
  absoluteClock.advance(
    AUTH_STORAGE_LIMITS.sessionAbsoluteLifetimeMs - 24 * 29 * 60 * 1000,
  );
  expect(
    await absolute.repo.resolveSession(absolute.session.digest),
  ).toBeNull();
  expect(await countRows("sessions")).toBe(1);
});

it("revokes one session or every account session without affecting another account", async () => {
  const clock = fakeClock();
  const alice = await registerAccount({ clock });
  const aliceSecond = await alice.repo.createSession({
    userId: accountId("alice0001"),
    digest: bytes(32, 0x61),
    csrfDigest: bytes(32, 0x62),
  });
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
    credential: credential({ idFill: 2 }),
  });

  expect(
    await alice.repo.revokeSession({
      sessionDigest: alice.session.digest,
      reason: "logout",
    }),
  ).toBe(true);
  expect(await alice.repo.resolveSession(alice.session.digest)).toBeNull();
  expect(await alice.repo.resolveSession(aliceSecond.digest)).not.toBeNull();
  expect(await bob.repo.resolveSession(bob.session.digest)).not.toBeNull();
  expect(
    await alice.repo.revokeSession({
      sessionDigest: alice.session.digest,
      reason: "logout",
    }),
  ).toBe(false);
  expect((await sessionRow(alice.session.digest)).revoke_reason).toBe("logout");

  expect(
    await alice.repo.revokeAllSessions({
      userId: accountId("alice0001"),
      reason: "logout_all",
    }),
  ).toBe(1);
  expect(await alice.repo.resolveSession(aliceSecond.digest)).toBeNull();
  expect((await sessionRow(aliceSecond.digest)).revoke_reason).toBe(
    "logout_all",
  );
  expect(await bob.repo.resolveSession(bob.session.digest)).not.toBeNull();
});

it("rotates a presented session and inserts the replacement atomically", async () => {
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
    credential: credential({ idFill: 2 }),
  });

  const rotated = await alice.repo.rotateSession({
    presentedDigest: alice.session.digest,
    userId: accountId("alice0001"),
    digest: bytes(32, 0xc1),
    csrfDigest: bytes(32, 0xc2),
  });
  expect(rotated.revokedPrevious).toBe(true);
  expect(rotated.session.digest).toEqual(bytes(32, 0xc1));
  expect(await alice.repo.resolveSession(alice.session.digest)).toBeNull();
  expect((await sessionRow(alice.session.digest)).revoke_reason).toBe(
    "sign_in_rotation",
  );
  expect(
    await alice.repo.resolveSession(rotated.session.digest),
  ).not.toBeNull();
  expect(await bob.repo.resolveSession(bob.session.digest)).not.toBeNull();

  const withoutPrevious = await alice.repo.rotateSession({
    presentedDigest: bytes(32, 0xc9),
    userId: accountId("alice0001"),
    digest: bytes(32, 0xc3),
    csrfDigest: bytes(32, 0xc4),
  });
  expect(withoutPrevious.revokedPrevious).toBe(false);
  expect(
    await alice.repo.resolveSession(withoutPrevious.session.digest),
  ).not.toBeNull();

  const retained = withoutPrevious.session;
  await expectAuthError(
    () =>
      alice.repo.rotateSession({
        presentedDigest: retained.digest,
        userId: accountId("missing0001"),
        digest: bytes(32, 0xca),
        csrfDigest: bytes(32, 0xcb),
      }),
    { code: "not_found" },
  );
  expect(await alice.repo.resolveSession(retained.digest)).not.toBeNull();
  expect(
    await queryFirst(
      "SELECT COUNT(*) AS count FROM sessions WHERE digest = ?1",
      bytes(32, 0xca),
    ),
  ).toEqual({ count: 0 });

  await env.DB.exec(
    `CREATE TRIGGER reject_rotation BEFORE INSERT ON sessions WHEN hex(NEW.digest) = '${"C5".repeat(32)}' BEGIN SELECT RAISE(ABORT, 'synthetic_rotation_failure'); END`,
  );
  await expectAuthError(
    () =>
      alice.repo.rotateSession({
        presentedDigest: retained.digest,
        userId: accountId("alice0001"),
        digest: bytes(32, 0xc5),
        csrfDigest: bytes(32, 0xc6),
      }),
    { code: "temporarily_unavailable" },
  );
  await env.DB.exec("DROP TRIGGER reject_rotation");
  expect(await alice.repo.resolveSession(retained.digest)).not.toBeNull();
  expect(
    await queryFirst(
      "SELECT COUNT(*) AS count FROM sessions WHERE digest = ?1",
      bytes(32, 0xc5),
    ),
  ).toEqual({ count: 0 });
});

it("cleans revoked sessions with a controlled clock", async () => {
  const clock = fakeClock();
  const { repo, session } = await registerAccount({ clock });
  await repo.revokeSession({
    sessionDigest: session.digest,
    reason: "logout",
  });
  expect(await repo.cleanupSessions(10)).toBe(0);
  clock.advance(AUTH_STORAGE_LIMITS.revokedSessionRetentionMs + 1);
  expect(await repo.cleanupSessions(10)).toBe(1);
});

it("does not create or resolve sessions for dev users without handles", async () => {
  const clock = fakeClock();
  const { repo } = await registerAccount({ clock });
  await env.DB.prepare(
    "INSERT INTO users (id, created_at) VALUES ('dev-alice', 1)",
  ).run();
  await expectAuthError(
    () =>
      repo.createSession({
        userId: "dev-alice",
        digest: bytes(32, 0x71),
        csrfDigest: bytes(32, 0x72),
      }),
    { code: "malformed_request" },
  );
  await env.DB.prepare(
    "INSERT INTO sessions (digest, user_id, csrf_digest, created_at, last_seen_at, expires_at, idle_expires_at, recent_auth_at) VALUES (?1, 'dev-alice', ?2, ?3, ?3, ?4, ?5, ?3)",
  )
    .bind(
      bytes(32, 0x73),
      bytes(32, 0x74),
      clock.current(),
      clock.current() + AUTH_STORAGE_LIMITS.sessionAbsoluteLifetimeMs,
      clock.current() + AUTH_STORAGE_LIMITS.sessionIdleLifetimeMs,
    )
    .run();
  expect(await repo.resolveSession(bytes(32, 0x73))).toBeNull();
});

it("rejects a session digest collision without replacing the existing session", async () => {
  const clock = fakeClock();
  const { repo, session, completed } = await registerAccount({ clock });
  await expectAuthError(
    () =>
      repo.createSession({
        userId: accountId("alice0001"),
        digest: session.digest,
        csrfDigest: bytes(32, 0x81),
      }),
    { code: "temporarily_unavailable" },
  );
  const row = await sessionRow(session.digest);
  expect(row.created_at).toBe(completed.session.createdAt);
  expect(row.user_id).toBe(accountId("alice0001"));
});
