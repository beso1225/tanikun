import assert from "node:assert/strict";
import test from "node:test";

import * as Automerge from "@automerge/automerge";
import { IDBFactory } from "fake-indexeddb";

globalThis.Automerge = Automerge;
await import("../../apps/web/public/planner-document.js");
await import("../../apps/web/public/persistence-transactions.js");
await import("../../apps/web/public/persistence.js");
await import("../../apps/web/public/sync-store.js");
await import("../../apps/web/public/sync-metadata.js");
await import("../../apps/web/public/sync-coordinator.js");

const codec = globalThis.tanikunDocument;
const { createStorage } = globalThis.tanikunPersistence;
const { createTransactions } = globalThis.tanikunPersistenceTransactions;
const { createSyncStore } = globalThis.tanikunSyncStore;
const { createSyncMetadataStore } = globalThis.tanikunSyncMetadata;
const { createSyncCoordinator } = globalThis.tanikunSyncCoordinator;

const apiOrigin = "http://127.0.0.1:8787";
const documentId = "11111111-1111-4111-8111-111111111111";
const source = {
  version: 1,
  catalogue: [],
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

const bytesToBase64 = (bytes) => {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
};

const appendEnvelope = (change) => {
  const changeId = Automerge.decodeChange(change).hash;
  return {
    document_id: documentId,
    change_id: changeId,
    envelope_version: 1,
    payload_encoding: "base64",
    crypto_algorithm: "none",
    key_version: 0,
    nonce: null,
    aad: {
      api_version: 1,
      document_id: documentId,
      change_id: changeId,
      envelope_version: 1,
      key_version: 0,
    },
    payload: bytesToBase64(change),
  };
};

const storedEnvelope = (change, serverSequence) => ({
  ...appendEnvelope(change),
  server_sequence: serverSequence,
});

const openPlannerDatabase = (factory) =>
  new Promise((resolve, reject) => {
    const request = factory.open("tanikun-planner", 1);
    request.addEventListener(
      "upgradeneeded",
      () => {
        if (!request.result.objectStoreNames.contains("documents"))
          request.result.createObjectStore("documents");
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("planner open failed")),
      { once: true },
    );
  });

async function seedPlanner(factory, baseDocument) {
  const database = await openPlannerDatabase(factory);
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("documents", "readwrite");
    transaction
      .objectStore("documents")
      .put(
        { storageVersion: 2, bytes: Automerge.save(baseDocument) },
        "planner",
      );
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("seed failed")),
      { once: true },
    );
  });
  database.close();
}

function createFakeTransport() {
  const pushes = [];
  const pullCalls = [];
  const sequences = new Map();
  let cursor = 0;
  let pullHandler;
  return {
    pushes,
    pullCalls,
    setPull(handler) {
      pullHandler = handler;
    },
    async bootstrap() {
      return { kind: "bootstrapped", document_id: documentId, cursor: 0 };
    },
    async push(_documentId, envelopes) {
      pushes.push(envelopes);
      const accepted = envelopes.map((envelope) => {
        if (!sequences.has(envelope.change_id))
          sequences.set(envelope.change_id, ++cursor);
        return {
          change_id: envelope.change_id,
          server_sequence: sequences.get(envelope.change_id),
        };
      });
      return {
        kind: "pushed",
        document_id: documentId,
        accepted,
        cursor,
      };
    },
    async pull(_documentId, options) {
      pullCalls.push(options);
      if (pullHandler) return pullHandler(options);
      return {
        kind: "pulled",
        document_id: documentId,
        changes: [],
        next_cursor: options.after,
        has_more: false,
        cursor,
      };
    },
  };
}

async function setup() {
  const factory = new IDBFactory();
  const base = Automerge.clone(codec.update(null, JSON.stringify(source)), {
    actor: "aa".repeat(32),
  });
  const baseChanges = Automerge.getAllChanges(base);
  await seedPlanner(factory, base);
  const transact = createTransactions({
    indexedDB: factory,
    timers: { setTimeout, clearTimeout },
    timeout: 5_000,
  });
  const storage = createStorage({
    Automerge,
    codec,
    transact,
  });
  storage.configure(validSource);
  await storage.load();
  const syncStore = createSyncStore({ indexedDB: factory });
  const metadataStore = createSyncMetadataStore({ indexedDB: factory });
  const transport = createFakeTransport();
  const statuses = [];
  const coordinator = createSyncCoordinator({
    storage,
    transport,
    documentId,
    apiOrigin,
    syncStore,
    metadataStore,
    sleep: async () => {},
    random: () => 0,
    locks: null,
    onStatus: (status) => statuses.push(status),
  });
  return {
    factory,
    base,
    baseChanges,
    storage,
    syncStore,
    metadataStore,
    transport,
    coordinator,
    statuses,
  };
}

