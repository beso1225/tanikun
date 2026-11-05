import assert from "node:assert/strict";
import test from "node:test";

import { waitForPersistence } from "./planner-harness.mjs";
import {
  armPlannerPutAbort,
  assertConverged,
  canonicalSource,
  installPlannerPutAbort,
  readD1State,
  readPlannerState,
  readSyncState,
  waitFor,
  waitForPlannerSource,
} from "./sync-convergence-helpers.mjs";
import { SyncHarness, waitForSync } from "./sync-harness.mjs";
import { sqlQuote } from "./sync-http-faults.mjs";

const apiGlob = "**/api/v1/**";
const changesGlob = "**/api/v1/sync/documents/*/changes*";
async function installApiGate(page) {
  const gate = { offline: false };
  await page.route(apiGlob, async (route) => {
    if (gate.offline) await route.abort("failed");
    else await route.continue();
  });
  return gate;
}

async function kickSync(page) {
  const before = await page.evaluate(
    () => globalThis.tanikunSyncShell.history.length,
  );
  await page.evaluate(() => globalThis.tanikunSyncShell.sync());
  await page.waitForFunction(
    (length) => globalThis.tanikunSyncShell.history.length > length,
    before,
    { timeout: 10_000 },
  );
}

async function lastSyncStatus(page) {
  return page.evaluate(() => globalThis.tanikunSyncShell.history.at(-1));
}

async function addOffering(page, offeringId) {
  await page.locator("#open-catalogue-picker").click();
  await page.locator(`#add-offering-${offeringId}`).click();
  await page.locator("#close-picker").click();
}

async function addCustomCourse(page, name) {
  await page.locator("#open-catalogue-picker").click();
  await page.locator("#open-custom-course").click();
  await page.locator("#custom-name").fill(name);
  await page.locator("#custom-category").selectOption("lab");
  await page.locator("#custom-submit").click();
  await page.locator("#close-picker").click();
}

async function withPair(harness, name, drive) {
  await harness.runJourneyGroup(
    name,
    [
      { label: "alice", identity: "alice" },
      {
        label: "bob",
        identity: "alice",
        beforeGoto: async (page) => {
          await page.route(apiGlob, (route) => route.abort("failed"));
        },
      },
    ],
    async ([alicePage, bobPage], [aliceErrors, bobErrors]) => {
      await waitForPersistence(alicePage);
      await waitForSync(alicePage, "同期済み", 30_000);
      await waitForPersistence(bobPage);
      await waitForSync(bobPage, "オフライン", 30_000);
      const document = await harness.bootstrap("alice");
      await bobPage.evaluate(() => globalThis.tanikunStorage.discard());
      await bobPage.unroute(apiGlob);
      await bobPage.locator("#sync-retry").click();
      await waitForSync(bobPage, "同期済み", 30_000);
      await bobPage.reload();
      await waitForPersistence(bobPage);
      await waitForSync(bobPage, "同期済み", 30_000);
      const gate = await installApiGate(bobPage);
      await drive(alicePage, bobPage, { document, gate });
      assert.deepEqual(aliceErrors, []);
      assert.deepEqual(bobErrors, []);
    },
  );
}

