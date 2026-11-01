import assert from "node:assert/strict";
import test from "node:test";

import * as Automerge from "@automerge/automerge";
import { IDBFactory } from "fake-indexeddb";

globalThis.Automerge = Automerge;
await import("../../apps/web/public/planner-document.js");
await import("../../apps/web/public/persistence-transactions.js");
await import("../../apps/web/public/persistence.js");

const codec = globalThis.tanikunDocument;
const { createStorage } = globalThis.tanikunPersistence;
const { createTransactions } = globalThis.tanikunPersistenceTransactions;

const source = {
  version: 1,
  catalogue: [
    {
      id: { namespace_part: "fixture", local_part: "physics" },
      name: "Physics",
      credits: 4,
    },
  ],
  offerings: [],
  enrollments: [],
  overrides: [],
  custom_course_ids: [],
  custom_categories: [],
  program_id: "fictional",
  next_custom_course_number: 1,
};

const validSource = (text) => {
  try {
    return JSON.parse(text)?.version === 1;
  } catch {
    return false;
  }
};

const flush = () => new Promise((resolve) => setImmediate(resolve));
const settle = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
const expectedSource = (text) =>
  JSON.parse(codec.text(codec.update(null, text)));

function manualTimers() {
  let nextHandle = 0;
  const pending = new Map();
  return {
    setTimeout(callback, delay) {
      const handle = ++nextHandle;
      pending.set(handle, { callback, delay });
      return handle;
    },
    clearTimeout(handle) {
      pending.delete(handle);
    },
    run() {
      const next = pending.entries().next();
      if (next.done) return false;
      const [handle, entry] = next.value;
      pending.delete(handle);
      entry.callback();
      return true;
    },
    delays() {
      return [...pending.values()].map((entry) => entry.delay);
    },
    get size() {
      return pending.size;
    },
  };
}

// Drive open, transaction, and request events by hand so ordering does not
// depend on a browser or on wall-clock waits.
function controlledRequest() {
  const request = new EventTarget();
  request.result = undefined;
  request.error = null;
  return request;
}

function controlledIndexedDB() {
  const transactions = [];
  const openings = [];
  let closeCalls = 0;
  const database = {
    get closeCalls() {
      return closeCalls;
    },
    close() {
      closeCalls += 1;
    },
    transaction(name, mode) {
      const transaction = new EventTarget();
      transaction.mode = mode;
      transaction.storeName = name;
      transaction.abortCalls = 0;
      transaction.puts = [];
      transaction.abort = () => {
        transaction.abortCalls += 1;
      };
      transaction.objectStore = (store) => {
        transaction.storeName = store;
        return {
          get(key) {
            const request = controlledRequest();
            transaction.getRequest = request;
            transaction.getKey = key;
            return request;
          },
          put(value, key) {
            const request = controlledRequest();
            request.result = key;
            transaction.puts.push({ value, key });
            return request;
          },
        };
      };
      transactions.push(transaction);
      return transaction;
    },
  };
  return {
    database,
    openings,
    transactions,
    open(name, version) {
      const request = controlledRequest();
      request.databaseName = name;
      request.version = version;
      openings.push(request);
      return request;
    },
    succeed(request = openings.at(-1)) {
      request.result = database;
      request.dispatchEvent(new Event("success"));
    },
    fail(error, request = openings.at(-1)) {
      request.error = error;
      request.dispatchEvent(new Event("error"));
    },
  };
}

function scriptedTransact() {
  const calls = [];
  const transact = (mode, operation, hooks = {}) => {
    const call = { mode, operation, hooks, puts: [], settled: false };
    calls.push(call);
    call.promise = new Promise((resolve, reject) => {
      call.resolve = (value) => {
        if (call.settled) return;
        call.settled = true;
        resolve(value);
      };
      call.reject = (error) => {
        if (call.settled) return;
        call.settled = true;
        reject(error);
      };
    });
    return call.promise;
  };
  return { calls, transact };
}

function startOperation(call) {
  const store = {
    get(key) {
      const request = new EventTarget();
      request.result = undefined;
      call.getRequest = request;
      store.getRequest = request;
      call.getKey = key;
      return request;
    },
    put(value, key) {
      call.puts.push({ value, key });
      const request = new EventTarget();
      request.result = key;
      return request;
    },
  };
  call.operation(store, (error) => {
    call.hooks.onAbort?.();
    call.reject(error);
  });
  return store;
}

