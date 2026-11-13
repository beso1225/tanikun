import { applyD1Migrations, env, reset } from "cloudflare:test";
import { expect, it } from "vitest";

import {
  accountHandle,
  bytes,
  challengeId,
  queryAll,
  queryFirst,
  resetAuthDatabase,
  sessionSecrets,
} from "./auth-fixtures.mts";

function migrationsNamed(...names) {
  return names.map((name) => {
    const migration = env.TEST_MIGRATIONS.find((entry) => entry.name === name);
    expect(migration, `missing migration ${name}`).toBeDefined();
    return migration;
  });
}

it("migrates populated Phase 4 users, documents, and changes forward without rewriting rows", async () => {
  await reset();
  await applyD1Migrations(env.DB, migrationsNamed("0001_sync.sql"));
  await env.DB.prepare(
    "INSERT INTO users (id, created_at) VALUES ('dev-alice', 7)",
  ).run();
  await env.DB.prepare(
    "INSERT INTO documents (id, owner_id, last_seq, created_at) VALUES ('11111111-1111-4111-8111-111111111111', 'dev-alice', 2, 8)",
  ).run();
  const insertChange = env.DB.prepare(
    "INSERT INTO changes (document_id, seq, change_id, payload, envelope_version, crypto_alg, key_version, nonce, envelope, created_at) VALUES (?1, ?2, ?3, ?4, 1, 'none', 0, NULL, ?5, ?6)",
  );
  await insertChange
    .bind(
      "11111111-1111-4111-8111-111111111111",
      1,
      "a".repeat(64),
      bytes(2, 0x01),
      bytes(5, 0x10),
      9,
    )
    .run();
  await insertChange
    .bind(
      "11111111-1111-4111-8111-111111111111",
      2,
      "b".repeat(64),
      bytes(3, 0x02),
      bytes(6, 0x20),
      10,
    )
    .run();

  await applyD1Migrations(env.DB, migrationsNamed("0002_auth_storage.sql"));

  expect(
    await queryAll(
      "SELECT id, created_at, handle, display_name FROM users ORDER BY id",
    ),
  ).toEqual([
    { id: "dev-alice", created_at: 7, handle: null, display_name: null },
  ]);
  expect(
    await queryFirst(
      "SELECT id, owner_id, last_seq, created_at FROM documents WHERE owner_id = 'dev-alice'",
    ),
  ).toEqual({
    id: "11111111-1111-4111-8111-111111111111",
    owner_id: "dev-alice",
    last_seq: 2,
    created_at: 8,
  });
  expect(
    await queryAll(
      "SELECT document_id, seq, change_id, hex(payload) AS payload_hex, envelope_version, crypto_alg, key_version, nonce, hex(envelope) AS envelope_hex, created_at FROM changes ORDER BY seq",
    ),
  ).toEqual([
    {
      document_id: "11111111-1111-4111-8111-111111111111",
      seq: 1,
      change_id: "a".repeat(64),
      payload_hex: "0101",
      envelope_version: 1,
      crypto_alg: "none",
      key_version: 0,
      nonce: null,
      envelope_hex: "1010101010",
      created_at: 9,
    },
    {
      document_id: "11111111-1111-4111-8111-111111111111",
      seq: 2,
      change_id: "b".repeat(64),
      payload_hex: "020202",
      envelope_version: 1,
      crypto_alg: "none",
      key_version: 0,
      nonce: null,
      envelope_hex: "202020202020",
      created_at: 10,
    },
  ]);
  expect(
    await queryAll("SELECT name FROM d1_migrations ORDER BY name"),
  ).toEqual([{ name: "0001_sync.sql" }, { name: "0002_auth_storage.sql" }]);

  await expect(
    env.DB.prepare(
      "INSERT INTO documents (id, owner_id, last_seq, created_at) VALUES ('22222222-2222-4222-8222-222222222222', 'dev-alice', 0, 11)",
    ).run(),
  ).rejects.toThrow(/UNIQUE constraint failed: documents\.owner_id/u);

  await applyD1Migrations(env.DB, migrationsNamed("0002_auth_storage.sql"));
  expect(
    await queryAll("SELECT name FROM d1_migrations ORDER BY name"),
  ).toHaveLength(2);
});

async function columns(table) {
  return (await queryAll(`PRAGMA table_info(${table})`)).map((row) => row.name);
}