test(
  "a lost push response after the real commit retries without a duplicate row",
  { timeout: 300_000 },
  async (t) => {
    const harness = new SyncHarness();
    t.after(() => harness.close());
    await harness.start();
    await withPair(
      harness,
      "sync-fault-lost-response",
      async (alicePage, bobPage, { document, gate }) => {
        const before = await readD1State(harness);
        let accepted = null;
        let lost = false;
        await bobPage.route(changesGlob, async (route) => {
          if (lost || route.request().method() !== "POST") {
            await route.continue();
            return;
          }
          lost = true;
          const response = await route.fetch();
          accepted = await response.json();
          await route.abort("connectionreset");
        });
        await addCustomCourse(bobPage, "Lost response 145");
        await waitForSync(bobPage, "オフライン", 30_000);
        assert.ok(accepted, "the push reached the real Worker");
        await waitFor(
          async () =>
            (await readD1State(harness)).changes.length ===
            before.changes.length + accepted.accepted.length,
          "the committed row is visible even though the browser lost the response",
        );
        const committed = await readD1State(harness);
        assert.equal(
          committed.changes.length,
          before.changes.length + accepted.accepted.length,
        );
        assert.equal(
          new Set(committed.changes.map((row) => row.seq)).size,
          committed.changes.length,
        );
        assert.equal(
          new Set(committed.changes.map((row) => row.change_id)).size,
          committed.changes.length,
        );
        assert.equal(gate.offline, false);

        await bobPage.unroute(changesGlob);
        await bobPage.locator("#sync-retry").click();
        await waitForSync(bobPage, "同期済み", 30_000);
        const retried = await readD1State(harness);
        assert.deepEqual(retried, committed);
        // A push acknowledges the outbox at the push cursor. Pull once more so
        // the merged pull cursor also covers the change this browser uploaded.
        await kickSync(bobPage);
        await waitForSync(bobPage, "同期済み", 30_000);
        const syncState = await readSyncState(bobPage, {
          apiOrigin: harness.apiOrigin,
          documentId: document.document_id,
        });
        assert.deepEqual(syncState.outbox, []);
        const planner = await readPlannerState(bobPage, {
          apiOrigin: harness.apiOrigin,
          documentId: document.document_id,
        });
        assert.equal(planner.metadata.mergedCursor, accepted.cursor);
      },
    );
  },
);

test(
  "an interrupted page transaction reloads and reapplies the page without loss or duplicates",
  { timeout: 300_000 },
  async (t) => {
    const harness = new SyncHarness();
    t.after(() => harness.close());
    await harness.start();
    await withPair(
      harness,
      "sync-fault-cursor-interrupt",
      async (alicePage, bobPage, { document, gate }) => {
        gate.offline = true;
        await addOffering(alicePage, "phy302-s");
        await waitForPlannerSource(
          alicePage,
          'source.enrollments.some((row) => row.offering_id === "phy302-s")',
          "Alice remote offering committed",
        );
        await waitForSync(alicePage, "同期済み", 30_000);
        const server = await readD1State(harness);
        const serverCursor = Number(
          server.documents.find((row) => row.id === document.document_id)
            .last_seq,
        );
        assert.equal(server.changes.length, serverCursor);

        await installPlannerPutAbort(bobPage);
        await bobPage.reload();
        await waitForPersistence(bobPage);
        await waitForSync(bobPage, "オフライン", 30_000);
        const beforeFailure = await readPlannerState(bobPage, {
          apiOrigin: harness.apiOrigin,
          documentId: document.document_id,
        });
        assert.ok(beforeFailure.metadata.mergedCursor < serverCursor);
        const pullAfters = [];
        bobPage.on("request", (request) => {
          const url = new URL(request.url());
          if (
            request.method() === "GET" &&
            url.pathname.endsWith(
              `/api/v1/sync/documents/${document.document_id}/changes`,
            )
          ) {
            pullAfters.push(Number(url.searchParams.get("after")));
          }
        });

        await armPlannerPutAbort(bobPage);
        gate.offline = false;
        await bobPage.locator("#sync-retry").click();
        await waitForSync(bobPage, "同期エラー", 30_000);
        assert.equal(
          await bobPage.evaluate(
            () => globalThis["__TANIKUN_SYNC_ABORT_COUNT__"],
          ),
          1,
          "the abort ran inside the real IndexedDB transaction",
        );
        const afterFailure = await readPlannerState(bobPage, {
          apiOrigin: harness.apiOrigin,
          documentId: document.document_id,
        });
        assert.equal(
          canonicalSource(afterFailure.source),
          canonicalSource(beforeFailure.source),
          "the aborted page did not change the committed planner",
        );
        assert.deepEqual(afterFailure.heads, beforeFailure.heads);
        assert.equal(
          afterFailure.metadata.mergedCursor,
          beforeFailure.metadata.mergedCursor,
        );
        assert.equal(
          afterFailure.metadata.observedHighWater,
          serverCursor,
          "the observed high-water commit survived the page rollback",
        );
        assert.deepEqual(await readD1State(harness), server);
        assert.ok(pullAfters.includes(beforeFailure.metadata.mergedCursor));

        await bobPage.reload();
        await waitForPersistence(bobPage);
        await waitForSync(bobPage, "同期済み", 30_000);
        const recovered = await readPlannerState(bobPage, {
          apiOrigin: harness.apiOrigin,
          documentId: document.document_id,
        });
        assertConverged(
          await readPlannerState(alicePage, {
            apiOrigin: harness.apiOrigin,
            documentId: document.document_id,
          }),
          recovered,
          "after duplicate page reapply",
        );
        assert.equal(recovered.metadata.mergedCursor, serverCursor);
        assert.deepEqual(await readD1State(harness), server);
        assert.deepEqual(pullAfters.slice(1), [
          beforeFailure.metadata.mergedCursor,
        ]);
      },
    );
  },
);

