import assert from "node:assert/strict";

import { applyD1Migrations, env, reset, SELF } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";

import fixture from "../../../docs/contracts/sync-v1.json";
import { validateAppend } from "../../../packages/sync-contract/contract.mjs";
import worker from "../bridges/worker.mjs";

const apiOrigin = "http://127.0.0.1:8787";
const aliceId = "dev-alice";
const bobId = "dev-bob";

const skipped = new Set([
  // These need a failing database or client-only state.
  "rollback-on-bootstrap",
  "payload-decode-failure",
  // These deliberately change DEV_AUTH/APP_ENV and are covered by dedicated
  // gate tests instead of the fixed SELF environment.
  "production-rejected",
  "dev-auth-disabled",
  "invalid-mapping",
  "append-production-rejected",
  "append-dev-auth-disabled",
  "pull-production-rejected",
  "pull-dev-auth-disabled",
  // The streamed-body path is covered by the helper unit test without sending
  // a 4 MiB fixture body through every run.
  "oversized-streamed-body",
]);

const serverCases = fixture.cases.filter(
  (testCase) => !skipped.has(testCase.name),
);

async function seedUser(id) {
  await env.DB.prepare("INSERT INTO users (id, created_at) VALUES (?1, 0)")
    .bind(id)
    .run();
}

async function seedDocument(ownerId, documentId, cursor) {
  await seedUser(ownerId);
  await env.DB.prepare(
    "INSERT INTO documents (id, owner_id, last_seq, created_at) VALUES (?1, ?2, ?3, 0)",
  )
    .bind(documentId, ownerId, cursor)
    .run();
}

async function seedChange(documentId, sequence, envelope) {
  const validated = validateAppend([envelope], documentId)[0];
  await env.DB.prepare(
    `INSERT INTO changes
      (document_id, seq, change_id, payload, envelope_version, crypto_alg,
      key_version, nonce, envelope, created_at)
      VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, 0)`,
  )
    .bind(
      documentId,
      sequence,
      envelope.change_id,
      validated.payload,
      envelope.crypto_algorithm,
      envelope.key_version,
      validated.nonce,
      validated.canonical,
    )
    .run();
}

async function applySetup(name) {
  if (name === "empty") return;
  if (name === "empty-document") {
    await seedDocument(aliceId, fixture.document_id, 0);
    return;
  }
  if (name === "one-change" || name === "one-change-local-high-water-two") {
    await seedDocument(aliceId, fixture.document_id, 1);
    await seedChange(fixture.document_id, 1, fixture.envelope);
    return;
  }
  if (name === "two-changes") {
    await seedDocument(aliceId, fixture.document_id, 2);
    await seedChange(fixture.document_id, 1, fixture.envelope);
    await seedChange(fixture.document_id, 2, fixture.second_envelope);
    return;
  }
  if (name === "foreign-document" || name === "two-owners-empty") {
    await seedDocument(aliceId, fixture.document_id, 0);
    await seedDocument(bobId, fixture.foreign_document_id, 0);
    return;
  }
  if (name === "gap") {
    await seedDocument(aliceId, fixture.document_id, 2);
    await seedChange(fixture.document_id, 2, fixture.second_envelope);
    return;
  }
  throw new Error(`Unsupported fixture setup: ${name}`);
}

function base64OfRepeatedByte(byte, length) {
  const bytes = new Uint8Array(length).fill(byte);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function bodyFor(testCase) {
  const request = testCase.request;
  if (request.raw_body !== undefined) return request.raw_body;
  if (request.body !== undefined) return JSON.stringify(request.body);
  if (request.body_generator?.kind === "replace_payload_with_repeated_byte") {
    const body = structuredClone(request.body_generator.body);
    body.changes[0].payload = base64OfRepeatedByte(
      request.body_generator.byte,
      request.body_generator.decoded_length,
    );
    return JSON.stringify(body);
  }
  if (request.body_generator?.kind === "pad_json_with_spaces") {
    const body = JSON.stringify(request.body_generator.body);
    const length = new TextEncoder().encode(body).byteLength;
    return body + " ".repeat(request.body_generator.utf8_length - length);
  }
  return undefined;
}

function requestFor(testCase) {
  const request = testCase.request;
  const body = bodyFor(testCase);
  return new Request(`${apiOrigin}${request.path}`, {
    method: request.method,
    headers: request.headers,
    ...(body === undefined ? {} : { body }),
  });
}

async function rowCounts() {
  const [users, documents, changes] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM users").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM documents").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM changes").first(),
  ]);
  return {
    users: users.count,
    documents: documents.count,
    changes: changes.count,
  };
}

function documentIdFromPath(path) {
  return /^\/api\/v1\/sync\/documents\/([^/]+)\/changes/.exec(path)?.[1];
}

async function documentLastSequence(documentId) {
  return env.DB.prepare("SELECT last_seq FROM documents WHERE id = ?1")
    .bind(documentId)
    .first();
}

async function assertExpectedWrites(testCase, documentId, before, after) {
  const expectation = testCase.expect ?? {};
  if (expectation.writes === false) {
    assert.deepEqual(after, before);
  } else if (expectation.writes === true) {
    assert.ok(
      after.users + after.documents + after.changes >
        before.users + before.documents + before.changes,
    );
  }
  if (expectation.documents_created !== undefined) {
    assert.equal(
      after.documents - before.documents,
      expectation.documents_created,
    );
  }
  if (expectation.last_sequence !== undefined) {
    const document = await documentLastSequence(documentId);
    assert.equal(document.last_seq, expectation.last_sequence);
  }
  for (const changeId of expectation.absent_change_ids ?? []) {
    const change = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM changes WHERE document_id = ?1 AND change_id = ?2",
    )
      .bind(documentId, changeId)
      .first();
    assert.equal(change.count, 0);
  }
}

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

it.each(serverCases)(
  "matches the golden fixture case $name",
  async (testCase) => {
    await applySetup(testCase.setup);
    const before = await rowCounts();
    const documentId = documentIdFromPath(testCase.request.path);
    const request = requestFor(testCase);
    const response =
      testCase.name === "bootstrap-new"
        ? await worker.fetch(request, {
            DB: env.DB,
            APP_ENV: "local",
            DEV_AUTH: "true",
            DEV_AUTH_IDENTITIES: JSON.stringify(
              fixture.environment.DEV_AUTH_IDENTITIES,
            ),
            TEST_NEW_DOCUMENT_ID: fixture.document_id,
          })
        : await SELF.fetch(request);
    const after = await rowCounts();
    const expected = testCase.response;

    expect(response.status).toBe(expected.status);
    for (const [name, value] of Object.entries(expected.headers ?? {})) {
      expect(response.headers.get(name)).toBe(value);
    }
    for (const name of expected.forbidden_headers ?? []) {
      expect(response.headers.get(name)).toBeNull();
    }
    for (const name of fixture.response_assertions
      .forbidden_headers_all_responses) {
      expect(response.headers.get(name)).toBeNull();
    }

    const actualBody =
      expected.body === null ? await response.text() : await response.json();
    expect(actualBody).toEqual(expected.body === null ? "" : expected.body);
    await assertExpectedWrites(testCase, documentId, before, after);
  },
);
