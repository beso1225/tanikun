import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertD1ChangeRows, waitFor } from "./sync-convergence-helpers.mjs";
import {
  SYNC_WEB_ORIGIN,
  SyncHarness,
  identityToken,
} from "./sync-harness.mjs";
import {
  postAndLoseResponse,
  proxyResponseText,
  sqlQuote,
  startResponseDroppingProxy,
} from "./sync-http-faults.mjs";

const fixture = JSON.parse(
  await readFile(
    new URL("../../docs/contracts/sync-v1.json", import.meta.url),
    "utf8",
  ),
);
const missingDocumentId = "00000000-0000-4000-8000-000000000099";

function envelopeFor(documentId, { changeId, payload } = {}) {
  const change_id = changeId ?? fixture.envelope.change_id;
  return {
    ...fixture.envelope,
    document_id: documentId,
    change_id,
    aad: {
      ...fixture.envelope.aad,
      document_id: documentId,
      change_id,
    },
    ...(payload === undefined ? {} : { payload }),
  };
}

function changesPath(documentId, query = "") {
  return `/api/v1/sync/documents/${documentId}/changes${query}`;
}

async function appendEnvelope(
  harness,
  documentId,
  envelope,
  identity = "alice",
) {
  return harness.request(identity, changesPath(documentId), {
    method: "POST",
    body: { changes: [envelope] },
  });
}

test(
  "identical duplicate append has one effect and a conflicting hash rolls back",
  { timeout: 120_000 },
  async (t) => {
    const harness = new SyncHarness({ serveWeb: false });
    t.after(() => harness.close());
    await harness.start();

    const document = await harness.bootstrap("alice");
    const envelope = envelopeFor(document.document_id);
    const first = await appendEnvelope(harness, document.document_id, envelope);
    assert.equal(first.status, 200);
    assert.deepEqual(first.json(), {
      document_id: document.document_id,
      accepted: [{ change_id: envelope.change_id, server_sequence: 1 }],
      cursor: 1,
    });
    const duplicate = await harness.append("alice", document.document_id, [
      envelope,
    ]);
    assert.deepEqual(duplicate, first.json());
    await assertD1ChangeRows(harness, [
      { seq: 1, change_id: envelope.change_id },
    ]);

    const fresh = envelopeFor(document.document_id, {
      changeId: "c".repeat(64),
    });
    const conflicting = envelopeFor(document.document_id, {
      payload: Buffer.from("different opaque bytes").toString("base64"),
    });
    const conflict = await harness.request(
      "alice",
      changesPath(document.document_id),
      { method: "POST", body: { changes: [fresh, conflicting] } },
    );
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.json(), { error: { code: "change_conflict" } });
    assert.equal(conflict.text.includes(fresh.payload), false);
    await assertD1ChangeRows(harness, [
      { seq: 1, change_id: envelope.change_id },
    ]);
    const documentRow = (
      await harness.d1Query(
        `SELECT last_seq FROM documents WHERE id = ${sqlQuote(document.document_id)}`,
      )
    )[0];
    assert.equal(Number(documentRow.last_seq), 1);
  },
);

test(
  "a response lost after the real commit retries to one D1 row",
  { timeout: 120_000 },
  async (t) => {
    const harness = new SyncHarness({ serveWeb: false });
    t.after(() => harness.close());
    await harness.start();
    const proxy = await startResponseDroppingProxy(harness.apiOrigin);
    t.after(async () => {
      await proxy.close();
      await harness.close();
    });

    const document = await harness.bootstrap("alice");
    const envelope = envelopeFor(document.document_id);
    await postAndLoseResponse({
      proxyOrigin: proxy.origin,
      origin: SYNC_WEB_ORIGIN,
      token: identityToken("alice"),
      documentId: document.document_id,
      envelope,
    });
    await waitFor(
      async () =>
        Number(
          (await harness.d1Query("SELECT COUNT(*) AS count FROM changes"))[0]
            .count,
        ) === 1,
      "server committed the request whose response was lost",
    );
    assert.equal(proxy.records.length, 1);
    assert.equal(proxy.records[0].status, 200);
    assert.deepEqual(JSON.parse(proxyResponseText(proxy.records[0])), {
      document_id: document.document_id,
      accepted: [{ change_id: envelope.change_id, server_sequence: 1 }],
      cursor: 1,
    });

    const retry = await harness.append("alice", document.document_id, [
      envelope,
    ]);
    assert.deepEqual(retry.accepted, [
      { change_id: envelope.change_id, server_sequence: 1 },
    ]);
    assert.equal(retry.cursor, 1);
    await assertD1ChangeRows(harness, [
      { seq: 1, change_id: envelope.change_id },
    ]);
  },
);

test(
  "an actual D1 failure returns 503, consumes no sequence, and retries",
  { timeout: 120_000 },
  async (t) => {
    const harness = new SyncHarness({ serveWeb: false });
    t.after(() => harness.close());
    await harness.start();

    const document = await harness.bootstrap("alice");
    const envelope = envelopeFor(document.document_id, {
      changeId: "d".repeat(64),
    });
    await harness.d1("ALTER TABLE changes RENAME TO changes_unavailable_145");
    try {
      const failed = await appendEnvelope(
        harness,
        document.document_id,
        envelope,
      );
      assert.equal(failed.status, 503);
      assert.deepEqual(failed.json(), {
        error: { code: "temporarily_unavailable" },
      });
      const documentRow = (
        await harness.d1Query(
          `SELECT last_seq FROM documents WHERE id = ${sqlQuote(document.document_id)}`,
        )
      )[0];
      assert.equal(Number(documentRow.last_seq), 0);
      const unavailable = await harness.d1Query(
        "SELECT COUNT(*) AS count FROM changes_unavailable_145",
      );
      assert.equal(Number(unavailable[0].count), 0);
    } finally {
      await harness.d1("ALTER TABLE changes_unavailable_145 RENAME TO changes");
    }

    const recovered = await harness.append("alice", document.document_id, [
      envelope,
    ]);
    assert.deepEqual(recovered.accepted, [
      { change_id: envelope.change_id, server_sequence: 1 },
    ]);
    await assertD1ChangeRows(harness, [
      { seq: 1, change_id: envelope.change_id },
    ]);
  },
);