function answerGet(store, value) {
  store.getRequest.result = value;
  store.getRequest.dispatchEvent(new Event("success"));
}

function createAdapter({ indexedDB, timers, timeout, transact }) {
  const storage = createStorage({
    Automerge,
    codec,
    transact: transact ?? createTransactions({ indexedDB, timers, timeout }),
  });
  storage.configure(validSource);
  return storage;
}

async function readStored(indexedDB) {
  const opening = indexedDB.open("tanikun-planner", 1);
  const database = await new Promise((resolve, reject) => {
    opening.addEventListener("success", () => resolve(opening.result), {
      once: true,
    });
    opening.addEventListener("error", () => reject(opening.error), {
      once: true,
    });
  });
  try {
    const transaction = database.transaction("documents", "readonly");
    const get = transaction.objectStore("documents").get("planner");
    return await new Promise((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve(get.result), {
        once: true,
      });
      transaction.addEventListener("error", () => reject(transaction.error), {
        once: true,
      });
      transaction.addEventListener("abort", () => reject(transaction.error), {
        once: true,
      });
    });
  } finally {
    database.close();
  }
}

async function writeStored(indexedDB, record) {
  const opening = indexedDB.open("tanikun-planner", 1);
  const database = await new Promise((resolve, reject) => {
    opening.addEventListener(
      "upgradeneeded",
      () => opening.result.createObjectStore("documents"),
      { once: true },
    );
    opening.addEventListener("success", () => resolve(opening.result), {
      once: true,
    });
    opening.addEventListener("error", () => reject(opening.error), {
      once: true,
    });
  });
  try {
    const transaction = database.transaction("documents", "readwrite");
    transaction.objectStore("documents").put(record, "planner");
    await new Promise((resolve, reject) => {
      transaction.addEventListener("complete", resolve, { once: true });
      transaction.addEventListener("error", () => reject(transaction.error), {
        once: true,
      });
      transaction.addEventListener("abort", () => reject(transaction.error), {
        once: true,
      });
    });
  } finally {
    database.close();
  }
}

function countingIndexedDB(factory) {
  const closes = [];
  return {
    closes,
    open(name, version) {
      const request = factory.open(name, version);
      request.addEventListener(
        "success",
        () => {
          const database = request.result;
          const close = database.close.bind(database);
          database.close = () => {
            closes.push(database);
            close();
          };
        },
        { once: true },
      );
      return request;
    },
  };
}

function decodeStored(record) {
  return record?.storageVersion === 2
    ? codec.text(Automerge.load(record.bytes))
    : record;
}

test("missing storage reports explicit load and save failures", async () => {
  const timers = manualTimers();
  const storage = createAdapter({ indexedDB: undefined, timers, timeout: 25 });
  const loadError = await settle(storage.load());
  assert.match(loadError.error.message, /保存領域を利用できません/);
  assert.deepEqual(await storage.loadResult(), [
    "failed",
    "保存領域を利用できません",
  ]);
  assert.deepEqual(await storage.saveResult(JSON.stringify(source)), [
    "failed",
    "保存領域を利用できません",
  ]);
  assert.equal(timers.size, 0);
});

test("an opening failure surfaces through the storage adapter", async () => {
  const idb = controlledIndexedDB();
  const timers = manualTimers();
  const storage = createAdapter({ indexedDB: idb, timers, timeout: 25 });
  const loading = storage.load();
  assert.equal(idb.openings[0].version, 1);
  idb.fail(new Error("データベースを開けません"));
  const outcome = await settle(loading);
  assert.match(outcome.error.message, /データベースを開けません/);
  assert.equal(timers.size, 0);
  assert.equal(idb.database.closeCalls, 0);
  const second = controlledIndexedDB();
  const result = createAdapter({
    indexedDB: second,
    timers,
    timeout: 25,
  }).loadResult();
  second.fail(new Error("データベースを開けません"));
  assert.deepEqual(await result, ["failed", "データベースを開けません"]);
});

test("an opening exception clears its timer", async () => {
  const timers = manualTimers();
  const transact = createTransactions({
    indexedDB: {
      open() {
        throw new Error("保存領域を利用できません");
      },
    },
    timers,
    timeout: 25,
  });
  const outcome = await settle(transact("readonly", () => {}));
  assert.match(outcome.error.message, /保存領域を利用できません/);
  assert.equal(timers.size, 0);
});

