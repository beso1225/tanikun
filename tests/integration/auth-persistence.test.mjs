import assert from "node:assert/strict";
import test from "node:test";

import * as Automerge from "@automerge/automerge";
import { IDBFactory } from "fake-indexeddb";

globalThis.Automerge = Automerge;
await import("../../apps/web/public/planner-document.js");
await import("../../apps/web/public/persistence-transactions.js");
await import("../../apps/web/public/auth-state.js");
await import("../../apps/web/public/persistence.js");

const codec = globalThis.tanikunDocument;
const { createStorage } = globalThis.tanikunPersistence;
const { createTransactions } = globalThis.tanikunPersistenceTransactions;
const { createAuthStateStore, AUTH_STATE_KEY } =
  globalThis.tanikunAuthStateModule;

const HANDLE_ALICE = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const HANDLE_BOB = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI";

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

const otherSource = {
  ...source,
  program_id: "fictional-2",
  catalogue: [
    {
      id: { namespace_part: "fixture", local_part: "chemistry" },
      name: "Chemistry",
      credits: 3,
    },
  ],
};

const validSource = (text) => {
  try {
    return JSON.parse(text)?.version === 1;
  } catch {
    return false;
  }
};

function requestDone(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("request failed")),
      { once: true },
    );
  });
}

async function openDatabase(indexedDB) {
  const request = indexedDB.open("tanikun-planner", 1);
  request.addEventListener(
    "upgradeneeded",
    () => {
      if (!request.result.objectStoreNames.contains("documents"))
        request.result.createObjectStore("documents");
    },
    { once: true },
  );
  return requestDone(request);
}

async function readKey(indexedDB, key) {
  const database = await openDatabase(indexedDB);
  try {
    const transaction = database.transaction("documents", "readonly");
    return await requestDone(transaction.objectStore("documents").get(key));
  } finally {
    database.close();
  }
}

async function writeKey(indexedDB, key, value) {
  const database = await openDatabase(indexedDB);
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("documents", "readwrite");
      transaction.objectStore("documents").put(value, key);
      transaction.addEventListener("complete", resolve, { once: true });
      transaction.addEventListener(
        "abort",
        () => reject(transaction.error ?? new Error("abort")),
        { once: true },
      );
    });
  } finally {
    database.close();
  }
}

function createHarness() {
  const indexedDB = new IDBFactory();
  const auth = createAuthStateStore({
    indexedDB,
    channelFactory: null,
    randomBytes: (length) => {
      const bytes = new Uint8Array(length);
      bytes.fill(length === 16 ? 3 : 4);
      return bytes;
    },
  });
  let override = null;
  const transact = createTransactions({
    indexedDB,
    timers: {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
    },
  });
  const storage = createStorage({
    Automerge,
    codec,
    transact,
    scopeProvider: async () => {
      if (override) return override;
      return auth.currentScope();
    },
  });
  storage.configure(validSource);
  return {
    indexedDB,
    auth,
    storage,
    setOverride: (value) => (override = value),
  };
}

test("session storage reads and writes only the account planner key", async () => {
  const { indexedDB, auth, storage } = createHarness();
  await auth.initialize({ mode: "session" });
  await auth.write({ accountHandle: HANDLE_ALICE, sessionState: "active" });
  await writeKey(indexedDB, "planner", {
    storageVersion: 2,
    bytes: Automerge.save(codec.update(null, JSON.stringify(source))),
  });

  assert.equal(await storage.load(), null);
  await storage.save(JSON.stringify(otherSource));
  const account = await readKey(indexedDB, `account:${HANDLE_ALICE}:planner`);
  const unbound = await readKey(indexedDB, "planner");
  assert.equal(account.storageVersion, 2);
  assert.equal(
    JSON.parse(codec.text(Automerge.load(account.bytes))).catalogue[0].name,
    "Chemistry",
  );
  assert.equal(
    JSON.parse(codec.text(Automerge.load(unbound.bytes))).catalogue[0].name,
    "Physics",
  );
  assert.equal(await storage.lastRejectedText(), null);
});

