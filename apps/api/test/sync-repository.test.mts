import { applyD1Migrations, env, reset } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";

import fixture from "../../../docs/contracts/sync-v1.json";
import { createChangeRepository } from "../repositories/changes.mjs";

const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

it("migrates an empty D1 database and records a repeatable schema version", async () => {
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('users', 'documents', 'changes') ORDER BY name",
  ).all();
  expect(tables.results.map((row) => row.name)).toEqual([
    "changes",
    "documents",
    "users",
  ]);
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const versions = await env.DB.prepare("SELECT name FROM d1_migrations").all();
  expect(versions.results.map((row) => row.name)).toEqual(["0001_sync.sql"]);
});

it("bootstraps one server-generated document per owner, including concurrent calls", async () => {
  const repository = createChangeRepository(env.DB);
  const documents = await Promise.all(
    Array.from({ length: 8 }, () => repository.bootstrap("dev-alice")),
  );
  expect(documents[0]).toEqual({ document_id: expect.any(String), cursor: 0 });
  expect(new Set(documents.map((document) => document.document_id)).size).toBe(
    1,
  );
  const bob = await repository.bootstrap("dev-bob");
  expect(bob.document_id).not.toBe(documents[0].document_id);
});

async function seeded() {
  const repository = createChangeRepository(env.DB, {
    newDocumentId: () => fixture.document_id,
  });
  await repository.bootstrap("dev-alice");
  return repository;
}

function change(index, documentId = fixture.document_id) {
  const changeId = index.toString(16).padStart(64, "0");
  return {
    ...fixture.envelope,
    document_id: documentId,
    change_id: changeId,
    aad: {
      ...fixture.envelope.aad,
      document_id: documentId,
      change_id: changeId,
    },
  };
}

it("shares exact append, duplicate, conflict, and pull results with the golden fixture", async () => {
  const repository = await seeded();
  for (const name of ["append", "duplicate"]) {
    const row = fixture.cases.find((candidate) => candidate.name === name);
    expect(
      await repository.append(
        "dev-alice",
        fixture.document_id,
        row.request.body.changes,
      ),
    ).toEqual(row.response.body);
  }
  for (const name of ["pull", "empty-page"]) {
    const row = fixture.cases.find((candidate) => candidate.name === name);
    const after = name === "pull" ? 0 : 1;
    expect(
      await repository.pull("dev-alice", fixture.document_id, { after }),
    ).toEqual(row.response.body);
  }
  const conflict = fixture.cases.find(
    (candidate) => candidate.name === "conflict-rolls-back-new-row",
  );
  await expect(
    repository.append(
      "dev-alice",
      fixture.document_id,
      conflict.request.body.changes,
    ),
  ).rejects.toMatchObject({ code: "change_conflict" });
  expect(
    await repository.lookupChange(
      "dev-alice",
      fixture.document_id,
      fixture.second_envelope.change_id,
    ),
  ).toBeNull();
  expect(await repository.bootstrap("dev-alice")).toEqual({
    document_id: fixture.document_id,
    cursor: 1,
  });
});

it("assigns distinct new changes in request order and preserves mixed duplicate acknowledgements", async () => {
  const repository = await seeded();
  const [a, b, c] = [change(1), change(2), change(3)];
  expect(
    (await repository.append("dev-alice", fixture.document_id, [b, a]))
      .accepted,
  ).toEqual([
    { change_id: b.change_id, server_sequence: 1 },
    { change_id: a.change_id, server_sequence: 2 },
  ]);
  expect(
    (await repository.append("dev-alice", fixture.document_id, [a, c, b, c]))
      .accepted,
  ).toEqual([
    { change_id: a.change_id, server_sequence: 2 },
    { change_id: c.change_id, server_sequence: 3 },
    { change_id: b.change_id, server_sequence: 1 },
    { change_id: c.change_id, server_sequence: 3 },
  ]);
});

it("concurrent append transactions allocate contiguous per-document sequences", async () => {
  const repository = await seeded();
  const batches = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      repository.append("dev-alice", fixture.document_id, [
        change(index * 2 + 1),
        change(index * 2 + 2),
      ]),
    ),
  );
  expect(
    batches
      .flatMap((batch) =>
        batch.accepted.map((accepted) => accepted.server_sequence),
      )
      .toSorted((a, b) => a - b),
  ).toEqual(Array.from({ length: 16 }, (_, index) => index + 1));
  for (const batch of batches)
    expect(batch.accepted[1].server_sequence).toBe(
      batch.accepted[0].server_sequence + 1,
    );
  const page = await repository.pull("dev-alice", fixture.document_id);
  expect(page.cursor).toBe(16);
  expect(page.changes.map((entry) => entry.server_sequence)).toEqual(
    Array.from({ length: 16 }, (_, index) => index + 1),
  );
});