const metadataKey = () => "sync:" + JSON.stringify([apiOrigin, documentId]);

const waitFor = async (predicate, timeout = 2_000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for sync state");
};

test("pushes local changes and prunes the outbox after acknowledgement", async () => {
  const context = await setup();
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "synced");
  assert.equal(context.transport.pushes.length, 1);
  assert.equal(context.transport.pushes[0].length, 2);
  assert.deepEqual(
    context.transport.pushes[0].map((envelope) => envelope.change_id),
    context.baseChanges.map((change) => Automerge.decodeChange(change).hash),
  );
  assert.deepEqual(await context.syncStore.listOutbox(), []);
  const metadata = await context.metadataStore.read(metadataKey());
  assert.equal(metadata.mergedCursor, 0);
  assert.equal(metadata.observedHighWater, 2);
});

test("applies a dependency-valid remote page and never re-uploads it", async () => {
  const context = await setup();
  const remote = codec.update(
    Automerge.clone(context.base, { actor: "bb".repeat(32) }),
    JSON.stringify({ ...source, program_id: "remote" }),
  );
  const remoteChange = Automerge.getLastLocalChange(remote);
  context.transport.setPull(() => ({
    kind: "pulled",
    document_id: documentId,
    changes: [
      ...context.baseChanges.map((change, index) =>
        storedEnvelope(change, index + 1),
      ),
      storedEnvelope(remoteChange, 3),
    ],
    next_cursor: 3,
    has_more: false,
    cursor: 3,
  }));
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "synced");
  assert.equal(result.cursor, 3);
  const text = await context.storage.load();
  assert.equal(JSON.parse(text).program_id, "remote");
  const metadata = await context.metadataStore.read(metadataKey());
  assert.equal(metadata.mergedCursor, 3);
  assert.equal(metadata.observedHighWater, 3);
  assert.equal(context.transport.pushes.length, 1);
  const second = await context.coordinator.sync();
  assert.equal(second.kind, "synced");
  assert.equal(context.transport.pushes.length, 1);
  assert.deepEqual(await context.syncStore.listOutbox(), []);
});

test("fails closed on a missing dependency without advancing the cursor", async () => {
  const context = await setup();
  const independentBase = codec.update(null, JSON.stringify(source));
  const independent = codec.update(
    independentBase,
    JSON.stringify({ ...source, program_id: "independent" }),
  );
  const independentChange = Automerge.getLastLocalChange(independent);
  context.transport.setPull(() => ({
    kind: "pulled",
    document_id: documentId,
    changes: [storedEnvelope(independentChange, 3)],
    next_cursor: 3,
    has_more: false,
    cursor: 3,
  }));
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "error");
  assert.equal(result.code, "missing_dependency");
  const metadata = await context.metadataStore.read(metadataKey());
  assert.equal(metadata.mergedCursor, 0);
  assert.equal(metadata.observedHighWater, 3);
});

test("rejects a cursor rollback and leaves the merged cursor unchanged", async () => {
  const context = await setup();
  context.transport.setPull(() => ({
    kind: "pulled",
    document_id: documentId,
    changes: [],
    next_cursor: 0,
    has_more: false,
    cursor: 0,
  }));
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "error");
  assert.equal(result.code, "rollback");
  const metadata = await context.metadataStore.read(metadataKey());
  assert.equal(metadata.mergedCursor, 0);
  assert.equal(metadata.observedHighWater, 2);
});

test("keeps the outbox when acknowledgement fails and prunes after retry", async () => {
  const context = await setup();
  let fail = true;
  const flakyStore = {
    ...context.syncStore,
    async acknowledge(changeIds) {
      if (fail) {
        fail = false;
        throw new Error("acknowledgement failed");
      }
      return context.syncStore.acknowledge(changeIds);
    },
  };
  const coordinator = createSyncCoordinator({
    storage: context.storage,
    transport: context.transport,
    documentId,
    apiOrigin,
    syncStore: flakyStore,
    metadataStore: context.metadataStore,
    sleep: async () => {},
    random: () => 0,
    locks: null,
  });
  const first = await coordinator.sync();
  assert.equal(first.kind, "error");
  assert.equal((await context.syncStore.listOutbox()).length, 2);
  const second = await coordinator.sync();
  assert.equal(second.kind, "synced");
  assert.deepEqual(await context.syncStore.listOutbox(), []);
  assert.equal(context.transport.pushes.length, 2);
});