test("a generation switch aborts saves and retains the edited text", async () => {
  const { auth, storage, setOverride } = createHarness();
  await auth.initialize({ mode: "session" });
  const alice = await auth.write({
    accountHandle: HANDLE_ALICE,
    sessionState: "active",
  });
  await storage.load();
  await storage.save(JSON.stringify(source));

  let staleEvents = 0;
  const unsubscribe = storage.onStaleAccount(() => {
    staleEvents += 1;
  });
  try {
    const bob = await auth.write({
      accountHandle: HANDLE_BOB,
      sessionState: "active",
    });
    setOverride({
      mode: "session",
      plannerKey: `account:${HANDLE_ALICE}:planner`,
      generation: bob.generation,
      accountHandle: HANDLE_BOB,
      sessionState: "active",
    });
    const edited = JSON.stringify(otherSource);
    await assert.rejects(
      storage.save(edited),
      (error) =>
        error.code === "stale_account" && error.message.includes("アカウント"),
    );
    assert.equal(await storage.lastRejectedText(), edited);
    assert.equal(staleEvents, 1);
    assert.equal(alice.accountHandle, HANDLE_ALICE);
  } finally {
    unsubscribe();
  }
});

test("the stored auth generation fences even without a provider update", async () => {
  const { indexedDB, auth, storage } = createHarness();
  await auth.initialize({ mode: "session" });
  await auth.write({ accountHandle: HANDLE_ALICE, sessionState: "active" });
  await storage.load();
  await storage.save(JSON.stringify(source));
  const committed = await readKey(indexedDB, `account:${HANDLE_ALICE}:planner`);

  const switched = await auth.write({
    accountHandle: HANDLE_BOB,
    sessionState: "active",
  });
  const state = await readKey(indexedDB, AUTH_STATE_KEY);
  assert.equal(state.generation, switched.generation);

  const edited = JSON.stringify(otherSource);
  await assert.rejects(
    storage.save(edited),
    (error) => error.code === "stale_account",
  );
  assert.equal(await storage.lastRejectedText(), edited);
  assert.deepEqual(
    await readKey(indexedDB, `account:${HANDLE_ALICE}:planner`),
    committed,
  );
});

test("reauth keeps the generation so the same account plan remains editable", async () => {
  const { auth, storage } = createHarness();
  await auth.initialize({ mode: "session" });
  await auth.write({ accountHandle: HANDLE_ALICE, sessionState: "active" });
  await storage.load();
  await storage.save(JSON.stringify(source));
  const next = await auth.setSessionState("reauth_required");
  assert.equal(next.sessionState, "reauth_required");
  await storage.save(JSON.stringify(otherSource));
  assert.deepEqual(
    JSON.parse(await storage.load()),
    JSON.parse(JSON.stringify(otherSource)),
  );
});

test("legacy storage keeps the planner key and never creates auth state", async () => {
  const indexedDB = new IDBFactory();
  const transact = createTransactions({
    indexedDB,
    timers: {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle),
    },
  });
  const storage = createStorage({ Automerge, codec, transact });
  storage.configure(validSource);
  assert.equal(await storage.load(), null);
  await storage.save(JSON.stringify(source));
  assert.equal((await readKey(indexedDB, "planner")).storageVersion, 2);
  assert.equal(await readKey(indexedDB, AUTH_STATE_KEY), undefined);
});

test("discard and merge also obey the account fence", async () => {
  const { indexedDB, auth, storage } = createHarness();
  await auth.initialize({ mode: "session" });
  await auth.write({ accountHandle: HANDLE_ALICE, sessionState: "active" });
  await storage.load();
  await storage.save(JSON.stringify(source));
  const committed = await readKey(indexedDB, `account:${HANDLE_ALICE}:planner`);

  const bob = await auth.write({
    accountHandle: HANDLE_BOB,
    sessionState: "active",
  });
  assert.equal(bob.sessionState, "active");
  const changed = await readKey(indexedDB, AUTH_STATE_KEY);
  assert.equal(changed.generation, bob.generation);

  await assert.rejects(
    storage.discard(),
    (error) => error.code === "stale_account",
  );
  assert.deepEqual(
    await readKey(indexedDB, `account:${HANDLE_ALICE}:planner`),
    committed,
  );
  const changes = storage.changes();
  assert.equal(changes.length > 0, true);
});
