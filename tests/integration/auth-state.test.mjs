import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { indexedDB } from "fake-indexeddb";

await import("../../apps/web/public/persistence-transactions.js");
await import("../../apps/web/public/auth-state.js");
const { createAuthStateStore, AuthStateError, AUTH_STATE_KEY } =
  globalThis.tanikunAuthStateModule;

const HANDLE_ALICE = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const HANDLE_BOB = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI";
const stores = [];

function deletePlannerDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("tanikun-planner");
    request.addEventListener("success", () => resolve(), { once: true });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
    request.addEventListener("blocked", () => resolve(), { once: true });
  });
}

beforeEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await deletePlannerDatabase();
});

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await deletePlannerDatabase();
});

function createClock() {
  let value = 1_760_000_000_000;
  return () => {
    value += 1;
    return value;
  };
}

function createRandom(fill = 1) {
  return (length) => {
    const bytes = new Uint8Array(length);
    bytes.fill(fill);
    return bytes;
  };
}

function createChannel() {
  const messages = [];
  const listeners = new Set();
  return {
    messages,
    factory(name) {
      assert.equal(name, "tanikun-auth-v1");
      return {
        addEventListener(type, listener) {
          assert.equal(type, "message");
          listeners.add(listener);
        },
        removeEventListener(type, listener) {
          listeners.delete(listener);
        },
        postMessage(message) {
          messages.push(structuredClone(message));
          for (const listener of listeners)
            listener({ data: structuredClone(message) });
        },
        close() {
          listeners.clear();
        },
      };
    },
    emit(data) {
      for (const listener of listeners)
        listener({ data: structuredClone(data) });
    },
  };
}

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

async function readKey(databaseName, key) {
  const opening = indexedDB.open(databaseName, 1);
  const database = await requestDone(opening);
  try {
    const transaction = database.transaction("documents", "readonly");
    return await requestDone(transaction.objectStore("documents").get(key));
  } finally {
    database.close();
  }
}

