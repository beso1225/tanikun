import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

import { startStaticServer, waitForPersistence } from "./planner-harness.mjs";

const evidenceDirectory = ".cache/verify";

function installProbe() {
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const openDatabase = () =>
    new Promise((finish, reject) => {
      const opening = indexedDB.open("tanikun-planner", 1);
      opening.onupgradeneeded = () =>
        opening.result.createObjectStore("documents");
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => finish(opening.result);
    });
  const readRecord = () =>
    openDatabase().then(
      (database) =>
        new Promise((finish, reject) => {
          const transaction = database.transaction("documents", "readonly");
          const get = transaction.objectStore("documents").get("planner");
          const close = () => database.close();
          transaction.oncomplete = () => {
            close();
            const stored = get.result;
            finish(
              stored?.storageVersion === 2
                ? { storageVersion: 2, bytes: Array.from(stored.bytes) }
                : stored,
            );
          };
          transaction.onerror = transaction.onabort = () => {
            close();
            reject(transaction.error);
          };
        }),
    );
  const writeRecord = (value) =>
    openDatabase().then(
      (database) =>
        new Promise((finish, reject) => {
          const transaction = database.transaction("documents", "readwrite");
          const record =
            value?.storageVersion === 2
              ? { ...value, bytes: new Uint8Array(value.bytes) }
              : value;
          const put = transaction
            .objectStore("documents")
            .put(record, "planner");
          const close = () => database.close();
          transaction.oncomplete = () => {
            close();
            finish(
              put.result?.storageVersion === 2
                ? {
                    storageVersion: 2,
                    bytes: Array.from(put.result.bytes),
                  }
                : put.result,
            );
          };
          transaction.onerror = transaction.onabort = () => {
            close();
            reject(transaction.error);
          };
        }),
    );
  const readSource = () =>
    readRecord().then((stored) => {
      if (stored === undefined) return null;
      if (typeof stored === "string") {
        try {
          return JSON.parse(stored);
        } catch {
          return null;
        }
      }
      if (!globalThis.tanikunDocument || !globalThis.Automerge) return null;
      return JSON.parse(
        globalThis.tanikunDocument.text(
          globalThis.Automerge.load(new Uint8Array(stored.bytes)),
        ),
      );
    });
  globalThis.tanikunPersistenceProbe = { readRecord, writeRecord, readSource };
}

async function addProbe(page) {
  await page.addInitScript(installProbe);
}

async function stopTracing(contexts, name, failed) {
  for (const [index, context] of contexts.entries()) {
    if (failed) {
      await context.tracing.stop({
        path: `${evidenceDirectory}/${name}-context-${index + 1}-failure-trace.zip`,
      });
    } else {
      await context.tracing.stop();
    }
  }
}

async function captureFailure(pages, name, error) {
  await mkdir(evidenceDirectory, { recursive: true });
  for (const [index, page] of pages.entries()) {
    try {
      await page.screenshot({
        path: `${evidenceDirectory}/${name}-page-${index + 1}-failure.png`,
        fullPage: true,
      });
    } catch {
      // The page may already be closed; keep the original failure.
    }
  }
  console.error(`${name}: ${error.message}`);
}

/**
 * Run one or more pages against a static app server. Each page pair shares a
 * context when `isolated` is false and gets its own context when it is true.
 * Errors, failure screenshots, traces, and context cleanup are identical for
 * single-page and multi-page journeys.
 */
export async function runBrowserJourney(
  t,
  { chromium, dist, name, pages: pageCount = 1, isolated = false },
  drive,
) {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((finish) => server.close(finish)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const contexts = [];
  const pages = [];
  const errors = [];
  try {
    if (isolated) {
      for (let index = 0; index < pageCount; index += 1) {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 900 },
        });
        contexts.push(context);
        await context.tracing.start({ screenshots: true, snapshots: true });
      }
    } else {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      contexts.push(context);
      await context.tracing.start({ screenshots: true, snapshots: true });
    }
    for (let index = 0; index < pageCount; index += 1) {
      const context = isolated ? contexts[index] : contexts[0];
      const page = await context.newPage();
      pages.push(page);
      page.on("pageerror", (error) =>
        errors.push(`[page ${index + 1}] ${error.message}`),
      );
      page.on("console", (message) => {
        if (message.type() === "error")
          errors.push(`[page ${index + 1}] ${message.text()}`);
      });
      await addProbe(page);
    }
    await drive(pages, errors, origin, contexts);
    await stopTracing(contexts, name, false);
  } catch (error) {
    await captureFailure(pages, name, error);
    await stopTracing(contexts, name, true);
    throw error;
  } finally {
    for (const context of contexts) await context.close();
  }
}

/** Read the raw committed record without touching the production adapter. */
export function readStored(page) {
  return page.evaluate(() => globalThis.tanikunPersistenceProbe.readRecord());
}

/** Write a raw record for migration and fault setup. */
export function writeStored(page, value) {
  return page.evaluate(
    (replacement) =>
      globalThis.tanikunPersistenceProbe.writeRecord(replacement),
    value ?? null,
  );
}

/** Decode committed bytes into planner source without calling storage.load(). */
export function readCommittedSource(page) {
  return page.evaluate(() => globalThis.tanikunPersistenceProbe.readSource());
}

/** Wait until the committed source satisfies a serializable predicate body. */
export async function waitForCommittedSource(
  page,
  predicateSource,
  label,
  timeout = 10_000,
) {
  try {
    await page.waitForFunction(
      async ({ expression }) => {
        const source = await globalThis.tanikunPersistenceProbe.readSource();
        if (!source || typeof source !== "object") return false;
        // The predicate is written by the test, not by the application.
        return Function("source", `return (${expression});`)(source);
      },
      { expression: predicateSource },
      { timeout },
    );
  } catch (error) {
    const source = await readCommittedSource(page);
    assert.fail(
      `${label}: committed source did not match (${predicateSource}); saw ${JSON.stringify(source)}: ${error.message}`,
    );
  }
}