it("creates digest-only auth tables with the accepted column sets and constraints", async () => {
  await resetAuthDatabase();

  const tables = await queryAll(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('users', 'documents', 'changes', 'credentials', 'challenges', 'sessions') ORDER BY name",
  );
  expect(tables.map((row) => row.name)).toEqual([
    "challenges",
    "changes",
    "credentials",
    "documents",
    "sessions",
    "users",
  ]);

  expect(await columns("users")).toEqual([
    "id",
    "created_at",
    "handle",
    "display_name",
  ]);
  expect(await columns("credentials")).toEqual([
    "credential_id",
    "user_id",
    "public_key",
    "counter",
    "backup_eligible",
    "backup_state",
    "created_at",
    "last_used_at",
  ]);
  expect(await columns("challenges")).toEqual([
    "id",
    "challenge_digest",
    "binding_digest",
    "purpose",
    "account_handle",
    "display_name",
    "user_id",
    "session_digest",
    "created_at",
    "expires_at",
    "consumed_at",
  ]);
  expect(await columns("sessions")).toEqual([
    "digest",
    "user_id",
    "csrf_digest",
    "created_at",
    "last_seen_at",
    "expires_at",
    "idle_expires_at",
    "recent_auth_at",
    "revoked_at",
    "revoke_reason",
  ]);

  const allColumns = [
    ...(await columns("users")),
    ...(await columns("credentials")),
    ...(await columns("challenges")),
    ...(await columns("sessions")),
  ];
  for (const forbidden of [
    "private_key",
    "attestation",
    "attestation_object",
    "aaguid",
    "transports",
    "prf",
    "token",
    "csrf_token",
    "challenge",
    "credential_response",
    "raw_id",
  ]) {
    expect(allColumns).not.toContain(forbidden);
  }

  const indexes = await queryAll(
    "SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND name IN ('users_handle_unique', 'challenges_registration_handle', 'challenges_binding_active') ORDER BY name",
  );
  expect(indexes.map((row) => row.name)).toEqual([
    "challenges_binding_active",
    "challenges_registration_handle",
    "users_handle_unique",
  ]);
  expect(indexes.find((row) => row.name === "users_handle_unique").sql).toMatch(
    /WHERE handle IS NOT NULL/u,
  );

  await env.DB.prepare(
    "INSERT INTO users (id, created_at) VALUES ('dev-a', 0), ('dev-b', 1)",
  ).run();
  const handle = accountHandle(0x11);
  await env.DB.prepare(
    "INSERT INTO users (id, created_at, handle, display_name) VALUES ('acct_a', 2, ?1, 'Alice')",
  )
    .bind(handle)
    .run();
  await expect(
    env.DB.prepare(
      "INSERT INTO users (id, created_at, handle, display_name) VALUES ('acct_b', 3, ?1, 'Other')",
    )
      .bind(handle)
      .run(),
  ).rejects.toThrow(/UNIQUE constraint failed: users\.handle/u);

  await env.DB.prepare(
    "INSERT INTO credentials (credential_id, user_id, public_key, counter, backup_eligible, backup_state, created_at, last_used_at) VALUES ('AQ', 'acct_a', X'01', 0, 0, 0, 0, 0)",
  ).run();
  await expect(
    env.DB.prepare(
      "INSERT INTO credentials (credential_id, user_id, public_key, counter, backup_eligible, backup_state, created_at, last_used_at) VALUES ('Ag', 'acct_a', X'01', 0, 0, 1, 0, 0)",
    ).run(),
  ).rejects.toThrow(/CHECK constraint failed/u);

  await env.DB.prepare(
    "INSERT INTO sessions (digest, user_id, csrf_digest, created_at, last_seen_at, expires_at, idle_expires_at, recent_auth_at) VALUES (?1, 'acct_a', ?2, 0, 0, 43200000, 1800000, 0)",
  )
    .bind(sessionSecrets().digest, sessionSecrets().csrfDigest)
    .run();
  await expect(
    env.DB.prepare(
      "INSERT INTO sessions (digest, user_id, csrf_digest, created_at, last_seen_at, expires_at, idle_expires_at, recent_auth_at) VALUES (?1, 'acct_a', ?2, 0, 0, 1, 1800000, 0)",
    )
      .bind(bytes(32, 0x99), bytes(32, 0x98))
      .run(),
  ).rejects.toThrow(/CHECK constraint failed/u);

  await env.DB.prepare(
    "INSERT INTO challenges (id, challenge_digest, binding_digest, purpose, account_handle, display_name, user_id, session_digest, created_at, expires_at, consumed_at) VALUES (?1, ?2, ?3, 'register', ?4, 'Alice', NULL, NULL, 0, 300000, NULL)",
  )
    .bind(
      challengeId(0x22),
      bytes(32, 0x01),
      bytes(32, 0x02),
      accountHandle(0x11),
    )
    .run();
  await expect(
    env.DB.prepare(
      "INSERT INTO challenges (id, challenge_digest, binding_digest, purpose, account_handle, display_name, user_id, session_digest, created_at, expires_at, consumed_at) VALUES (?1, ?2, ?3, 'register', ?4, NULL, NULL, NULL, 0, 300000, NULL)",
    )
      .bind(
        challengeId(0x23),
        bytes(32, 0x03),
        bytes(32, 0x04),
        accountHandle(0x12),
      )
      .run(),
  ).rejects.toThrow(/CHECK constraint failed/u);
});