it("rolls back a later SQL failure and consumes no sequence before a retry", async () => {
  const repository = await seeded();
  const [a, b] = [change(1), change(2)];
  await env.DB.exec(
    `CREATE TRIGGER reject_second BEFORE INSERT ON changes WHEN NEW.change_id = '${b.change_id}' BEGIN SELECT RAISE(ABORT, 'synthetic_failure'); END`,
  );
  await expect(
    repository.append("dev-alice", fixture.document_id, [a, b]),
  ).rejects.toMatchObject({
    code: "temporarily_unavailable",
    message: "temporarily_unavailable",
  });
  expect(
    await repository.lookupChange(
      "dev-alice",
      fixture.document_id,
      a.change_id,
    ),
  ).toBeNull();
  expect((await repository.pull("dev-alice", fixture.document_id)).cursor).toBe(
    0,
  );
  await env.DB.exec("DROP TRIGGER reject_second");
  expect(
    (
      await repository.append("dev-alice", fixture.document_id, [a, b])
    ).accepted.map((entry) => entry.server_sequence),
  ).toEqual([1, 2]);
});

it("conflicting envelopes inside one batch roll back all preceding new changes", async () => {
  const repository = await seeded();
  const a = change(1);
  await expect(
    repository.append("dev-alice", fixture.document_id, [
      a,
      { ...a, payload: "BQY=" },
    ]),
  ).rejects.toMatchObject({ code: "change_conflict" });
  expect((await repository.pull("dev-alice", fixture.document_id)).cursor).toBe(
    0,
  );
});

it("keeps foreign and missing resources indistinguishable and scopes every operation", async () => {
  const repository = await seeded();
  const bobRepository = createChangeRepository(env.DB, {
    newDocumentId: () => fixture.foreign_document_id,
  });
  await bobRepository.bootstrap("dev-bob");
  for (const id of [
    fixture.foreign_document_id,
    "33333333-3333-4333-8333-333333333333",
  ]) {
    await expect(repository.append("dev-alice", id, [])).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      repository.pull("dev-alice", id, { after: -1 }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      repository.lookupChange("dev-alice", id, change(1).change_id),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      repository.findOwnedDocument("dev-alice", id),
    ).rejects.toMatchObject({ code: "not_found" });
  }
  const bobChange = change(1, fixture.foreign_document_id);
  expect(
    (
      await repository.append("dev-bob", fixture.foreign_document_id, [
        bobChange,
      ])
    ).cursor,
  ).toBe(1);
  expect(
    (await repository.pull("dev-bob", fixture.foreign_document_id)).changes[0],
  ).toEqual({ ...bobChange, server_sequence: 1 });
  expect((await repository.pull("dev-alice", fixture.document_id)).cursor).toBe(
    0,
  );
});

it("rejects gaps for pull, new append, and duplicate-only append without a write", async () => {
  const repository = await seeded();
  await repository.append("dev-alice", fixture.document_id, [
    change(1),
    change(2),
  ]);
  await env.DB.prepare("DELETE FROM changes WHERE document_id = ?1 AND seq = 1")
    .bind(fixture.document_id)
    .run();
  for (const changes of [[change(3)], [change(2)]]) {
    await expect(
      repository.append("dev-alice", fixture.document_id, changes),
    ).rejects.toMatchObject({ code: "log_gap", cursor: 2 });
  }
  await expect(
    repository.pull("dev-alice", fixture.document_id),
  ).rejects.toMatchObject({ code: "log_gap", cursor: 2 });
  expect(
    await repository.lookupChange(
      "dev-alice",
      fixture.document_id,
      change(3).change_id,
    ),
  ).toBeNull();
});

it("pages in sequence order, handles empty pages and cursor rollback, and remains stable after another append", async () => {
  const repository = await seeded();
  await repository.append("dev-alice", fixture.document_id, [
    change(3),
    change(1),
    change(2),
  ]);
  const first = await repository.pull("dev-alice", fixture.document_id, {
    limit: 2,
  });
  expect(first.changes.map((entry) => entry.server_sequence)).toEqual([1, 2]);
  expect(first).toMatchObject({ next_cursor: 2, cursor: 3, has_more: true });
  await repository.append("dev-alice", fixture.document_id, [change(4)]);
  const second = await repository.pull("dev-alice", fixture.document_id, {
    after: first.next_cursor,
    limit: 2,
  });
  expect(second.changes.map((entry) => entry.server_sequence)).toEqual([3, 4]);
  expect(second).toMatchObject({ next_cursor: 4, cursor: 4, has_more: false });
  expect(
    await repository.pull("dev-alice", fixture.document_id, { after: 4 }),
  ).toMatchObject({ changes: [], next_cursor: 4, has_more: false });
  await expect(
    repository.pull("dev-alice", fixture.document_id, { after: 5 }),
  ).rejects.toMatchObject({ code: "cursor_ahead", cursor: 4 });
});

