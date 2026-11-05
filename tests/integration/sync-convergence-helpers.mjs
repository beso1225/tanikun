import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

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

async function inPagePlannerState({ apiOrigin, documentId }) {
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const openDatabase = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open("tanikun-planner", 1);
      request.addEventListener("upgradeneeded", () => {
        if (!request.result.objectStoreNames.contains("documents"))
          request.result.createObjectStore("documents");
      });
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("planner open failed")),
        { once: true },
      );
    });
  const database = await openDatabase();
  try {
    const transaction = database.transaction("documents", "readonly");
    const store = transaction.objectStore("documents");
    const read = (key) =>
      new Promise((resolve, reject) => {
        const request = store.get(key);
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener(
          "error",
          () => reject(request.error ?? new Error("planner read failed")),
          { once: true },
        );
      });
    const metadataKey =
      typeof apiOrigin === "string" && typeof documentId === "string"
        ? "sync:" + JSON.stringify([new URL(apiOrigin).origin, documentId])
        : null;
    const [record, metadata] = await Promise.all([
      read("planner"),
      metadataKey === null ? Promise.resolve(null) : read(metadataKey),
    ]);
    await new Promise((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve(), { once: true });
      transaction.addEventListener(
        "abort",
        () => reject(transaction.error ?? new Error("planner read aborted")),
        { once: true },
      );
    });
    if (!record) return { source: null, heads: [], metadata: metadata ?? null };
    if (record.storageVersion !== 2)
      throw new Error(`unsupported planner record: ${record.storageVersion}`);
    const document = globalThis.Automerge.load(record.bytes);
    return {
      source: JSON.parse(globalThis.tanikunDocument.text(document)),
      heads: globalThis.Automerge.getHeads(document).toSorted(),
      metadata: metadata ?? null,
      bytes: record.bytes,
    };
  } finally {
    database.close();
  }
}

/** Read the committed planner source, Automerge heads, and sync metadata. */
export async function readPlannerState(page, { apiOrigin, documentId } = {}) {
  return page.evaluate(inPagePlannerState, { apiOrigin, documentId });
}

/** Read local-only sync state without reading or changing the planner. */
export async function readSyncState(page, { apiOrigin, documentId }) {
  const syncScope = `${new URL(apiOrigin).origin}:${documentId}`;
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

export async function waitForPlannerSource(
  page,
  expression,
  label,
  timeout = 15_000,
) {
  try {
    await page.waitForFunction(
      async (sourceExpression) => {
        // oxlint-disable-next-line unicorn/consistent-function-scoping
        const openDatabase = () =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open("tanikun-planner", 1);
            request.addEventListener("upgradeneeded", () => {
              request.result.createObjectStore("documents");
            });
            request.addEventListener("success", () => resolve(request.result), {
              once: true,
            });
            request.addEventListener("error", () => reject(request.error), {
              once: true,
            });
          });
        const database = await openDatabase();
        try {
          const transaction = database.transaction("documents", "readonly");
          const request = transaction.objectStore("documents").get("planner");
          const record = await new Promise((resolve, reject) => {
            request.addEventListener("success", () => resolve(request.result), {
              once: true,
            });
            request.addEventListener("error", () => reject(request.error), {
              once: true,
            });
          });
          if (!record) return false;
          const source = JSON.parse(
            globalThis.tanikunDocument.text(
              globalThis.Automerge.load(record.bytes),
            ),
          );
          return Function("source", `return (${sourceExpression});`)(source);
        } finally {
          database.close();
        }
      },
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
        this.transaction.abort();
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