test("a blocked open times out and a late success closes the connection", async () => {
  const idb = controlledIndexedDB();
  const timers = manualTimers();
  const transact = createTransactions({
    indexedDB: idb,
    timers,
    timeout: 25,
  });
  let operations = 0;
  const outcome = settle(
    transact("readwrite", () => {
      operations += 1;
    }),
  );
  idb.openings[0].dispatchEvent(new Event("blocked"));
  assert.deepEqual(timers.delays(), [25]);
  assert.equal(timers.run(), true);
  assert.match((await outcome).error.message, /タイムアウト/);
  idb.succeed();
  assert.equal(operations, 0);
  assert.equal(idb.transactions.length, 0);
  assert.equal(idb.database.closeCalls, 1);
  assert.equal(timers.size, 0);
});

test("an active transaction timeout aborts without committing", async () => {
  const idb = controlledIndexedDB();
  const timers = manualTimers();
  const transact = createTransactions({
    indexedDB: idb,
    timers,
    timeout: 25,
  });
  let commits = 0;
  let aborts = 0;
  const outcome = settle(
    transact("readwrite", (store) => store.get("planner"), {
      onCommit: () => {
        commits += 1;
      },
      onAbort: () => {
        aborts += 1;
      },
    }),
  );
  idb.succeed();
  const transaction = idb.transactions[0];
  assert.equal(timers.run(), true);
  assert.match((await outcome).error.message, /タイムアウト/);
  assert.equal(transaction.abortCalls, 1);
  assert.equal(idb.database.closeCalls, 1);
  assert.equal(commits, 0);
  assert.equal(aborts, 0);
  assert.equal(timers.size, 0);
});

test("a completed transaction reports its commit after the timeout", async () => {
  const idb = controlledIndexedDB();
  const timers = manualTimers();
  const transact = createTransactions({
    indexedDB: idb,
    timers,
    timeout: 25,
  });
  let commits = 0;
  let aborts = 0;
  const outcome = settle(
    transact("readwrite", (store) => store.get("planner"), {
      onCommit: () => {
        commits += 1;
      },
      onAbort: () => {
        aborts += 1;
      },
    }),
  );
  idb.succeed();
  const transaction = idb.transactions[0];
  assert.equal(timers.run(), true);
  assert.match((await outcome).error.message, /タイムアウト/);
  transaction.dispatchEvent(new Event("complete"));
  assert.equal(commits, 1);
  assert.equal(aborts, 0);
  assert.equal(idb.database.closeCalls, 1);
});

test("a request failure aborts the transaction and reports its cause", async () => {
  const idb = controlledIndexedDB();
  const timers = manualTimers();
  const transact = createTransactions({
    indexedDB: idb,
    timers,
    timeout: 25,
  });
  let aborts = 0;
  let fail;
  const outcome = settle(
    transact(
      "readwrite",
      (store, operationFail) => {
        fail = operationFail;
        return store.get("planner");
      },
      {
        onAbort: () => {
          aborts += 1;
        },
      },
    ),
  );
  idb.succeed();
  const transaction = idb.transactions[0];
  fail(new Error("要求に失敗しました"));
  assert.match((await outcome).error.message, /要求に失敗しました/);
  assert.equal(transaction.abortCalls, 1);
  assert.equal(aborts, 1);
  assert.equal(idb.database.closeCalls, 1);
  assert.equal(timers.size, 0);
});

test("a transaction creation failure closes the connection", async () => {
  const idb = controlledIndexedDB();
  const timers = manualTimers();
  const transact = createTransactions({
    indexedDB: idb,
    timers,
    timeout: 25,
  });
  let aborts = 0;
  const outcome = settle(
    transact("readwrite", (store) => store.get("planner"), {
      onAbort: () => {
        aborts += 1;
      },
    }),
  );
  idb.database.transaction = () => {
    throw new Error("トランザクションを作成できません");
  };
  idb.succeed();
  assert.match(
    (await outcome).error.message,
    /トランザクションを作成できません/,
  );
  assert.equal(idb.database.closeCalls, 1);
  assert.equal(aborts, 1);
  assert.equal(timers.size, 0);
});