test(
  "a real D1 gap and counter rollback fail closed and recover after repair",
  { timeout: 300_000 },
  async (t) => {
    const harness = new SyncHarness();
    t.after(() => harness.close());
    await harness.start();
    await withPair(
      harness,
      "sync-fault-gap-rollback",
      async (alicePage, bobPage, { document, gate }) => {
        const quotedId = sqlQuote(document.document_id);
        gate.offline = true;
        await addOffering(alicePage, "phy103-s2");
        await waitForPlannerSource(
          alicePage,
          'source.enrollments.some((row) => row.offering_id === "phy103-s2")',
          "Alice gap fixture offering committed",
        );
        await waitForSync(alicePage, "同期済み", 30_000);
        const beforeGap = await readD1State(harness);
        const gapSeq = beforeGap.changes.length;
        assert.ok(gapSeq > 0);
        const beforeFailure = await readPlannerState(bobPage, {
          apiOrigin: harness.apiOrigin,
          documentId: document.document_id,
        });
        await harness.d1(
          `CREATE TABLE changes_backup_145 AS SELECT * FROM changes WHERE document_id = ${quotedId}`,
        );
        try {
          await harness.d1(
            `DELETE FROM changes WHERE document_id = ${quotedId} AND seq = ${gapSeq}`,
          );
          gate.offline = false;
          await kickSync(bobPage);
          await waitForSync(bobPage, "同期エラー", 30_000);
          assert.equal((await lastSyncStatus(bobPage)).code, "log_gap");
          const afterGap = await readPlannerState(bobPage, {
            apiOrigin: harness.apiOrigin,
            documentId: document.document_id,
          });
          assert.equal(
            afterGap.metadata.mergedCursor,
            beforeFailure.metadata.mergedCursor,
          );
          assert.equal(afterGap.metadata.observedHighWater, gapSeq);
          assert.equal(
            canonicalSource(afterGap.source),
            canonicalSource(beforeFailure.source),
          );
        } finally {
          await harness.d1(
            `DELETE FROM changes WHERE document_id = ${quotedId}`,
          );
          await harness.d1(
            "INSERT INTO changes SELECT * FROM changes_backup_145",
          );
          await harness.d1("DROP TABLE changes_backup_145");
        }
        await kickSync(bobPage);
        await waitForSync(bobPage, "同期済み", 30_000);
        assertConverged(
          await readPlannerState(alicePage, {
            apiOrigin: harness.apiOrigin,
            documentId: document.document_id,
          }),
          await readPlannerState(bobPage, {
            apiOrigin: harness.apiOrigin,
            documentId: document.document_id,
          }),
          "after gap repair",
        );

        gate.offline = true;
        await addOffering(alicePage, "phy102-s2");
        await waitForPlannerSource(
          alicePage,
          'source.enrollments.some((row) => row.offering_id === "phy102-s2")',
          "Alice rollback fixture offering committed",
        );
        await waitForSync(alicePage, "同期済み", 30_000);
        const beforeRollback = await readPlannerState(bobPage, {
          apiOrigin: harness.apiOrigin,
          documentId: document.document_id,
        });
        await harness.d1(
          `UPDATE documents SET last_seq = 0 WHERE id = ${quotedId}`,
        );
        try {
          gate.offline = false;
          await kickSync(bobPage);
          await waitForSync(bobPage, "同期エラー", 30_000);
          assert.equal((await lastSyncStatus(bobPage)).code, "rollback");
          const afterRollback = await readPlannerState(bobPage, {
            apiOrigin: harness.apiOrigin,
            documentId: document.document_id,
          });
          assert.equal(
            afterRollback.metadata.mergedCursor,
            beforeRollback.metadata.mergedCursor,
          );
          assert.equal(
            afterRollback.metadata.observedHighWater,
            beforeRollback.metadata.observedHighWater,
          );
          assert.equal(
            canonicalSource(afterRollback.source),
            canonicalSource(beforeRollback.source),
          );
        } finally {
          await harness.d1(
            `UPDATE documents SET last_seq = (SELECT COUNT(*) FROM changes) WHERE id = ${quotedId}`,
          );
        }
        await kickSync(bobPage);
        await waitForSync(bobPage, "同期済み", 30_000);
        assertConverged(
          await readPlannerState(alicePage, {
            apiOrigin: harness.apiOrigin,
            documentId: document.document_id,
          }),
          await readPlannerState(bobPage, {
            apiOrigin: harness.apiOrigin,
            documentId: document.document_id,
          }),
          "after rollback repair",
        );
        const final = await readD1State(harness);
        assert.equal(
          new Set(final.changes.map((row) => row.seq)).size,
          final.changes.length,
        );
        assert.equal(
          new Set(final.changes.map((row) => row.change_id)).size,
          final.changes.length,
        );
        assert.equal(
          Number(
            final.documents.find((row) => row.id === document.document_id)
              .last_seq,
          ),
          final.changes.length,
        );
      },
    );
  },
);