test(
  "a real D1 gap and counter rollback fail closed and recover after repair",
  { timeout: 120_000 },
  async (t) => {
    const harness = new SyncHarness({ serveWeb: false });
    t.after(() => harness.close());
    await harness.start();

    const document = await harness.bootstrap("alice");
    const first = envelopeFor(document.document_id, {
      changeId: "e".repeat(64),
    });
    const second = envelopeFor(document.document_id, {
      changeId: "f".repeat(64),
    });
    await harness.append("alice", document.document_id, [first]);
    await harness.append("alice", document.document_id, [second]);
    const quotedId = sqlQuote(document.document_id);
    await harness.d1(
      `CREATE TABLE changes_backup_145 AS SELECT * FROM changes WHERE document_id = ${quotedId}`,
    );
    await harness.d1(
      `DELETE FROM changes WHERE document_id = ${quotedId} AND seq = 1`,
    );
    const gap = await harness.request(
      "alice",
      changesPath(document.document_id, "?after=0&limit=100"),
    );
    assert.equal(gap.status, 409);
    assert.deepEqual(gap.json(), { error: { code: "log_gap" }, cursor: 2 });

    await harness.d1(`DELETE FROM changes WHERE document_id = ${quotedId}`);
    await harness.d1("INSERT INTO changes SELECT * FROM changes_backup_145");
    await harness.d1("DROP TABLE changes_backup_145");
    const restored = await harness.pull("alice", document.document_id);
    assert.equal(restored.changes.length, 2);
    assert.deepEqual(
      restored.changes.map((change) => change.server_sequence),
      [1, 2],
    );

    await harness.d1(
      `UPDATE documents SET last_seq = 0 WHERE id = ${quotedId}`,
    );
    const rollback = await harness.request(
      "alice",
      changesPath(document.document_id, "?after=2&limit=100"),
    );
    assert.equal(rollback.status, 409);
    assert.deepEqual(rollback.json(), {
      error: { code: "log_gap" },
      cursor: 0,
    });
    await harness.d1(
      `UPDATE documents SET last_seq = 2 WHERE id = ${quotedId}`,
    );
    const recovered = await harness.request(
      "alice",
      changesPath(document.document_id, "?after=2&limit=100"),
    );
    assert.equal(recovered.status, 200);
    assert.equal(recovered.json().cursor, 2);
    await assertD1ChangeRows(harness, [
      { seq: 1, change_id: first.change_id },
      { seq: 2, change_id: second.change_id },
    ]);
  },
);

test(
  "a second identity cannot read or write a foreign document or tell it from missing",
  { timeout: 120_000 },
  async (t) => {
    const harness = new SyncHarness({ serveWeb: false });
    t.after(() => harness.close());
    await harness.start();

    const aliceDocument = await harness.bootstrap("alice");
    const aliceEnvelope = envelopeFor(aliceDocument.document_id);
    await harness.append("alice", aliceDocument.document_id, [aliceEnvelope]);
    const bobDocument = await harness.bootstrap("bob");
    assert.notEqual(bobDocument.document_id, aliceDocument.document_id);

    const foreignRead = await harness.request(
      "bob",
      changesPath(aliceDocument.document_id, "?after=0&limit=100"),
    );
    const missingRead = await harness.request(
      "bob",
      changesPath(missingDocumentId, "?after=0&limit=100"),
    );
    assert.equal(foreignRead.status, 404);
    assert.equal(missingRead.status, 404);
    assert.deepEqual(foreignRead.json(), { error: { code: "not_found" } });
    assert.equal(foreignRead.text, missingRead.text);
    for (const header of [
      "content-type",
      "access-control-allow-origin",
      "vary",
    ]) {
      assert.equal(
        foreignRead.headers[header],
        missingRead.headers[header],
        `foreign and missing reads share ${header}`,
      );
    }

    const foreignWrite = await appendEnvelope(
      harness,
      aliceDocument.document_id,
      envelopeFor(aliceDocument.document_id, {
        changeId: "1".repeat(64),
      }),
      "bob",
    );
    const missingWrite = await appendEnvelope(
      harness,
      missingDocumentId,
      envelopeFor(missingDocumentId, { changeId: "1".repeat(64) }),
      "bob",
    );
    assert.equal(foreignWrite.status, 404);
    assert.equal(missingWrite.status, 404);
    assert.equal(foreignWrite.text, missingWrite.text);
    assert.deepEqual(foreignWrite.json(), { error: { code: "not_found" } });

    await assertD1ChangeRows(harness, [
      { seq: 1, change_id: aliceEnvelope.change_id },
    ]);
    const documents = await harness.d1Query(
      "SELECT id, owner_id, last_seq FROM documents ORDER BY id",
    );
    assert.equal(documents.length, 2);
    const bobRow = documents.find((row) => row.id === bobDocument.document_id);
    assert.equal(Number(bobRow.last_seq), 0);
    const bobChanges = await harness.d1Query(
      `SELECT COUNT(*) AS count FROM changes WHERE document_id = ${sqlQuote(bobDocument.document_id)}`,
    );
    assert.equal(Number(bobChanges[0].count), 0);
  },
);
