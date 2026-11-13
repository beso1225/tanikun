import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ensurePlannerRecordReader } from "./planner-record-reader.mjs";
import { waitForSync } from "./sync-harness.mjs";

export const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Start a sync and wait for its final status, not just the first entry. */
export async function syncNow(page, expected, timeout = 30_000) {
  const before = await page.evaluate(
    () => globalThis.tanikunSyncShell.history.length,
  );
  await page.evaluate(() => globalThis.tanikunSyncShell.sync());
  await page.waitForFunction(
    ({ length, status }) =>
      globalThis.tanikunSyncShell.history
        .slice(length)
        .some((entry) => entry.text === status),
    { length: before, status: expected },
    { timeout },
  );
  await waitForSync(page, expected, timeout);
}

export async function waitFor(predicate, label, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let observed;
  while (Date.now() < deadline) {
    observed = await predicate();
    if (observed) return observed;
    await wait(50);
  }
  assert.fail(`${label}: condition was not met; last value ${observed}`);
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, normalize(value[key])]),
    );
  }
  return value;
}

export function canonicalSource(source) {
  return JSON.stringify(normalize(source));
}

/** Session scopes use the account handle; dev bearer keeps its Phase 4 scope. */
export function syncScopeFor({ apiOrigin, documentId, accountHandle }) {
  const origin = new URL(apiOrigin).origin;
  return typeof accountHandle === "string"
    ? `${accountHandle}|${origin}|${documentId}`
    : `${origin}:${documentId}`;
}

/** Read the committed planner source, Automerge heads, and sync metadata. */
export async function readPlannerState(
  page,
  { apiOrigin, documentId, accountHandle } = {},
) {
  await ensurePlannerRecordReader(page);
  return page.evaluate(
    (options) =>
      globalThis.tanikunPlannerRecordReader.readPlannerState(options),
    { apiOrigin, documentId, accountHandle },
  );
}

/** Read local-only sync state without reading or changing the planner. */
export async function readSyncState(
  page,
  { apiOrigin, documentId, accountHandle },
) {
  const syncScope = syncScopeFor({ apiOrigin, documentId, accountHandle });
  return page.evaluate(async (scope) => {
    const store = globalThis.tanikunSyncStore.createSyncStore({
      indexedDB: globalThis.indexedDB,
    });
    try {
      return {
        outbox: (await store.listOutbox(scope)).map((entry) => entry.change_id),
        seen: [...(await store.seenHashes(scope))].toSorted(),
      };
    } finally {
      store.close();
    }
  }, syncScope);
}

/** Read queued session envelopes for duplicate/response-loss proof. */
export async function readOutboxEntries(
  page,
  { apiOrigin, documentId, accountHandle },
) {
  const syncScope = syncScopeFor({ apiOrigin, documentId, accountHandle });
  return page.evaluate(async (scope) => {
    const store = globalThis.tanikunSyncStore.createSyncStore({
      indexedDB: globalThis.indexedDB,
    });
    try {
      return (await store.listOutbox(scope)).map((entry) => ({
        change_id: entry.change_id,
        envelope: entry.envelope,
      }));
    } finally {
      store.close();
    }
  }, syncScope);
}

export async function waitForPlannerSource(
  page,
  expression,
  label,
  timeout = 15_000,
) {
  try {
    await ensurePlannerRecordReader(page);
    await page.waitForFunction(
      (sourceExpression) =>
        globalThis.tanikunPlannerRecordReader.sourceMatches(sourceExpression),
      expression,
      { timeout },
    );
  } catch (error) {
    const state = await readPlannerState(page).catch(() => null);
    assert.fail(
      `${label}: committed source did not match (${expression}); saw ${JSON.stringify(state?.source)}: ${error.message}`,
    );
  }
}

export function assertConverged(left, right, label = "replicas") {
  assert.deepEqual(
    normalize(left.source),
    normalize(right.source),
    `${label} source`,
  );
  assert.deepEqual(left.heads, right.heads, `${label} sorted heads`);
}

export async function installPlannerPutAbort(page) {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);
      if (
        globalThis["__TANIKUN_SYNC_ABORT_PLANNER_PUT__"] === true &&
        this.name === "documents" &&
        args[1] === "planner" &&
        this.transaction.mode === "readwrite"
      ) {
        globalThis["__TANIKUN_SYNC_ABORT_PLANNER_PUT__"] = false;
        globalThis["__TANIKUN_SYNC_ABORT_COUNT__"] =
          (globalThis["__TANIKUN_SYNC_ABORT_COUNT__"] ?? 0) + 1;
        // Abort after the write is queued but before the transaction commits.
        // This interrupts a real transaction without making the product code
        // race a second synchronous abort inside its write error handler.
        const transaction = this.transaction;
        queueMicrotask(() => {
          try {
            transaction.abort();
          } catch {
            // The transaction may have committed before the abort ran.
          }
        });
      }
      return request;
    };
  });
}

export async function armPlannerPutAbort(page) {
  await page.evaluate(() => {
    globalThis["__TANIKUN_SYNC_ABORT_PLANNER_PUT__"] = true;
  });
}

export async function readWorkerLog(harness) {
  return readFile(join(harness.evidenceDir, "wrangler.log"), "utf8");
}

/** D1 assertions kept next to the fault setup that changes the database. */
export async function readD1State(harness) {
  const changes = await harness.d1Query(
    "SELECT seq, change_id FROM changes ORDER BY seq",
  );
  const documents = await harness.d1Query(
    "SELECT id, owner_id, last_seq FROM documents ORDER BY id",
  );
  return { changes, documents };
}

export async function assertD1ChangeRows(harness, expected) {
  const rows = await harness.d1Query(
    "SELECT seq, change_id FROM changes ORDER BY seq",
  );
  assert.deepEqual(
    rows.map((row) => ({
      seq: Number(row.seq),
      change_id: row.change_id,
    })),
    expected,
  );
  assert.equal(
    new Set(rows.map((row) => row.seq)).size,
    rows.length,
    "D1 change sequences are unique",
  );
  assert.equal(
    new Set(rows.map((row) => row.change_id)).size,
    rows.length,
    "D1 change IDs are unique",
  );
}
