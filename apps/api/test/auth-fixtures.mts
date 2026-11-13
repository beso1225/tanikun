import { applyD1Migrations, env, reset } from "cloudflare:test";
import { expect } from "vitest";

import {
  AUTH_STORAGE_LIMITS,
  AuthStorageError,
} from "../repositories/auth-data.mjs";
import { createAuthRepository } from "../repositories/auth.mjs";

export { AUTH_STORAGE_LIMITS };

export async function resetAuthDatabase() {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
}

export function fakeClock(start = 1_760_000_000_000) {
  let value = start;
  return {
    now: () => value,
    advance(milliseconds) {
      value += milliseconds;
      return value;
    },
    set(milliseconds) {
      value = milliseconds;
      return value;
    },
    current: () => value,
  };
}

export function bytes(length, fill = 0) {
  return new Uint8Array(length).fill(fill);
}

export function base64Url(value) {
  const binary = Array.from(value, (byte) => String.fromCharCode(byte)).join(
    "",
  );
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

export function challengeId(fill = 1) {
  return base64Url(bytes(16, fill));
}

export function accountHandle(fill = 1) {
  return base64Url(bytes(32, fill));
}

export function credentialId(fill = 1) {
  return base64Url(bytes(1, fill));
}

export function accountId(name = "alice0001") {
  return `acct_${name}`;
}

export function credential({
  idFill = 1,
  publicKey = bytes(4, 0xa1),
  counter = 0,
  backupEligible = false,
  backupState = false,
} = {}) {
  return {
    id: credentialId(idFill),
    publicKey,
    counter,
    backupEligible,
    backupState,
  };
}

export function sessionSecrets(fill = 0x41) {
  return {
    digest: bytes(32, fill),
    csrfDigest: bytes(32, fill + 1),
  };
}

export async function queryAll(sql, ...bindings) {
  const statement = env.DB.prepare(sql);
  const result = await (
    bindings.length > 0 ? statement.bind(...bindings) : statement
  ).all();
  return result.results;
}

export async function queryFirst(sql, ...bindings) {
  const statement = env.DB.prepare(sql);
  return bindings.length > 0
    ? statement.bind(...bindings).first()
    : statement.first();
}

export async function countRows(table) {
  return (await queryFirst(`SELECT COUNT(*) AS count FROM ${table}`)).count;
}

export function makeRepository({
  clock,
  id = "alice0001",
  handle = accountHandle(0x11),
  documentId = "11111111-1111-4111-8111-111111111111",
  challenge = challengeId(0x22),
} = {}) {
  return createAuthRepository(env.DB, {
    now: clock.now,
    newAccountId: () => accountId(id),
    newAccountHandle: () => handle,
    newDocumentId: () => documentId,
    newChallengeId: () => challenge,
  });
}

export async function beginRegistration({
  clock,
  repository,
  bindingDigest = bytes(32, 0x31),
  challengeDigest = bytes(32, 0x32),
  displayName = "Alice Example",
  credential: credentialValue = credential(),
  session = sessionSecrets(),
} = {}) {
  const repo = repository ?? makeRepository({ clock });
  const issued = await repo.issueRegistrationChallenge({
    challengeDigest,
    bindingDigest,
    displayName,
  });
  const consumed = await repo.consumeChallenge({
    challengeId: issued.challengeId,
    challengeDigest,
    bindingDigest,
    purpose: "register",
  });
  return {
    repo,
    issued,
    consumed,
    bindingDigest,
    challengeDigest,
    credential: credentialValue,
    session,
  };
}

export async function registerAccount(options = {}) {
  const begun = await beginRegistration(options);
  const completed = await begun.repo.completeRegistration({
    challengeId: begun.issued.challengeId,
    bindingDigest: begun.bindingDigest,
    credential: begun.credential,
    session: begun.session,
  });
  return { ...begun, completed };
}

export async function captureAuthError(operation) {
  return operation().then(
    () => {
      throw new Error("Expected the operation to fail");
    },
    (reason) => reason,
  );
}

export async function expectAuthError(operation, expected) {
  const error = await captureAuthError(operation);
  expect(error).toBeInstanceOf(AuthStorageError);
  expect(error).toMatchObject(expected);
  expect(error.message).toBe(expected.code);
  expect(error.cause).toBeUndefined();
  return error;
}
