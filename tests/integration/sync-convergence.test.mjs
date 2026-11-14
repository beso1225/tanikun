import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { waitForPersistence } from "./planner-harness.mjs";
import {
  addCustomCourse,
  addOffering,
  apiGlob,
  installApiGate,
} from "./sync-browser-helpers.mjs";
import {
  assertConverged,
  canonicalSource,
  readD1State,
  readPlannerState,
  readSyncState,
  readWorkerLog,
  syncNow,
  waitForPlannerSource,
} from "./sync-convergence-helpers.mjs";
import {
  SyncHarness,
  acceptBrowserFaults,
  identityToken,
  readTraceArchiveEntries,
  waitForSync,
} from "./sync-harness.mjs";

const canary = "Sync plaintext canary 145";

function sortedHeads(state) {
  return state.heads.toSorted();
}

test(
  "two isolated browsers converge by HTTP from empty storage through offline edits and reload",
  { timeout: 300_000 },
  async (t) => {
    const harness = new SyncHarness();
    t.after(() => harness.close());
    await harness.start();

    await harness.runJourneyGroup(
      "sync-convergence",
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
      async ([alicePage, bobPage], _errors, states) => {
        const aliceContext = states[0].context;
        const bobContext = states[1].context;
        assert.notEqual(aliceContext, bobContext);

        await waitForPersistence(alicePage);
        await waitForSync(alicePage, "同期済み", 30_000);
        // The first sync only pushes the seed history. Pull it once so Alice's
        // merged cursor also starts at the server high-water.
        await syncNow(alicePage, "同期済み");
        await waitForPersistence(bobPage);
        await waitForSync(bobPage, "オフライン", 30_000);

        const serverDocument = await harness.bootstrap("alice");
        const documentId = serverDocument.document_id;
        const aliceStart = await readPlannerState(alicePage, {
          apiOrigin: harness.apiOrigin,
          documentId,
        });
        assert.equal(aliceStart.metadata.mergedCursor, serverDocument.cursor);
        assert.ok(aliceStart.heads.length > 0);

        // B has a freshly seeded local planner but no sync metadata. Clear it
        // through the production discard API so its pull starts at cursor 0
        // without importing any bytes from A.
        const bobBeforeDiscard = await readPlannerState(bobPage, {
          apiOrigin: harness.apiOrigin,
          documentId,
        });
        assert.equal(bobBeforeDiscard.metadata, null);
        assert.ok(bobBeforeDiscard.source);
        await bobPage.evaluate(() => globalThis.tanikunStorage.discard());
        const bobEmpty = await readPlannerState(bobPage, {
          apiOrigin: harness.apiOrigin,
          documentId,
        });
        assert.equal(bobEmpty.source, null);
        assert.equal(bobEmpty.metadata, null);
        assert.equal(bobEmpty.metadata?.mergedCursor ?? 0, 0);
        assert.deepEqual(
          (
            await readSyncState(bobPage, {
              apiOrigin: harness.apiOrigin,
              documentId,
            })
          ).outbox,
          [],
        );

        await bobPage.unroute(apiGlob);
        await bobPage.locator("#sync-retry").click();
        await waitForSync(bobPage, "同期済み", 30_000);
        const bobAdopted = await readPlannerState(bobPage, {
          apiOrigin: harness.apiOrigin,
          documentId,
        });
        assertConverged(aliceStart, bobAdopted, "B after cursor-0 pull");
        assert.deepEqual(bobAdopted.heads, sortedHeads(aliceStart));
        assert.equal(
          bobAdopted.metadata.mergedCursor,
          serverDocument.cursor,
          "B merged cursor advanced from zero",
        );

        await bobPage.reload();
        await waitForPersistence(bobPage);
        await waitForSync(bobPage, "同期済み", 30_000);
        assertConverged(
          aliceStart,
          await readPlannerState(bobPage, {
            apiOrigin: harness.apiOrigin,
            documentId,
          }),
          "B after reload",
        );

        const [aliceGate, bobGate] = await Promise.all([
          installApiGate(alicePage),
          installApiGate(bobPage),
        ]);
        aliceGate.offline = true;
        bobGate.offline = true;

        const aliceOffering = "phy302-s";
        await addOffering(alicePage, aliceOffering);
        await waitForPlannerSource(
          alicePage,
          `source.enrollments.some((row) => row.offering_id === ${JSON.stringify(aliceOffering)})`,
          "Alice offline offering committed",
        );
        await waitForSync(alicePage, "オフライン", 30_000);

        await addCustomCourse(bobPage, canary);
        await waitForPlannerSource(
          bobPage,
          `source.catalogue.some((row) => row.name === ${JSON.stringify(canary)})`,
          "Bob offline custom course committed",
        );
        await waitForSync(bobPage, "オフライン", 30_000);

        await alicePage.reload();
        await waitForPersistence(alicePage);
        await waitForSync(alicePage, "オフライン", 30_000);
        await waitForPlannerSource(
          alicePage,
          `source.enrollments.some((row) => row.offering_id === ${JSON.stringify(aliceOffering)})`,
          "Alice offline edit survived reload",
        );
        await bobPage.reload();
        await waitForPersistence(bobPage);
        await waitForSync(bobPage, "オフライン", 30_000);
        await waitForPlannerSource(
          bobPage,
          `source.catalogue.some((row) => row.name === ${JSON.stringify(canary)})`,
          "Bob offline edit survived reload",
        );

        aliceGate.offline = false;
        bobGate.offline = false;
        await alicePage.locator("#sync-retry").click();
        await waitForSync(alicePage, "同期済み", 30_000);
        await bobPage.locator("#sync-retry").click();
        await waitForSync(bobPage, "同期済み", 30_000);
        await syncNow(alicePage, "同期済み");
        await syncNow(bobPage, "同期済み");

        const aliceConverged = await readPlannerState(alicePage, {
          apiOrigin: harness.apiOrigin,
          documentId,
        });
        const bobConverged = await readPlannerState(bobPage, {
          apiOrigin: harness.apiOrigin,
          documentId,
        });
        assertConverged(aliceConverged, bobConverged, "after offline exchange");
        assert.equal(
          canonicalSource(aliceConverged.source),
          canonicalSource(bobConverged.source),
        );
        assert.deepEqual(aliceConverged.heads, sortedHeads(aliceConverged));
        assert.ok(
          aliceConverged.source.enrollments.some(
            (row) => row.offering_id === aliceOffering,
          ),
          "Alice offline offering is in both replicas",
        );
        assert.ok(
          aliceConverged.source.catalogue.some((row) => row.name === canary),
          "Bob offline custom course is in both replicas",
        );

        const d1 = await readD1State(harness);
        const documentRow = d1.documents.find((row) => row.id === documentId);
        const serverCursor = Number(documentRow.last_seq);
        assert.equal(d1.changes.length, serverCursor);
        assert.deepEqual(
          d1.changes.map((row) => Number(row.seq)),
          Array.from({ length: serverCursor }, (_, index) => index + 1),
        );
        assert.equal(
          new Set(d1.changes.map((row) => row.change_id)).size,
          d1.changes.length,
        );
        assert.equal(aliceConverged.metadata.mergedCursor, serverCursor);
        assert.equal(bobConverged.metadata.mergedCursor, serverCursor);
        assert.ok(aliceConverged.metadata.observedHighWater >= serverCursor);
        assert.ok(bobConverged.metadata.observedHighWater >= serverCursor);

        // Reload both replicas and exchange again. No new server rows, local
        // outbox entries, or cursor movement may appear.
        await alicePage.reload();
        await waitForPersistence(alicePage);
        await waitForSync(alicePage, "同期済み", 30_000);
        await bobPage.reload();
        await waitForPersistence(bobPage);
        await waitForSync(bobPage, "同期済み", 30_000);
        await syncNow(alicePage, "同期済み");
        await syncNow(bobPage, "同期済み");

        const aliceAfter = await readPlannerState(alicePage, {
          apiOrigin: harness.apiOrigin,
          documentId,
        });
        const bobAfter = await readPlannerState(bobPage, {
          apiOrigin: harness.apiOrigin,
          documentId,
        });
        assertConverged(
          aliceConverged,
          aliceAfter,
          "Alice retains both edits after second exchange",
        );
        assertConverged(
          bobConverged,
          bobAfter,
          "Bob retains both edits after second exchange",
        );
        assertConverged(
          aliceAfter,
          bobAfter,
          "after reload and second exchange",
        );
        for (const state of [aliceAfter, bobAfter]) {
          assert.equal(state.metadata.mergedCursor, serverCursor);
          assert.ok(state.metadata.observedHighWater >= serverCursor);
          assert.ok(
            state.source.enrollments.some(
              (row) => row.offering_id === aliceOffering,
            ),
          );
          assert.ok(state.source.catalogue.some((row) => row.name === canary));
        }
        assert.deepEqual(await readD1State(harness), d1);
        for (const page of [alicePage, bobPage]) {
          assert.deepEqual(
            (
              await readSyncState(page, {
                apiOrigin: harness.apiOrigin,
                documentId,
              })
            ).outbox,
            [],
          );
        }

        acceptBrowserFaults(states[0], [
          {
            kind: "console",
            text: "Failed to load resource: net::ERR_FAILED",
            count: 2,
            reason:
              "alice offline edit and offline reload each failed one sync request",
          },
        ]);
        acceptBrowserFaults(states[1], [
          {
            kind: "console",
            text: "Failed to load resource: net::ERR_FAILED",
            count: 3,
            reason:
              "bob started offline and then edited and reloaded while offline",
          },
        ]);
      },
    );

    const runLog = await readFile(
      join(harness.evidenceDir, "sync-convergence.log"),
      "utf8",
    );
    assert.deepEqual(JSON.parse(runLog), [
      { label: "alice", pageErrorCount: 2, expectedFaultCount: 2 },
      { label: "bob", pageErrorCount: 3, expectedFaultCount: 3 },
    ]);

    const traceText = (
      await Promise.all(
        ["alice", "bob"].map(async (label) => {
          const entries = await readTraceArchiveEntries(
            join(harness.evidenceDir, `sync-convergence-${label}-trace.zip`),
          );
          return [...entries.values()].map((bytes) => bytes.toString("utf8"));
        }),
      )
    ).join("\n");
    assert.equal(traceText.includes(canary), false);
    assert.equal(traceText.includes(identityToken("alice")), false);

    await harness.close();
    const workerLog = await readWorkerLog(harness);
    assert.equal(workerLog.includes(canary), false);
    assert.equal(workerLog.includes(identityToken("alice")), false);
    assert.equal(workerLog.includes("Authorization"), false);
  },
);
