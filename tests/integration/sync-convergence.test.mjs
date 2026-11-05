import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { waitForPersistence } from "./planner-harness.mjs";
import {
  assertConverged,
  canonicalSource,
  readD1State,
  readPlannerState,
  readSyncState,
  readWorkerLog,
  waitForPlannerSource,
} from "./sync-convergence-helpers.mjs";
import {
  SyncHarness,
  identityToken,
  readTraceArchiveEntries,
  waitForSync,
} from "./sync-harness.mjs";

const canary = "Sync plaintext canary 145";
const offlineRoute = "**/api/v1/**";

function installApiGate(page) {
  const gate = { offline: false };
  const ready = page.route(offlineRoute, async (route) => {
    if (gate.offline) await route.abort("failed");
    else await route.continue();
  });
  return { gate, ready };
}

async function triggerSync(page) {
  const before = await page.evaluate(
    () => globalThis.tanikunSyncShell.history.length,
  );
  await page.evaluate(() => globalThis.tanikunSyncShell.sync());
  await page.waitForFunction(
    (length) => globalThis.tanikunSyncShell.history.length > length,
    before,
    { timeout: 10_000 },
  );
  await waitForSync(page, "同期済み");
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
            await page.route(offlineRoute, (route) => route.abort("failed"));
          },
        },
      ],
      async ([alicePage, bobPage], [aliceErrors, bobErrors], states) => {
        const aliceContext = states[0].context;
        const bobContext = states[1].context;
        assert.notEqual(aliceContext, bobContext);

        await waitForPersistence(alicePage);
        await waitForSync(alicePage, "同期済み", 30_000);
        // The first sync only pushes the seed history. Pull it once so Alice's
        // merged cursor also starts at the server high-water.
        await triggerSync(alicePage);
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

        await bobPage.unroute(offlineRoute);
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

        const aliceGate = installApiGate(alicePage);
        const bobGate = installApiGate(bobPage);
        await Promise.all([aliceGate.ready, bobGate.ready]);
        aliceGate.gate.offline = true;
        bobGate.gate.offline = true;

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

        aliceGate.gate.offline = false;
        bobGate.gate.offline = false;
        await alicePage.locator("#sync-retry").click();
        await waitForSync(alicePage, "同期済み", 30_000);
        await bobPage.locator("#sync-retry").click();
        await waitForSync(bobPage, "同期済み", 30_000);
        await triggerSync(alicePage);
        await triggerSync(bobPage);

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
        await triggerSync(alicePage);
        await triggerSync(bobPage);

        assertConverged(
          await readPlannerState(alicePage, {
            apiOrigin: harness.apiOrigin,
            documentId,
          }),
          await readPlannerState(bobPage, {
            apiOrigin: harness.apiOrigin,
            documentId,
          }),
          "after reload and second exchange",
        );
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

        assert.deepEqual(aliceErrors, []);
        assert.deepEqual(bobErrors, []);
      },
    );

    const runLog = await readFile(
      join(harness.evidenceDir, "sync-convergence.log"),
      "utf8",
    );
    assert.match(runLog, /alice: page errors: \[\]/);
    assert.match(runLog, /bob: page errors: \[\]/);

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