test("an operation that throws aborts and closes the connection", async () => {
  const idb = controlledIndexedDB();
  const timers = manualTimers();
  const transact = createTransactions({
    indexedDB: idb,
    timers,
    timeout: 25,
  });
  let aborts = 0;
  const outcome = settle(
    transact(
      "readwrite",
      () => {
        throw new Error("操作に失敗しました");
      },
      {
        onAbort: () => {
          aborts += 1;
        },
      },
    ),
  );
  idb.succeed();
  const transaction = idb.transactions[0];
  assert.match((await outcome).error.message, /操作に失敗しました/);
  assert.equal(transaction.abortCalls, 1);
  assert.equal(aborts, 1);
  assert.equal(idb.database.closeCalls, 1);
  assert.equal(timers.size, 0);
});

test("a transaction error event reports its failure", async () => {
  const idb = controlledIndexedDB();
  const timers = manualTimers();
  const transact = createTransactions({
    indexedDB: idb,
    timers,
    timeout: 25,
  });
  let aborts = 0;
  const outcome = settle(
    transact("readonly", (store) => store.get("planner"), {
      onAbort: () => {
        aborts += 1;
      },
    }),
  );
  idb.succeed();
  const transaction = idb.transactions[0];
  transaction.error = new Error("トランザクションに失敗しました");
  transaction.dispatchEvent(new Event("error"));
  assert.match((await outcome).error.message, /トランザクションに失敗しました/);
  assert.equal(aborts, 1);
  assert.equal(idb.database.closeCalls, 1);
  assert.equal(timers.size, 0);
});

test("an abort after a timeout still drops the attempt", async () => {
  const idb = controlledIndexedDB();
  const timers = manualTimers();
  const transact = createTransactions({
    indexedDB: idb,
    timers,
    timeout: 25,
  });
  let aborts = 0;
  const outcome = settle(
    transact("readwrite", (store) => store.get("planner"), {
      onAbort: () => {
        aborts += 1;
      },
    }),
  );
  idb.succeed();
  const transaction = idb.transactions[0];
  assert.equal(timers.run(), true);
  assert.match((await outcome).error.message, /タイムアウト/);
  assert.equal(aborts, 0);
  transaction.dispatchEvent(new Event("abort"));
  assert.equal(aborts, 1);
  assert.equal(transaction.abortCalls, 1);
  assert.equal(idb.database.closeCalls, 1);
});

test("a definitive abort notifies the adapter before the connection closes", async () => {
  const idb = controlledIndexedDB();
  const timers = manualTimers();
  const transact = createTransactions({
    indexedDB: idb,
    timers,
    timeout: 25,
  });
  let aborts = 0;
  const outcome = settle(
    transact("readonly", (store) => store.get("planner"), {
      onAbort: () => {
        aborts += 1;
      },
    }),
  );
  idb.succeed();
  idb.transactions[0].dispatchEvent(new Event("abort"));
  assert.match((await outcome).error.message, /保存が中断されました/);
  assert.equal(aborts, 1);
  assert.equal(idb.database.closeCalls, 1);
});

test("a retry opens a new connection after a timeout", async () => {
  const idb = controlledIndexedDB();
  const timers = manualTimers();
  const transact = createTransactions({
    indexedDB: idb,
    timers,
    timeout: 25,
  });
  const timedOut = settle(
    transact("readonly", (store) => store.get("planner")),
  );
  assert.equal(timers.run(), true);
  assert.match((await timedOut).error.message, /タイムアウト/);
  const retried = settle(transact("readonly", (store) => store.get("planner")));
  idb.succeed();
  const transaction = idb.transactions[0];
  const stored = { storageVersion: 2, bytes: new Uint8Array([1, 2, 3]) };
  transaction.getRequest.result = stored;
  transaction.dispatchEvent(new Event("complete"));
  assert.deepEqual((await retried).value, stored);
  assert.equal(idb.database.closeCalls, 1);
  assert.equal(timers.size, 0);
});

test("a successful transaction closes its connection", async () => {
  const indexedDB = countingIndexedDB(new IDBFactory());
  const timers = manualTimers();
  const transact = createTransactions({
    indexedDB,
    timers,
    timeout: 25,
  });
  const key = await transact("readwrite", (store) =>
    store.put({ value: 1 }, "planner"),
  );
  assert.equal(key, "planner");
  assert.deepEqual(
    await transact("readonly", (store) => store.get("planner")),
    { value: 1 },
  );
  assert.equal(indexedDB.closes.length, 2);
  assert.equal(timers.size, 0);
});