test("discard clears sync state and permits a fresh metadata read", async () => {
  const context = await setup();
  await context.coordinator.sync();
  await context.coordinator.discard();
  assert.deepEqual(await context.syncStore.listOutbox(), []);
  assert.deepEqual(await context.syncStore.seenHashes(), new Set());
  assert.deepEqual(await context.metadataStore.read(metadataKey()), {
    syncVersion: 1,
    mergedCursor: 0,
    observedHighWater: 0,
  });
});

test("metadata observation never regresses the cursor", async () => {
  const context = await setup();
  const key = metadataKey();
  await context.metadataStore.observe(key, 5);
  assert.equal((await context.metadataStore.read(key)).observedHighWater, 5);
  await assert.rejects(
    () => context.metadataStore.observe(key, 3),
    (error) => error.code === "rollback",
  );
});

test("enqueues a local save through the change hook and only pushes it once", async () => {
  const context = await setup();
  await context.storage.save(
    JSON.stringify({ ...source, program_id: "local" }),
  );
  await waitFor(async () => (await context.syncStore.listOutbox()).length >= 1);
  const first = await context.coordinator.sync();
  assert.equal(first.kind, "synced");
  assert.equal(context.transport.pushes[0].length, 3);

  await context.storage.save(
    JSON.stringify({ ...source, program_id: "local-again" }),
  );
  await waitFor(
    async () => (await context.syncStore.listOutbox()).length === 1,
  );
  const second = await context.coordinator.sync();
  assert.equal(second.kind, "synced");
  assert.equal(context.transport.pushes.at(-1).length, 1);
  assert.deepEqual(await context.syncStore.listOutbox(), []);
});

test("leaves the cursor and planner unchanged when the page commit fails", async () => {
  const context = await setup();
  const remote = codec.update(
    Automerge.clone(context.base, { actor: "bb".repeat(32) }),
    JSON.stringify({ ...source, program_id: "retry-remote" }),
  );
  const remoteChange = Automerge.getLastLocalChange(remote);
  context.transport.setPull(() => ({
    kind: "pulled",
    document_id: documentId,
    changes: [
      ...context.baseChanges.map((change, index) =>
        storedEnvelope(change, index + 1),
      ),
      storedEnvelope(remoteChange, 3),
    ],
    next_cursor: 3,
    has_more: false,
    cursor: 3,
  }));
  let fail = true;
  const flakyMetadata = {
    ...context.metadataStore,
    async applyPage(options) {
      if (fail) {
        fail = false;
        throw new Error("page commit failed");
      }
      return context.metadataStore.applyPage(options);
    },
  };
  const coordinator = createSyncCoordinator({
    storage: context.storage,
    transport: context.transport,
    documentId,
    apiOrigin,
    syncStore: context.syncStore,
    metadataStore: flakyMetadata,
    sleep: async () => {},
    random: () => 0,
    locks: null,
  });
  const first = await coordinator.sync();
  assert.equal(first.kind, "error");
  const afterFailure = await context.metadataStore.read(metadataKey());
  assert.equal(afterFailure.mergedCursor, 0);
  assert.equal(afterFailure.observedHighWater, 3);
  assert.equal(
    JSON.parse(await context.storage.load()).program_id,
    "fictional",
  );

  const second = await coordinator.sync();
  assert.equal(second.kind, "synced");
  assert.equal(second.cursor, 3);
  assert.equal(
    JSON.parse(await context.storage.load()).program_id,
    "retry-remote",
  );
});

test("reports a server gap as a closed error without advancing the cursor", async () => {
  const context = await setup();
  context.transport.setPull(() => ({
    kind: "conflict",
    status: 409,
    code: "log_gap",
    cursor: 2,
    retryable: false,
  }));
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "error");
  assert.equal(result.code, "conflict");
  const metadata = await context.metadataStore.read(metadataKey());
  assert.equal(metadata.mergedCursor, 0);
  assert.equal(metadata.observedHighWater, 2);
});