test(
  "a mutated pull page with a missing dependency is rejected and then recovers",
  { timeout: 300_000 },
  async (t) => {
    const harness = new SyncHarness();
    t.after(() => harness.close());
    await harness.start();
    await withPair(
      harness,
      "sync-fault-missing-dependency",
      async (alicePage, bobPage, { document, gate }) => {
        gate.offline = true;
        await addOffering(alicePage, "phy102-s2");
        await waitForPlannerSource(
          alicePage,
          'source.enrollments.some((row) => row.offering_id === "phy102-s2")',
          "Alice first dependency offering committed",
        );
        await waitForSync(alicePage, "同期済み", 30_000);
        await addOffering(alicePage, "phy103-s2");
        await waitForPlannerSource(
          alicePage,
          'source.enrollments.some((row) => row.offering_id === "phy103-s2")',
          "Alice dependent offering committed",
        );
        await waitForSync(alicePage, "同期済み", 30_000);
        const server = await readD1State(harness);
        const beforeFailure = await readPlannerState(bobPage, {
          apiOrigin: harness.apiOrigin,
          documentId: document.document_id,
        });
        let mutated = false;
        await bobPage.route(changesGlob, async (route) => {
          if (route.request().method() !== "GET") {
            await route.continue();
            return;
          }
          const response = await route.fetch();
          const text = await response.text();
          const body = JSON.parse(text);
          const headers = { ...response.headers() };
          delete headers["content-encoding"];
          delete headers["content-length"];
          if (!mutated && body.changes.length >= 2) {
            mutated = true;
            body.changes = body.changes.slice(1);
            await route.fulfill({
              status: response.status(),
              headers,
              body: JSON.stringify(body),
            });
            return;
          }
          await route.fulfill({
            status: response.status(),
            headers,
            body: text,
          });
        });

        gate.offline = false;
        await kickSync(bobPage);
        await waitForSync(bobPage, "同期エラー", 30_000);
        assert.equal(
          (await lastSyncStatus(bobPage)).code,
          "missing_dependency",
        );
        assert.equal(mutated, true);
        const afterFailure = await readPlannerState(bobPage, {
          apiOrigin: harness.apiOrigin,
          documentId: document.document_id,
        });
        assert.equal(
          afterFailure.metadata.mergedCursor,
          beforeFailure.metadata.mergedCursor,
        );
        assert.equal(
          afterFailure.metadata.observedHighWater,
          Number(
            server.documents.find((row) => row.id === document.document_id)
              .last_seq,
          ),
        );
        assert.equal(
          canonicalSource(afterFailure.source),
          canonicalSource(beforeFailure.source),
        );
        assert.deepEqual(await readD1State(harness), server);

        await bobPage.unroute(changesGlob);
        await kickSync(bobPage);
        await waitForSync(bobPage, "同期済み", 30_000);
        assertConverged(
          await readPlannerState(alicePage, {
            apiOrigin: harness.apiOrigin,
            documentId: document.document_id,
          }),
          await readPlannerState(bobPage, {
            apiOrigin: harness.apiOrigin,
            documentId: document.document_id,
          }),
          "after missing dependency retry",
        );
        assert.deepEqual(await readD1State(harness), server);
      },
    );
  },
);