test("the adapter stores a version 2 envelope and rejects a stale writer", async () => {
  const indexedDB = new IDBFactory();
  const timers = manualTimers();
  const left = createAdapter({ indexedDB, timers, timeout: 25 });
  const right = createAdapter({ indexedDB, timers, timeout: 25 });
  assert.equal(await left.load(), null);
  assert.equal(await right.load(), null);
  const text = JSON.stringify(source);
  await left.save(text);
  const committed = await readStored(indexedDB);
  assert.equal(committed.storageVersion, 2);
  assert.deepEqual(JSON.parse(decodeStored(committed)), expectedSource(text));
  const stale = { ...structuredClone(source), program_id: "stale" };
  const outcome = await settle(right.save(JSON.stringify(stale)));
  assert.match(outcome.error.message, /別のタブで保存されました/);
  assert.deepEqual(await readStored(indexedDB), committed);
});

test("the adapter reports explicit load and save outcomes", async () => {
  const indexedDB = new IDBFactory();
  const timers = manualTimers();
  const storage = createAdapter({ indexedDB, timers, timeout: 25 });
  const stale = createAdapter({ indexedDB, timers, timeout: 25 });
  assert.deepEqual(await storage.loadResult(), ["missing"]);
  assert.deepEqual(await stale.loadResult(), ["missing"]);
  const text = JSON.stringify(source);
  assert.deepEqual(await storage.saveResult(text), ["saved"]);
  assert.deepEqual(await storage.loadResult(), [
    "loaded",
    codec.text(codec.update(null, text)),
  ]);
  assert.deepEqual(await storage.saveResult("{broken"), [
    "failed",
    "保存データが正しくありません",
  ]);
  const conflict = await stale.saveResult(
    JSON.stringify({ ...source, program_id: "stale" }),
  );
  assert.equal(conflict[0], "failed");
  assert.match(conflict[1], /別のタブで保存されました/);
});

test("rejected and unexpected outcomes fail closed", async () => {
  const { calls, transact } = scriptedTransact();
  const storage = createAdapter({ transact });
  const loading = storage.loadResult();
  await flush();
  calls.at(-1).reject("unexpected");
  assert.deepEqual(await loading, ["failed"]);
  const saving = storage.saveResult(JSON.stringify(source));
  await flush();
  calls.at(-1).reject("unexpected");
  assert.deepEqual(await saving, ["failed"]);
  storage.load = async () => 42;
  assert.deepEqual(await storage.loadResult(), ["failed"]);
});

test("a merge from another replica persists the converged plan", async () => {
  const leftIDB = new IDBFactory();
  const rightIDB = new IDBFactory();
  const timers = manualTimers();
  const left = createAdapter({ indexedDB: leftIDB, timers, timeout: 25 });
  const right = createAdapter({ indexedDB: rightIDB, timers, timeout: 25 });
  assert.equal(await left.load(), null);
  await left.save(JSON.stringify(source));
  const base = await readStored(leftIDB);
  await writeStored(rightIDB, base);
  assert.equal(await right.load(), codec.text(Automerge.load(base.bytes)));
  const edited = { ...structuredClone(source), program_id: "merged" };
  await right.save(JSON.stringify(edited));
  await left.merge(right.changes());
  const stored = await readStored(leftIDB);
  assert.deepEqual(
    JSON.parse(decodeStored(stored)),
    expectedSource(JSON.stringify(edited)),
  );
  const reconstructed = Automerge.applyChanges(
    Automerge.init(),
    left.changes(),
  )[0];
  assert.deepEqual(
    JSON.parse(codec.text(reconstructed)),
    expectedSource(JSON.stringify(edited)),
  );
});

test("a rejected save does not poison later queued writes", async () => {
  const indexedDB = new IDBFactory();
  const timers = manualTimers();
  const storage = createAdapter({ indexedDB, timers, timeout: 25 });
  assert.equal(await storage.load(), null);
  const rejected = await settle(storage.save("{broken"));
  assert.match(rejected.error.message, /保存データが正しくありません/);
  const text = JSON.stringify(source);
  await storage.save(text);
  assert.deepEqual(
    JSON.parse(decodeStored(await readStored(indexedDB))),
    expectedSource(text),
  );
});