test("runs under the per-document Web Lock and reports lifecycle status", async () => {
  const context = await setup();
  const lockCalls = [];
  const locks = {
    async request(name, _options, callback) {
      lockCalls.push(name);
      return callback();
    },
  };
  const statuses = [];
  const coordinator = createSyncCoordinator({
    storage: context.storage,
    transport: context.transport,
    documentId,
    apiOrigin,
    syncStore: context.syncStore,
    metadataStore: context.metadataStore,
    locks,
    sleep: async () => {},
    random: () => 0,
    onStatus: (status) => statuses.push(status.state),
  });
  const result = await coordinator.sync();
  assert.equal(result.kind, "synced");
  assert.deepEqual(lockCalls, [`tanikun-sync:${apiOrigin}:${documentId}`]);
  assert.ok(statuses.includes("syncing"));
  assert.ok(statuses.includes("synced"));
});

test("keeps sync metadata out of the source and the version 2 envelope", async () => {
  const context = await setup();
  await context.coordinator.sync();
  const text = await context.storage.load();
  const parsed = JSON.parse(text);
  assert.equal(parsed.syncVersion, undefined);
  assert.equal(parsed.mergedCursor, undefined);
  assert.equal(parsed.observedHighWater, undefined);

  const database = await openPlannerDatabase(context.factory);
  const record = await new Promise((resolve, reject) => {
    const transaction = database.transaction("documents", "readonly");
    const request = transaction.objectStore("documents").get("planner");
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("planner read failed")),
      { once: true },
    );
  });
  database.close();
  assert.deepEqual(Object.keys(record).toSorted(), ["bytes", "storageVersion"]);
  assert.equal(record.storageVersion, 2);
  assert.ok(record.bytes instanceof Uint8Array);
});

test("resync resets the cursor and re-pulls without re-uploading the page", async () => {
  const context = await setup();
  const remote = codec.update(
    Automerge.clone(context.base, { actor: "bb".repeat(32) }),
    JSON.stringify({ ...source, program_id: "resync-remote" }),
  );
  const remoteChange = Automerge.getLastLocalChange(remote);
  context.transport.setPull(() => ({
    kind: "pulled",
    document_id: documentId,
    changes: [
      ...context.baseChanges.map((change, index) =>
        storedEnvelope(change, index + 1),
      ),
      storedEnvelope(remoteChange, 3),
    ],
    next_cursor: 3,
    has_more: false,
    cursor: 3,
  }));
  await context.coordinator.sync();
  assert.equal(context.transport.pushes.length, 1);
  const result = await context.coordinator.resync();
  assert.equal(result.kind, "synced");
  assert.equal(result.cursor, 3);
  assert.equal(context.transport.pushes.length, 1);
  assert.equal(
    (await context.metadataStore.read(metadataKey())).mergedCursor,
    3,
  );
});

test("bootstraps a document when no ID is supplied", async () => {
  const context = await setup();
  const coordinator = createSyncCoordinator({
    storage: context.storage,
    transport: context.transport,
    apiOrigin,
    syncStore: context.syncStore,
    metadataStore: context.metadataStore,
    sleep: async () => {},
    random: () => 0,
    locks: null,
  });
  const result = await coordinator.sync();
  assert.equal(result.kind, "synced");
  assert.equal(coordinator.documentId(), documentId);
  assert.equal(context.transport.pushes.length, 1);
});

test("retries transient results with bounded jitter and Retry-After", async () => {
  const context = await setup();
  const originalPush = context.transport.push.bind(context.transport);
  let attempts = 0;
  context.transport.push = async (...args) => {
    attempts += 1;
    if (attempts === 1) {
      return {
        kind: "server_error",
        status: 503,
        code: "temporarily_unavailable",
        retryable: true,
        retry_after: 2,
      };
    }
    return originalPush(...args);
  };
  const delays = [];
  const coordinator = createSyncCoordinator({
    storage: context.storage,
    transport: context.transport,
    documentId,
    apiOrigin,
    syncStore: context.syncStore,
    metadataStore: context.metadataStore,
    sleep: async (milliseconds) => delays.push(milliseconds),
    random: () => 0,
    locks: null,
  });
  const result = await coordinator.sync();
  assert.equal(result.kind, "synced");
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [2_000]);
});