async function writeKey(databaseName, key, value) {
  const opening = indexedDB.open(databaseName, 1);
  const database = await requestDone(opening);
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

function createStore({ fill = 1, channel = createChannel() } = {}) {
  const locks = [];
  const store = createAuthStateStore({
    indexedDB,
    channelFactory: channel.factory,
    randomBytes: createRandom(fill),
    now: createClock(),
    locks: {
      request(name, _options, operation) {
        locks.push(name);
        return operation();
      },
    },
  });
  stores.push(store);
  return { store, channel, locks };
}

test("session initialization stores only the accepted auth state shape", async () => {
  const { store, locks } = createStore();
  const state = await store.initialize({ mode: "session" });
  assert.deepEqual(Object.keys(state).toSorted(), [
    "accountHandle",
    "authVersion",
    "generation",
    "sessionState",
  ]);
  assert.equal(state.authVersion, 1);
  assert.equal(state.accountHandle, null);
  assert.equal(state.sessionState, "signed_out");
  assert.match(state.generation, /^[A-Za-z0-9_-]{22}$/u);
  assert.equal(JSON.stringify(state).includes("token"), false);
  assert.equal(JSON.stringify(state).includes("csrf"), false);
  assert.equal(locks.at(-1), "tanikun-auth-v1");
  const stored = await readKey("tanikun-planner", AUTH_STATE_KEY);
  assert.deepEqual(stored, state);
});

test("auth changes bump the generation, announce, and never store secrets", async () => {
  const { store, channel, locks } = createStore();
  const initial = await store.initialize({ mode: "session" });
  const alice = await store.write({
    accountHandle: HANDLE_ALICE,
    sessionState: "active",
  });
  assert.notEqual(alice.generation, initial.generation);
  assert.equal(alice.accountHandle, HANDLE_ALICE);
  assert.equal(alice.sessionState, "active");
  assert.equal(
    locks.filter((name) => name === "tanikun-auth-v1").length >= 2,
    true,
  );
  assert.equal(channel.messages.length, 1);
  assert.deepEqual(channel.messages[0], {
    type: "tanikun-auth-changed",
    state: alice,
  });
  assert.equal(JSON.stringify(channel.messages).includes("token"), false);
  assert.equal(JSON.stringify(channel.messages).includes("csrf"), false);

  const bob = await store.write({
    accountHandle: HANDLE_BOB,
    sessionState: "active",
  });
  assert.notEqual(bob.generation, alice.generation);
  assert.equal(bob.accountHandle, HANDLE_BOB);

  const reauth = await store.setSessionState("reauth_required");
  assert.equal(reauth.generation, bob.generation);
  assert.equal(reauth.accountHandle, HANDLE_BOB);
  assert.equal(reauth.sessionState, "reauth_required");

  const signedOut = await store.write({
    accountHandle: null,
    sessionState: "signed_out",
  });
  assert.equal(signedOut.accountHandle, null);
  assert.equal(signedOut.sessionState, "signed_out");
  assert.notEqual(signedOut.generation, bob.generation);
});

test("exact key layout follows the accepted account isolation contract", async () => {
  const { store } = createStore();
  await store.initialize({ mode: "session" });
  assert.equal(store.plannerKey({ accountHandle: null }), "planner");
  assert.equal(
    store.plannerKey({ accountHandle: HANDLE_ALICE }),
    `account:${HANDLE_ALICE}:planner`,
  );
  assert.equal(
    store.metadataKey({
      accountHandle: HANDLE_ALICE,
      apiOrigin: "https://localhost:4300",
      documentId: "document-1",
    }),
    "sync:" +
      JSON.stringify([HANDLE_ALICE, "https://localhost:4300", "document-1"]),
  );
  assert.equal(
    store.metadataKey({
      accountHandle: null,
      apiOrigin: "http://127.0.0.1:8787",
      documentId: "document-1",
    }),
    "sync:" + JSON.stringify(["http://127.0.0.1:8787", "document-1"]),
  );
  assert.equal(
    store.syncScope({
      accountHandle: HANDLE_ALICE,
      apiOrigin: "https://localhost:4300",
      documentId: "document-1",
    }),
    `${HANDLE_ALICE}|https://localhost:4300|document-1`,
  );
  assert.equal(
    store.syncScope({
      accountHandle: null,
      apiOrigin: "http://127.0.0.1:8787",
      documentId: "document-1",
    }),
    "http://127.0.0.1:8787:document-1",
  );
  assert.equal(
    store.syncLockName({
      accountHandle: HANDLE_ALICE,
      apiOrigin: "https://localhost:4300",
      documentId: "document-1",
    }),
    `tanikun-sync:${HANDLE_ALICE}:https://localhost:4300:document-1`,
  );
  assert.equal(
    store.syncLockName({
      accountHandle: null,
      apiOrigin: "http://127.0.0.1:8787",
      documentId: "document-1",
    }),
    "tanikun-sync:http://127.0.0.1:8787:document-1",
  );
});

test("validation rejects unknown keys, tokens, and inconsistent states", async () => {
  const { store } = createStore();
  await store.initialize({ mode: "session" });
  for (const value of [
    {
      authVersion: 1,
      generation: "A".repeat(22),
      accountHandle: null,
      sessionState: "signed_out",
      csrf_token: "secret",
    },
    {
      authVersion: 1,
      generation: "A".repeat(22),
      accountHandle: null,
      sessionState: "active",
    },
    {
      authVersion: 1,
      generation: "A".repeat(22),
      accountHandle: HANDLE_ALICE,
      sessionState: "signed_out",
    },
    {
      authVersion: 1,
      generation: "not-a-generation",
      accountHandle: HANDLE_ALICE,
      sessionState: "active",
    },
    {
      authVersion: 2,
      generation: "A".repeat(22),
      accountHandle: HANDLE_ALICE,
      sessionState: "active",
    },
  ]) {
    await writeKey("tanikun-planner", AUTH_STATE_KEY, value);
    await assert.rejects(
      store.read(),
      (error) =>
        error instanceof AuthStateError && error.code === "invalid_auth_state",
    );
  }
});

test("copying the unbound plan preserves both plans and marks a pending upload", async () => {
  const { store } = createStore();
  await store.initialize({ mode: "session" });
  const unbound = {
    storageVersion: 2,
    bytes: Uint8Array.from([1, 2, 3, 4]),
  };
  await writeKey("tanikun-planner", "planner", unbound);

  assert.equal(await store.copyUnboundToAccount(HANDLE_ALICE), true);
  const original = await readKey("tanikun-planner", "planner");
  const copied = await readKey(
    "tanikun-planner",
    `account:${HANDLE_ALICE}:planner`,
  );
  assert.deepEqual(original, unbound);
  assert.deepEqual(copied, unbound);
  assert.notEqual(copied.bytes, unbound.bytes);
  assert.equal(await store.isPendingUpload(HANDLE_ALICE), true);
  assert.equal(
    JSON.stringify(
      await readKey("tanikun-planner", `auth:upload:${HANDLE_ALICE}`),
    ),
    JSON.stringify({ pendingUpload: true }),
  );

  assert.equal(await store.copyUnboundToAccount(HANDLE_ALICE), false);
  assert.deepEqual(
    await readKey("tanikun-planner", `account:${HANDLE_ALICE}:planner`),
    unbound,
  );
  await store.setPendingUpload(HANDLE_ALICE, false);
  assert.equal(await store.isPendingUpload(HANDLE_ALICE), false);
});

test("declining copy leaves the unbound plan and starts without an account plan", async () => {
  const { store } = createStore();
  await store.initialize({ mode: "session" });
  const unbound = {
    storageVersion: 2,
    bytes: Uint8Array.from([9, 8, 7]),
  };
  await writeKey("tanikun-planner", "planner", unbound);
  assert.equal(await store.accountPlanExists(HANDLE_BOB), false);
  assert.equal(await store.isPendingUpload(HANDLE_BOB), false);
  assert.deepEqual(await readKey("tanikun-planner", "planner"), unbound);
});

test("broadcasts are optional and the store reports delivery without secrets", async () => {
  const { store, channel } = createStore();
  await store.initialize({ mode: "session" });
  const received = [];
  const unsubscribe = store.subscribe((state) => received.push(state));
  await store.write({
    accountHandle: HANDLE_ALICE,
    sessionState: "active",
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].accountHandle, HANDLE_ALICE);
  unsubscribe();
  channel.emit({ type: "ignored" });
  assert.equal(received.length, 1);

  const fallback = createAuthStateStore({
    indexedDB,
    channelFactory: null,
    randomBytes: createRandom(),
    locks: null,
  });
  const state = await fallback.initialize({ mode: "session" });
  assert.equal(state.authVersion, 1);
  fallback.close();
});

test("dev mode initializes no auth state", async () => {
  const { store } = createStore();
  assert.equal(await store.initialize({ mode: "dev_bearer" }), null);
  await assert.rejects(
    store.read(),
    (error) =>
      error instanceof AuthStateError && error.code === "invalid_auth_state",
  );
});