test("a definitively aborted write keeps committed bytes and history", async () => {
  const indexedDB = new IDBFactory();
  const timers = manualTimers();
  const storage = createAdapter({ indexedDB, timers, timeout: 25 });
  assert.equal(await storage.load(), null);
  await storage.save(JSON.stringify(source));
  const committed = await readStored(indexedDB);
  const history = storage.changes();
  const open = indexedDB.open.bind(indexedDB);
  // Abort the transaction after the adapter queues its put, which is the
  // browser failure mode that must never adopt the candidate document.
  indexedDB.open = (name, version) => {
    const request = open(name, version);
    request.addEventListener(
      "success",
      () => {
        const database = request.result;
        const create = database.transaction.bind(database);
        database.transaction = (...args) => {
          const transaction = create(...args);
          if (transaction.mode === "readwrite") {
            const store = transaction.objectStore.bind(transaction);
            transaction.objectStore = (...storeArgs) => {
              const objectStore = store(...storeArgs);
              const put = objectStore.put.bind(objectStore);
              objectStore.put = (...putArgs) => {
                const result = put(...putArgs);
                transaction.abort();
                return result;
              };
              return objectStore;
            };
          }
          return transaction;
        };
      },
      { once: true },
    );
    return request;
  };
  const edited = { ...structuredClone(source), program_id: "aborted" };
  const outcome = await settle(storage.save(JSON.stringify(edited)));
  assert.ok(outcome.error);
  assert.deepEqual(await readStored(indexedDB), committed);
  assert.deepEqual(storage.changes(), history);
  indexedDB.open = open;
  await storage.save(JSON.stringify(edited));
  assert.deepEqual(
    JSON.parse(decodeStored(await readStored(indexedDB))),
    expectedSource(JSON.stringify(edited)),
  );
});

test("a late commit after a timeout is adopted for later changes", async () => {
  const { calls, transact } = scriptedTransact();
  const storage = createAdapter({ transact });
  const loading = storage.load();
  const loadCall = calls[0];
  answerGet(startOperation(loadCall), undefined);
  loadCall.resolve(undefined);
  assert.equal(await loading, null);
  const text = JSON.stringify(source);
  const saving = settle(storage.save(text));
  await flush();
  const writeCall = calls.at(-1);
  assert.equal(writeCall.mode, "readwrite");
  const store = startOperation(writeCall);
  answerGet(store, undefined);
  assert.equal(writeCall.puts.length, 1);
  writeCall.reject(new Error("保存領域へのアクセスがタイムアウトしました"));
  assert.match((await saving).error.message, /タイムアウト/);
  assert.deepEqual(storage.changes(), []);
  writeCall.hooks.onCommit();
  const reconstructed = Automerge.applyChanges(
    Automerge.init(),
    storage.changes(),
  )[0];
  assert.deepEqual(JSON.parse(codec.text(reconstructed)), expectedSource(text));
});

test("changes after an ambiguous timeout wait for reconciliation", async () => {
  const { calls, transact } = scriptedTransact();
  const storage = createAdapter({ transact });
  const loading = storage.load();
  answerGet(startOperation(calls[0]), undefined);
  calls[0].resolve(undefined);
  assert.equal(await loading, null);
  const text = JSON.stringify(source);
  const saving = settle(storage.save(text));
  await flush();
  const writeCall = calls.at(-1);
  const store = startOperation(writeCall);
  answerGet(store, undefined);
  const attempted = writeCall.puts[0].value;
  writeCall.reject(new Error("保存領域へのアクセスがタイムアウトしました"));
  assert.match((await saving).error.message, /タイムアウト/);
  assert.deepEqual(storage.changes(), []);
  const retrying = settle(storage.save(text));
  await flush();
  const reconcileCall = calls.at(-1);
  assert.equal(reconcileCall.mode, "readonly");
  answerGet(startOperation(reconcileCall), attempted);
  reconcileCall.resolve(attempted);
  await flush();
  const retryCall = calls.at(-1);
  assert.equal(retryCall.mode, "readwrite");
  const retryStore = startOperation(retryCall);
  answerGet(retryStore, attempted);
  assert.equal(retryCall.puts.length, 1);
  retryCall.hooks.onCommit();
  retryCall.resolve(undefined);
  assert.equal((await retrying).error, undefined);
  const reconstructed = Automerge.applyChanges(
    Automerge.init(),
    storage.changes(),
  )[0];
  assert.deepEqual(JSON.parse(codec.text(reconstructed)), expectedSource(text));
});

