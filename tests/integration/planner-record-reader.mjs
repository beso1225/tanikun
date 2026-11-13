/**
 * Shared test-only reader for the committed planner record.
 *
 * Playwright stringifies functions passed to `addInitScript` and `evaluate`.
 * Keep `installPlannerRecordReader` self-contained: it cannot reference module
 * imports, top-level constants, or other closures. Page-side entry points take
 * one options object because `evaluate` accepts one argument.
 *
 * The reader owns the raw IndexedDB reads, Automerge decoding, and source
 * polling. Callers keep their existing record shapes and failure semantics:
 * the persistence probe serializes version 2 bytes as an array, while the sync
 * state reader returns the stored `Uint8Array` and rejects unsupported
 * versions.
 */
export function installPlannerRecordReader() {
  if (globalThis.tanikunPlannerRecordReader) return;

  const databaseName = "tanikun-planner";
  const storeName = "documents";
  const plannerKey = "planner";

  function openDatabase({ createStore, errorFallback }) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.addEventListener("upgradeneeded", () => {
        if (
          createStore === "always" ||
          !request.result.objectStoreNames.contains(storeName)
        ) {
          request.result.createObjectStore(storeName);
        }
      });
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener(
        "error",
        () =>
          reject(
            errorFallback === undefined
              ? request.error
              : (request.error ?? new Error(errorFallback)),
          ),
        { once: true },
      );
    });
  }

  // oxlint-disable-next-line unicorn/consistent-function-scoping
  function waitForTransaction(transaction, { listenForError, abortFallback }) {
    return new Promise((resolve, reject) => {
      if (listenForError) {
        transaction.addEventListener("error", () => reject(transaction.error), {
          once: true,
        });
      }
      transaction.addEventListener("complete", () => resolve(), { once: true });
      transaction.addEventListener(
        "abort",
        () =>
          reject(
            abortFallback === undefined
              ? transaction.error
              : (transaction.error ?? new Error(abortFallback)),
          ),
        { once: true },
      );
    });
  }

  async function readRecords(
    keys,
    {
      createStore = "if-missing",
      openErrorFallback,
      requestErrorFallback,
      listenForError = true,
      abortFallback,
      waitForTransaction: shouldWaitForTransaction = true,
    } = {},
  ) {
    const database = await openDatabase({
      createStore,
      errorFallback: openErrorFallback,
    });
    try {
      const transaction = database.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const records = await Promise.all(
        keys.map(
          (key) =>
            new Promise((resolve, reject) => {
              const request = store.get(key);
              request.addEventListener(
                "success",
                () => resolve(request.result),
                { once: true },
              );
              request.addEventListener(
                "error",
                () =>
                  reject(
                    requestErrorFallback === null ||
                      requestErrorFallback === undefined
                      ? request.error
                      : (request.error ?? new Error(requestErrorFallback)),
                  ),
                { once: true },
              );
            }),
        ),
      );
      if (shouldWaitForTransaction) {
        await waitForTransaction(transaction, {
          listenForError,
          abortFallback,
        });
      }
      return records;
    } finally {
      database.close();
    }
  }

  // oxlint-disable-next-line unicorn/consistent-function-scoping
  function decodeDocument(bytes) {
    const document = globalThis.Automerge.load(bytes);
    return {
      document,
      source: JSON.parse(globalThis.tanikunDocument.text(document)),
    };
  }

  async function readRecord() {
    const [stored] = await readRecords([plannerKey], {
      createStore: "always",
    });
    return stored?.storageVersion === 2
      ? { storageVersion: 2, bytes: Array.from(stored.bytes) }
      : stored;
  }

  async function readSource() {
    const stored = await readRecord();
    if (stored === undefined) return null;
    if (typeof stored === "string") {
      try {
        return JSON.parse(stored);
      } catch {
        return null;
      }
    }
    if (!globalThis.tanikunDocument || !globalThis.Automerge) return null;
    return decodeDocument(new Uint8Array(stored.bytes)).source;
  }

  async function readPlannerState({
    apiOrigin,
    documentId,
    accountHandle,
  } = {}) {
    const selectedPlannerKey =
      typeof accountHandle === "string"
        ? `account:${accountHandle}:planner`
        : plannerKey;
    const metadataKey =
      typeof apiOrigin === "string" && typeof documentId === "string"
        ? "sync:" +
          JSON.stringify(
            typeof accountHandle === "string"
              ? [accountHandle, new URL(apiOrigin).origin, documentId]
              : [new URL(apiOrigin).origin, documentId],
          )
        : null;
    const [record, metadata] = await readRecords(
      metadataKey === null
        ? [selectedPlannerKey]
        : [selectedPlannerKey, metadataKey],
      {
        createStore: "if-missing",
        openErrorFallback: "planner open failed",
        requestErrorFallback: "planner read failed",
        listenForError: false,
        abortFallback: "planner read aborted",
      },
    );
    if (!record) return { source: null, heads: [], metadata: metadata ?? null };
    if (record.storageVersion !== 2)
      throw new Error(`unsupported planner record: ${record.storageVersion}`);
    const { document, source } = decodeDocument(record.bytes);
    return {
      source,
      heads: globalThis.Automerge.getHeads(document).toSorted(),
      metadata: metadata ?? null,
      bytes: record.bytes,
    };
  }

  async function sourceMatches(expression) {
    const [record] = await readRecords([plannerKey], {
      createStore: "always",
      requestErrorFallback: null,
      listenForError: false,
      waitForTransaction: false,
    });
    if (!record) return false;
    const { source } = decodeDocument(record.bytes);
    return Function("source", `return (${expression});`)(source);
  }

  async function probeSourceMatches(expression) {
    const source = await readSource();
    if (!source || typeof source !== "object") return false;
    return Function("source", `return (${expression});`)(source);
  }

  async function probeSourceMatchesAfter(expression, before) {
    const stored = await readRecord();
    if (JSON.stringify(stored) === JSON.stringify(before)) return false;
    const source = await readSource();
    if (!source || typeof source !== "object") return false;
    return Function("source", `return (${expression});`)(source);
  }

  globalThis.tanikunPlannerRecordReader = {
    readRecord,
    readSource,
    readPlannerState,
    sourceMatches,
    probeSourceMatches,
    probeSourceMatchesAfter,
  };
}

const pagesWithReader = new WeakSet();

/** Install the reader before every navigation on a page. */
export async function addPlannerRecordReader(page) {
  if (pagesWithReader.has(page)) return;
  await page.addInitScript(installPlannerRecordReader);
  pagesWithReader.add(page);
}

/**
 * Install the reader for the current document and every later navigation.
 * The current document needs an explicit evaluate because `addInitScript`
 * only runs on navigation.
 */
export async function ensurePlannerRecordReader(page) {
  await addPlannerRecordReader(page);
  await page.evaluate(installPlannerRecordReader);
}