test(
  "a real 503 and an offline gate recover through retry without duplicate rows",
  { timeout: 300_000 },
  async (t) => {
    const harness = new SyncHarness();
    t.after(() => harness.close());
    await harness.start();
    await withPair(
      harness,
      "sync-fault-503-offline",
      async (_alicePage, bobPage, { document, gate }) => {
        const before = await readD1State(harness);
        await harness.d1(
          "ALTER TABLE changes RENAME TO changes_unavailable_145",
        );
        try {
          await addCustomCourse(bobPage, "Real 503 145");
          await waitForSync(bobPage, "同期エラー", 30_000);
          assert.equal(
            (await lastSyncStatus(bobPage)).code,
            "temporarily_unavailable",
          );
          await waitFor(
            async () =>
              (
                await readSyncState(bobPage, {
                  apiOrigin: harness.apiOrigin,
                  documentId: document.document_id,
                })
              ).outbox.length === 1,
            "the local change stays in the outbox during 503",
          );
          const unavailable = await harness.d1Query(
            "SELECT COUNT(*) AS count FROM changes_unavailable_145",
          );
          assert.equal(Number(unavailable[0].count), before.changes.length);
        } finally {
          await harness.d1(
            "ALTER TABLE changes_unavailable_145 RENAME TO changes",
          );
        }
        await bobPage.locator("#sync-retry").click();
        await waitForSync(bobPage, "同期済み", 30_000);
        const recovered = await readD1State(harness);
        assert.equal(recovered.changes.length, before.changes.length + 1);
        assert.deepEqual(
          (
            await readSyncState(bobPage, {
              apiOrigin: harness.apiOrigin,
              documentId: document.document_id,
            })
          ).outbox,
          [],
        );

        gate.offline = true;
        await addOffering(bobPage, "phy302-s");
        await waitForPlannerSource(
          bobPage,
          'source.enrollments.some((row) => row.offering_id === "phy302-s")',
          "Bob offline recovery offering committed",
        );
        await waitForSync(bobPage, "オフライン", 30_000);
        gate.offline = false;
        await bobPage.locator("#sync-retry").click();
        await waitForSync(bobPage, "同期済み", 30_000);
        const final = await readD1State(harness);
        assert.equal(final.changes.length, before.changes.length + 2);
        assert.equal(
          new Set(final.changes.map((row) => row.change_id)).size,
          final.changes.length,
        );
        assert.equal(
          Number(
            final.documents.find((row) => row.id === document.document_id)
              .last_seq,
          ),
          final.changes.length,
        );
      },
    );
  },
);