test("reconciliation rejects an unrelated tab record", async () => {
  const { calls, transact } = scriptedTransact();
  const storage = createAdapter({ transact });
  const loading = storage.load();
  answerGet(startOperation(calls[0]), undefined);
  calls[0].resolve(undefined);
  assert.equal(await loading, null);
  const text = JSON.stringify(source);
  const first = settle(storage.save(text));
  await flush();
  const firstCall = calls.at(-1);
  const firstStore = startOperation(firstCall);
  answerGet(firstStore, undefined);
  firstCall.hooks.onCommit();
  firstCall.resolve(undefined);
  assert.equal((await first).error, undefined);
  const committed = storage.changes();
  const attempted = settle(
    storage.save(JSON.stringify({ ...source, program_id: "attempted" })),
  );
  await flush();
  const attemptCall = calls.at(-1);
  const attemptStore = startOperation(attemptCall);
  answerGet(attemptStore, firstCall.puts[0].value);
  assert.equal(attemptCall.puts.length, 1);
  attemptCall.reject(new Error("保存領域へのアクセスがタイムアウトしました"));
  assert.match((await attempted).error.message, /タイムアウト/);
  const other = Automerge.save(
    codec.update(null, JSON.stringify({ ...source, program_id: "other" })),
  );
  const retrying = settle(
    storage.save(JSON.stringify({ ...source, program_id: "retry" })),
  );
  await flush();
  const reconcileCall = calls.at(-1);
  answerGet(startOperation(reconcileCall), { storageVersion: 2, bytes: other });
  reconcileCall.resolve({ storageVersion: 2, bytes: other });
  await flush();
  const retryCall = calls.at(-1);
  assert.equal(retryCall.mode, "readwrite");
  const retryStore = startOperation(retryCall);
  answerGet(retryStore, { storageVersion: 2, bytes: other });
  const rejected = await retrying;
  assert.match(rejected.error.message, /別のタブで保存されました/);
  assert.deepEqual(storage.changes(), committed);
});

test("an aborted attempt is dropped before the next save", async () => {
  const { calls, transact } = scriptedTransact();
  const storage = createAdapter({ transact });
  const loading = storage.load();
  answerGet(startOperation(calls[0]), undefined);
  calls[0].resolve(undefined);
  assert.equal(await loading, null);
  const text = JSON.stringify(source);
  const aborted = settle(storage.save(text));
  await flush();
  const abortCall = calls.at(-1);
  const abortStore = startOperation(abortCall);
  answerGet(abortStore, undefined);
  abortCall.hooks.onAbort();
  abortCall.reject(new Error("保存が中断されました"));
  assert.match((await aborted).error.message, /保存が中断されました/);
  assert.deepEqual(storage.changes(), []);
  const retrying = settle(storage.save(text));
  await flush();
  assert.equal(calls.length, 3);
  assert.equal(calls.at(-1).mode, "readwrite");
  const retryCall = calls.at(-1);
  const retryStore = startOperation(retryCall);
  answerGet(retryStore, undefined);
  retryCall.hooks.onCommit();
  retryCall.resolve(undefined);
  assert.equal((await retrying).error, undefined);
});

test("an older commit callback cannot replace a newer adoption", async () => {
  const { calls, transact } = scriptedTransact();
  const storage = createAdapter({ transact });
  const stale = settle(
    storage.save(JSON.stringify({ ...source, program_id: "stale" })),
  );
  await flush();
  const staleCall = calls.at(-1);
  assert.equal(staleCall.mode, "readwrite");
  const loading = storage.load();
  const loadCall = calls.at(-1);
  assert.equal(loadCall.mode, "readonly");
  const text = JSON.stringify({ ...source, program_id: "loaded" });
  const record = {
    storageVersion: 2,
    bytes: Automerge.save(codec.update(null, text)),
  };
  answerGet(startOperation(loadCall), record);
  loadCall.resolve(record);
  assert.deepEqual(JSON.parse(await loading), expectedSource(text));
  staleCall.hooks.onCommit();
  staleCall.resolve(undefined);
  assert.equal((await stale).error, undefined);
  const reconstructed = Automerge.applyChanges(
    Automerge.init(),
    storage.changes(),
  )[0];
  assert.deepEqual(JSON.parse(codec.text(reconstructed)), expectedSource(text));
});