export function waitForCommittedTerm(page, term, label = `term ${term}`) {
  return waitForCommittedSource(
    page,
    `source.selected_term === ${JSON.stringify(term)}`,
    label,
  );
}

/** Wait for a committed source matching the predicate and different from a previous record. */
export async function waitForCommittedSourceAfter(
  page,
  predicateSource,
  previous,
  label,
  timeout = 10_000,
) {
  try {
    await page.waitForFunction(
      async ({ expression, before }) => {
        const stored = await globalThis.tanikunPersistenceProbe.readRecord();
        if (JSON.stringify(stored) === JSON.stringify(before)) return false;
        const source = await globalThis.tanikunPersistenceProbe.readSource();
        if (!source || typeof source !== "object") return false;
        return Function("source", `return (${expression});`)(source);
      },
      { expression: predicateSource, before: previous },
      { timeout },
    );
  } catch (error) {
    const source = await readCommittedSource(page);
    assert.fail(
      `${label}: committed source did not change to match (${predicateSource}); saw ${JSON.stringify(source)}: ${error.message}`,
    );
  }
}

/** Read Automerge changes without adopting a new document handle. */
export function readChanges(page) {
  return page.evaluate(() =>
    globalThis.tanikunStorage.changes().map((bytes) => Array.from(bytes)),
  );
}

export function mergeChanges(page, batch) {
  return page.evaluate(
    (incoming) =>
      globalThis.tanikunStorage.merge(
        incoming.map((bytes) => new Uint8Array(bytes)),
      ),
    batch,
  );
}

/** Install a one-shot barrier released explicitly by the test. */
export async function installBarrier(page) {
  await page.evaluate(() => {
    let release;
    globalThis.journeyBarrier = new Promise((finish) => {
      release = finish;
    });
    globalThis.journeyBarrierDone = false;
    globalThis.releaseJourneyBarrier = () => release();
  });
}

export async function releaseBarrier(page) {
  await page.evaluate(() => globalThis.releaseJourneyBarrier());
}

/** Delay all saves until the test releases the barrier. */
export async function delaySaves(page) {
  await installBarrier(page);
  await page.evaluate(() => {
    const save = globalThis.tanikunStorage.save;
    globalThis.tanikunStorage.save = async (text, replace) => {
      await globalThis.journeyBarrier;
      return save(text, replace);
    };
  });
}

/** Wait until the delayed open or completion callback has run. */
export async function waitForDelayedCallback(page) {
  await page.waitForFunction(
    () => globalThis.journeyBarrierDone === true,
    undefined,
    { timeout: 10_000 },
  );
}

/** Shorten only the adapter's 5000 ms timeout for a fault-injection test. */
export async function shortenPersistenceTimeout(page, replacement = 100) {
  await page.evaluate((delay) => {
    const schedule = globalThis.setTimeout;
    globalThis.setTimeout = (callback, milliseconds, ...args) => {
      if (milliseconds !== 5000) {
        return schedule(callback, milliseconds, ...args);
      }
      // Restore at the one shortened timeout so later saves keep the real
      // persistence budget.
      globalThis.setTimeout = schedule;
      return schedule(callback, delay, ...args);
    };
  }, replacement);
}

/** Delay the next successful database open until the barrier is released. */
export async function delayNextOpenSuccess(page) {
  await installBarrier(page);
  await page.evaluate(() => {
    const open = indexedDB.open;
    indexedDB.open = function (...args) {
      const request = open.apply(this, args);
      const listen = request.addEventListener.bind(request);
      request.addEventListener = (name, callback, options) =>
        listen(
          name,
          name === "success"
            ? async (...eventArgs) => {
                await globalThis.journeyBarrier;
                callback(...eventArgs);
                globalThis.journeyBarrierDone = true;
              }
            : callback,
          options,
        );
      indexedDB.open = open;
      return request;
    };
  });
}

/** Delay the next read/write transaction completion until the barrier. */
export async function delayNextTransactionComplete(page) {
  await installBarrier(page);
  await page.evaluate(() => {
    const listen = IDBTransaction.prototype.addEventListener;
    IDBTransaction.prototype.addEventListener = function (
      type,
      callback,
      options,
    ) {
      if (type === "complete" && this.mode === "readwrite") {
        IDBTransaction.prototype.addEventListener = listen;
        return listen.call(
          this,
          type,
          async (...eventArgs) => {
            await globalThis.journeyBarrier;
            callback(...eventArgs);
            globalThis.journeyBarrierDone = true;
          },
          options,
        );
      }
      return listen.call(this, type, callback, options);
    };
  });
}

/** Make the next save reject with a localized quota error. */
export async function failNextSave(page, message = "quota exceeded") {
  await page.evaluate((reason) => {
    globalThis.tanikunStorage.save = () => Promise.reject(new Error(reason));
  }, message);
}

/** Make the next save result reject with a non-Error value. */
export async function failNextSaveResult(page) {
  await page.evaluate(() => {
    globalThis.tanikunStorage.saveResult = () => Promise.reject("unexpected");
  });
}

/** Abort the next object-store put after it is queued. */
export async function abortNextPut(page) {
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      IDBObjectStore.prototype.put = put;
      const request = put.apply(this, args);
      this.transaction.abort();
      return request;
    };
  });
}

export async function storeInvalidDocument(page, value = "{broken") {
  await writeStored(page, value);
}

export { waitForPersistence };