it("round-trips opaque AES envelopes and conflicts on metadata changes with the same ID", async () => {
  const repository = await seeded();
  await repository.append("dev-alice", fixture.document_id, [
    fixture.encrypted_envelope,
  ]);
  expect(
    (await repository.pull("dev-alice", fixture.document_id)).changes[0],
  ).toEqual({ ...fixture.encrypted_envelope, server_sequence: 1 });
  await expect(
    repository.append("dev-alice", fixture.document_id, [fixture.envelope]),
  ).rejects.toMatchObject({ code: "change_conflict" });
});

it("distinguishes counter CHECK exhaustion from the NOT NULL gap guard and rolls back", async () => {
  const repository = await seeded();
  // Reach the arithmetic boundary within the transaction without manufacturing
  // quadrillions of preceding log rows. A later update must hit the real CHECK.
  await env.DB.exec(
    "CREATE TRIGGER exhaust_counter AFTER INSERT ON changes BEGIN UPDATE documents SET last_seq = 9007199254740991 WHERE id = NEW.document_id; END",
  );
  await expect(
    repository.append("dev-alice", fixture.document_id, [change(1), change(2)]),
  ).rejects.toMatchObject({ code: "sequence_exhausted" });
  expect((await repository.pull("dev-alice", fixture.document_id)).cursor).toBe(
    0,
  );
});

it("returns the largest byte-capped prefix and resumes without skipping rows", async () => {
  const repository = await seeded();
  const payload = btoa("x".repeat(256 * 1024));
  const changes = Array.from({ length: 25 }, (_, index) => ({
    ...change(index + 1),
    payload,
  }));
  for (let index = 0; index < changes.length; index += 10) {
    await repository.append(
      "dev-alice",
      fixture.document_id,
      changes.slice(index, index + 10),
    );
  }
  const page = await repository.pull("dev-alice", fixture.document_id, {
    limit: 100,
  });
  expect(bytes(page)).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(page).toMatchObject({ has_more: true, cursor: 25 });
  const next = await repository.lookupChange(
    "dev-alice",
    fixture.document_id,
    change(page.next_cursor + 1).change_id,
  );
  expect(
    bytes({
      ...page,
      changes: [...page.changes, next],
      next_cursor: next.server_sequence,
    }),
  ).toBeGreaterThan(8 * 1024 * 1024);
  const rest = await repository.pull("dev-alice", fixture.document_id, {
    after: page.next_cursor,
  });
  expect(
    [...page.changes, ...rest.changes].map((entry) => entry.server_sequence),
  ).toEqual(Array.from({ length: 25 }, (_, index) => index + 1));
  expect(rest.has_more).toBe(false);
});

it("rechecks ownership inside the atomic batch if ownership changes after lookup", async () => {
  await seeded();
  await env.DB.prepare(
    "INSERT INTO users (id, created_at) VALUES ('dev-bob', 0)",
  ).run();
  const database = {
    prepare: (sql) => env.DB.prepare(sql),
    batch: async (statements) => {
      await env.DB.prepare(
        "UPDATE documents SET owner_id = 'dev-bob' WHERE id = ?1",
      )
        .bind(fixture.document_id)
        .run();
      return env.DB.batch(statements);
    },
  };
  const repository = createChangeRepository(database);
  await expect(
    repository.append("dev-alice", fixture.document_id, [change(1)]),
  ).rejects.toMatchObject({ code: "not_found" });
  expect(
    (await env.DB.prepare("SELECT COUNT(*) AS count FROM changes").first())
      .count,
  ).toBe(0);
});

it("bounds the payload-sizing query to the requested page rather than the remaining history", async () => {
  const repository = await seeded();
  for (let start = 1; start <= 256; start += 20) {
    const entries = Array.from(
      { length: Math.min(20, 257 - start) },
      (_, index) => change(start + index),
    );
    await repository.append("dev-alice", fixture.document_id, entries);
  }
  let payloadRowsRead = 0;
  const measured = createChangeRepository({
    prepare: (sql) => env.DB.prepare(sql),
    batch: async (statements) => {
      const results = await env.DB.batch(statements);
      for (const result of results) {
        if (result.results.some((row) => Object.hasOwn(row, "payload"))) {
          payloadRowsRead += result.meta.rows_read;
        }
      }
      return results;
    },
  });
  for (const after of [0, 200]) {
    payloadRowsRead = 0;
    const page = await measured.pull("dev-alice", fixture.document_id, {
      after,
      limit: 2,
    });
    expect(page).toMatchObject({
      next_cursor: after + 2,
      has_more: true,
      cursor: 256,
    });
    // Allow index/window bookkeeping, but not sizing all 256 payloads.
    // The separate full-log integrity query is not part of this metric.
    expect(payloadRowsRead).toBeGreaterThan(0);
    expect(payloadRowsRead).toBeLessThanOrEqual(64);
  }
});
