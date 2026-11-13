import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as Automerge from "@automerge/automerge";
import { IDBFactory } from "fake-indexeddb";

import { SYNC_LIMITS } from "../../packages/sync-contract/contract.mjs";
import { buildSyncContract } from "../../scripts/build-sync-contract.mjs";

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");
// The coordinator loads the shared contract lazily, so its artifact needs the
// same two-file copy that `just build-web` produces.
const artifactDir = mkdtempSync(join(tmpdir(), "tanikun-sync-coordinator-"));
after(() => rmSync(artifactDir, { recursive: true, force: true }));
copyFileSync(
  join(root, "apps/web/public/sync-coordinator.js"),
  join(artifactDir, "sync-coordinator.js"),
);
buildSyncContract(join(artifactDir, "sync-contract.mjs"));

globalThis.Automerge = Automerge;
await import("../../apps/web/public/planner-document.js");
await import("../../apps/web/public/persistence-transactions.js");
await import("../../apps/web/public/persistence.js");
await import("../../apps/web/public/sync-store.js");
await import("../../apps/web/public/sync-metadata.js");
await import(pathToFileURL(join(artifactDir, "sync-coordinator.js")).href);

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

async function seedLegacyPlanner(factory, text) {
  const database = await openPlannerDatabase(factory);
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("documents", "readwrite");
    transaction.objectStore("documents").put(text, "planner");
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("legacy seed failed")),
      { once: true },
    );
  });
  database.close();
}

function createFakeTransport() {
  const pushes = [];
  const pullCalls = [];
  const sequences = new Map();
  const entries = [];
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
        if (!sequences.has(envelope.change_id)) {
          const sequence = entries.length + 1;
          sequences.set(envelope.change_id, sequence);
          entries.push({ envelope, sequence });
        }
        return {
          change_id: envelope.change_id,
          server_sequence: sequences.get(envelope.change_id),
        };
      });
      return {
        kind: "pushed",
        document_id: documentId,
        accepted,
        cursor: entries.length,
      };
    },
    async pull(_documentId, options) {
      pullCalls.push(options);
      if (pullHandler) return pullHandler(options);
      const cursor = entries.length;
      const rows = entries
        .filter((entry) => entry.sequence > options.after)
        .slice(0, options.limit);
      const nextCursor = rows.length ? rows.at(-1).sequence : options.after;
      return {
        kind: "pulled",
        document_id: documentId,
        changes: rows.map((entry) => ({
          ...entry.envelope,
          server_sequence: entry.sequence,
        })),
        next_cursor: nextCursor,
        has_more: nextCursor < cursor,
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
const syncScope = `${apiOrigin}:${documentId}`;

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
  assert.deepEqual(await context.syncStore.listOutbox(syncScope), []);
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
  context.transport.setPull((options) =>
    options.after >= 3
      ? {
          kind: "pulled",
          document_id: documentId,
          changes: [],
          next_cursor: 3,
          has_more: false,
          cursor: 3,
        }
      : {
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
        },
  );
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "synced");
  assert.equal(result.cursor, 3);
  const text = await context.storage.load();
  assert.equal(JSON.parse(text).program_id, "remote");
  const metadata = await context.metadataStore.read(metadataKey());
  assert.equal(metadata.mergedCursor, 3);
  assert.equal(metadata.observedHighWater, 3);
  assert.equal(context.transport.pushes.length, 0);
  const second = await context.coordinator.sync();
  assert.equal(second.kind, "synced");
  assert.equal(context.transport.pushes.length, 0);
  assert.deepEqual(await context.syncStore.listOutbox(syncScope), []);
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
  assert.equal(context.transport.pushes.length, 0);
});

test("rejects a cursor rollback and leaves the merged cursor unchanged", async () => {
  const context = await setup();
  await context.metadataStore.observe(metadataKey(), 5);
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
  assert.equal(metadata.observedHighWater, 5);
});

test("keeps the outbox when acknowledgement fails and prunes after retry", async () => {
  const context = await setup();
  let fail = true;
  const flakyStore = {
    ...context.syncStore,
    async acknowledge(scope, changeIds) {
      if (fail) {
        fail = false;
        throw new Error("acknowledgement failed");
      }
      return context.syncStore.acknowledge(scope, changeIds);
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
  assert.equal((await context.syncStore.listOutbox(syncScope)).length, 2);
  const second = await coordinator.sync();
  assert.equal(second.kind, "synced");
  assert.deepEqual(await context.syncStore.listOutbox(syncScope), []);
  assert.equal(context.transport.pushes.length, 2);
});

test("discard clears the planner and sync state without re-uploading history", async () => {
  const context = await setup();
  await context.coordinator.sync();
  const pushes = context.transport.pushes.length;
  await context.coordinator.discard();
  assert.equal(await context.storage.load(), null);
  assert.deepEqual(await context.syncStore.listOutbox(syncScope), []);
  assert.deepEqual(await context.syncStore.seenHashes(syncScope), new Set());
  assert.deepEqual(await context.metadataStore.read(metadataKey()), {
    syncVersion: 1,
    mergedCursor: 0,
    observedHighWater: 0,
  });
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "synced");
  assert.equal(context.transport.pushes.length, pushes);
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
  await waitFor(
    async () => (await context.syncStore.listOutbox(syncScope)).length >= 1,
  );
  const first = await context.coordinator.sync();
  assert.equal(first.kind, "synced");
  assert.equal(context.transport.pushes[0].length, 3);

  await context.storage.save(
    JSON.stringify({ ...source, program_id: "local-again" }),
  );
  await waitFor(
    async () => (await context.syncStore.listOutbox(syncScope)).length === 1,
  );
  const second = await context.coordinator.sync();
  assert.equal(second.kind, "synced");
  assert.equal(context.transport.pushes.at(-1).length, 1);
  assert.deepEqual(await context.syncStore.listOutbox(syncScope), []);
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
  assert.equal(result.code, "log_gap");
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

test("rejects an independent Automerge root instead of merging histories", async () => {
  const context = await setup();
  const independent = codec.update(null, JSON.stringify(source));
  const changes = Automerge.getAllChanges(independent);
  context.transport.setPull(() => ({
    kind: "pulled",
    document_id: documentId,
    changes: changes.map((change, index) => storedEnvelope(change, index + 1)),
    next_cursor: changes.length,
    has_more: false,
    cursor: changes.length,
  }));
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "error");
  assert.equal(result.code, "history_mismatch");
  const metadata = await context.metadataStore.read(metadataKey());
  assert.equal(metadata.mergedCursor, 0);
  assert.equal(metadata.observedHighWater, 2);
  assert.equal(
    JSON.parse(await context.storage.load()).program_id,
    "fictional",
  );
  assert.equal(context.transport.pushes.length, 0);
});

test("splits an oversized append batch instead of stalling the outbox", async () => {
  const context = await setup();
  const originalPush = context.transport.push.bind(context.transport);
  let calls = 0;
  context.transport.push = async (id, envelopes) => {
    calls += 1;
    if (envelopes.length > 1) {
      return {
        kind: "invalid_request",
        code: "request_too_large",
        retryable: false,
      };
    }
    return originalPush(id, envelopes);
  };
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "synced");
  assert.equal(calls, 3);
  assert.deepEqual(await context.syncStore.listOutbox(syncScope), []);
});

test("rejects a page when another tab replaced the planner", async () => {
  const context = await setup();
  const remote = codec.update(
    Automerge.clone(context.base, { actor: "bb".repeat(32) }),
    JSON.stringify({ ...source, program_id: "competing-remote" }),
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
  const flakyMetadata = {
    ...context.metadataStore,
    async applyPage(options) {
      await context.storage.save(
        JSON.stringify({ ...source, program_id: "competing-local" }),
      );
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
  const result = await coordinator.sync();
  assert.equal(result.kind, "error");
  assert.equal(result.code, "stale_planner");
  assert.equal(
    JSON.parse(await context.storage.load()).program_id,
    "competing-local",
  );
});

test("a fresh client adopts server history before uploading anything", async () => {
  const context = await setup();
  await context.storage.discard();
  const remote = codec.update(
    Automerge.clone(context.base, { actor: "bb".repeat(32) }),
    JSON.stringify({ ...source, program_id: "server-history" }),
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
  assert.equal(
    JSON.parse(await context.storage.load()).program_id,
    "server-history",
  );
  assert.equal(context.transport.pushes.length, 0);
});

test("rejects inconsistent cursor fields before committing a page", async () => {
  const context = await setup();
  context.transport.setPull(() => ({
    kind: "pulled",
    document_id: documentId,
    changes: context.baseChanges.map((change, index) =>
      storedEnvelope(change, index + 1),
    ),
    next_cursor: 4,
    has_more: false,
    cursor: 3,
  }));
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "error");
  assert.equal(result.code, "inconsistent_cursor");
  const metadata = await context.metadataStore.read(metadataKey());
  assert.equal(metadata.mergedCursor, 0);
  assert.equal(metadata.observedHighWater, 0);
});

test("keeps outbox entries scoped to their origin and document", async () => {
  const context = await setup();
  await context.syncStore.enqueue("other-scope", [
    {
      change_id: "a".repeat(64),
      envelope: { document_id: "other-document" },
      order: 0,
    },
  ]);
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "synced");
  assert.equal(context.transport.pushes[0].length, 2);
  assert.equal((await context.syncStore.listOutbox("other-scope")).length, 1);
  assert.deepEqual(await context.syncStore.listOutbox(syncScope), []);
});

test("retains the outbox through offline retry exhaustion and reconnects", async () => {
  const context = await setup();
  const originalPush = context.transport.push.bind(context.transport);
  let offline = true;
  context.transport.push = async (...args) =>
    offline ? { kind: "offline", retryable: true } : originalPush(...args);
  const statuses = [];
  const coordinator = createSyncCoordinator({
    storage: context.storage,
    transport: context.transport,
    documentId,
    apiOrigin,
    syncStore: context.syncStore,
    metadataStore: context.metadataStore,
    maxRetry: 2,
    sleep: async () => {},
    random: () => 0,
    locks: null,
    onStatus: (status) => statuses.push(status.state),
  });
  const first = await coordinator.sync();
  assert.equal(first.kind, "offline");
  assert.ok(statuses.includes("offline"));
  assert.equal((await context.syncStore.listOutbox(syncScope)).length, 2);
  offline = false;
  const second = await coordinator.sync();
  assert.equal(second.kind, "synced");
  assert.deepEqual(await context.syncStore.listOutbox(syncScope), []);
  assert.equal(context.transport.pushes.length, 1);
});

test("two coordinators under one lock keep the cursor monotonic", async () => {
  const context = await setup();
  const transact = createTransactions({
    indexedDB: context.factory,
    timers: { setTimeout, clearTimeout },
    timeout: 5_000,
  });
  const storage = createStorage({ Automerge, codec, transact });
  storage.configure(validSource);
  await storage.load();
  const lockState = new Map();
  const locks = {
    request(name, _options, callback) {
      const previous = lockState.get(name) ?? Promise.resolve();
      const current = previous.then(() => callback());
      lockState.set(
        name,
        current.catch(() => {}),
      );
      return current;
    },
  };
  const first = createSyncCoordinator({
    storage: context.storage,
    transport: context.transport,
    documentId,
    apiOrigin,
    syncStore: context.syncStore,
    metadataStore: context.metadataStore,
    locks,
    sleep: async () => {},
    random: () => 0,
  });
  const second = createSyncCoordinator({
    storage,
    transport: context.transport,
    documentId,
    apiOrigin,
    syncStore: context.syncStore,
    metadataStore: context.metadataStore,
    locks,
    sleep: async () => {},
    random: () => 0,
  });
  const [left, right] = await Promise.all([first.sync(), second.sync()]);
  assert.equal(left.kind, "synced");
  assert.equal(right.kind, "synced");
  const metadata = await context.metadataStore.read(metadataKey());
  assert.equal(metadata.mergedCursor, 2);
  assert.ok(metadata.observedHighWater >= 2);
  assert.deepEqual(await context.syncStore.listOutbox(syncScope), []);
  assert.equal(context.transport.pushes.length, 1);
});

test("continues across multiple pull pages and refreshes the planner CAS", async () => {
  const context = await setup();
  const remote1Document = codec.update(
    Automerge.clone(context.base, { actor: "bb".repeat(32) }),
    JSON.stringify({ ...source, program_id: "remote-1" }),
  );
  const remote1 = Automerge.getLastLocalChange(remote1Document);
  const remote2Document = codec.update(
    remote1Document,
    JSON.stringify({ ...source, program_id: "remote-2" }),
  );
  const remote2 = Automerge.getLastLocalChange(remote2Document);
  context.transport.setPull((options) => {
    if (options.after === 0) {
      return {
        kind: "pulled",
        document_id: documentId,
        changes: context.baseChanges.map((change, index) =>
          storedEnvelope(change, index + 1),
        ),
        next_cursor: 2,
        has_more: true,
        cursor: 4,
      };
    }
    if (options.after === 2) {
      return {
        kind: "pulled",
        document_id: documentId,
        changes: [storedEnvelope(remote1, 3), storedEnvelope(remote2, 4)],
        next_cursor: 4,
        has_more: false,
        cursor: 4,
      };
    }
    return {
      kind: "pulled",
      document_id: documentId,
      changes: [],
      next_cursor: options.after,
      has_more: false,
      cursor: 4,
    };
  });
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "synced");
  assert.equal(result.cursor, 4);
  assert.deepEqual(
    context.transport.pullCalls.map((call) => call.after),
    [0, 2],
  );
  assert.deepEqual(
    context.transport.pullCalls.map((call) => call.limit),
    [SYNC_LIMITS.maxPageChanges, SYNC_LIMITS.maxPageChanges],
  );
  assert.equal(JSON.parse(await context.storage.load()).program_id, "remote-2");
  const metadata = await context.metadataStore.read(metadataKey());
  assert.equal(metadata.mergedCursor, 4);
  assert.equal(metadata.observedHighWater, 4);
});

test("reports a legacy planner as not migrated without touching it", async () => {
  const context = await setup();
  const legacy = JSON.stringify(source);
  await seedLegacyPlanner(context.factory, legacy);
  await context.storage.load();
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "error");
  assert.equal(result.code, "planner_not_migrated");

  const database = await openPlannerDatabase(context.factory);
  const stored = await new Promise((resolve, reject) => {
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
  assert.equal(stored, legacy);
});

test("syncs with a legacy custom transport that omits limits", async () => {
  const context = await setup();
  // A pre-existing direct caller passes only the transport methods. It must
  // not need a new limits object, and the sync lifecycle loads the shared
  // wire values lazily.
  const legacyTransport = {
    bootstrap: () => context.transport.bootstrap(),
    push: (id, envelopes) => context.transport.push(id, envelopes),
    pull: (id, options) => context.transport.pull(id, options),
  };
  const coordinator = createSyncCoordinator({
    storage: context.storage,
    transport: legacyTransport,
    documentId,
    apiOrigin,
    syncStore: context.syncStore,
    metadataStore: context.metadataStore,
    sleep: async () => {},
    random: () => 0,
    locks: null,
  });
  assert.equal(SYNC_LIMITS.maxBatchChanges, 20);
  assert.equal(SYNC_LIMITS.maxPageChanges, 100);
  for (let index = 0; index < 45; index += 1) {
    await context.storage.save(
      JSON.stringify({ ...source, program_id: `legacy-${index}` }),
    );
  }
  await waitFor(
    async () => (await context.syncStore.listOutbox(syncScope)).length >= 45,
  );
  const result = await coordinator.sync();
  assert.equal(result.kind, "synced");
  assert.deepEqual(
    context.transport.pushes.map((batch) => batch.length),
    [20, 20, 7],
  );
  assert.equal(context.transport.pullCalls[0].limit, 100);
  assert.deepEqual(await context.syncStore.listOutbox(syncScope), []);
});

test("pushes a large local history in bounded batches", async () => {
  const context = await setup();
  const batchLimit = SYNC_LIMITS.maxBatchChanges;
  const localSaves = batchLimit * 2 + 5;
  for (let index = 0; index < localSaves; index += 1) {
    await context.storage.save(
      JSON.stringify({ ...source, program_id: `large-${index}` }),
    );
  }
  await waitFor(
    async () =>
      (await context.syncStore.listOutbox(syncScope)).length >= localSaves,
  );
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "synced");
  assert.deepEqual(
    context.transport.pushes.map((batch) => batch.length),
    [batchLimit, batchLimit, context.baseChanges.length + 5],
  );
  assert.deepEqual(await context.syncStore.listOutbox(syncScope), []);
});

test("discard drains an in-flight save before clearing the outbox", async () => {
  const context = await setup();
  const originalSeen = context.syncStore.seenHashes.bind(context.syncStore);
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  let started;
  const seenStarted = new Promise((resolve) => {
    started = resolve;
  });
  const wrappedStore = {
    ...context.syncStore,
    async seenHashes(scope) {
      started();
      await blocked;
      return originalSeen(scope);
    },
  };
  const coordinator = createSyncCoordinator({
    storage: context.storage,
    transport: context.transport,
    documentId,
    apiOrigin,
    syncStore: wrappedStore,
    metadataStore: context.metadataStore,
    sleep: async () => {},
    random: () => 0,
    locks: null,
  });
  const save = context.storage.save(
    JSON.stringify({ ...source, program_id: "during-discard" }),
  );
  await seenStarted;
  const discard = coordinator.discard();
  release();
  await Promise.all([save, discard]);
  assert.equal(await context.storage.load(), null);
  assert.deepEqual(await context.syncStore.listOutbox(syncScope), []);
  const pushes = context.transport.pushes.length;
  const result = await coordinator.sync();
  assert.equal(result.kind, "synced");
  assert.equal(context.transport.pushes.length, pushes);
});

test("discard handles a save queued before its hook starts", async () => {
  const context = await setup();
  const save = context.storage.save(
    JSON.stringify({ ...source, program_id: "queued-before-discard" }),
  );
  const discard = context.coordinator.discard();
  await Promise.all([save, discard]);
  assert.equal(await context.storage.load(), null);
  assert.deepEqual(await context.syncStore.listOutbox(syncScope), []);
  const pushes = context.transport.pushes.length;
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "synced");
  assert.equal(context.transport.pushes.length, pushes);
});

test("recovers metadata ahead of a missing planner after an interrupted discard", async () => {
  const context = await setup();
  await context.metadataStore.observe(metadataKey(), 2);
  await context.storage.discard();
  context.transport.setPull((options) =>
    options.after === 0
      ? {
          kind: "pulled",
          document_id: documentId,
          changes: context.baseChanges.map((change, index) =>
            storedEnvelope(change, index + 1),
          ),
          next_cursor: 2,
          has_more: false,
          cursor: 2,
        }
      : {
          kind: "pulled",
          document_id: documentId,
          changes: [],
          next_cursor: options.after,
          has_more: false,
          cursor: 2,
        },
  );
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "synced");
  assert.equal(result.cursor, 2);
  assert.equal(
    JSON.parse(await context.storage.load()).program_id,
    "fictional",
  );
  const metadata = await context.metadataStore.read(metadataKey());
  assert.equal(metadata.mergedCursor, 2);
  assert.equal(metadata.observedHighWater, 2);
});

test("does not re-upload a discarded plan after a failed discard clear", async () => {
  const context = await setup();
  const originalClear = context.syncStore.clear.bind(context.syncStore);
  let fail = true;
  const flakyStore = {
    ...context.syncStore,
    async clear(scope) {
      if (fail) {
        fail = false;
        throw new Error("clear failed");
      }
      return originalClear(scope);
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
  await context.storage.save(
    JSON.stringify({ ...source, program_id: "discard-failure" }),
  );
  await waitFor(
    async () => (await context.syncStore.listOutbox(syncScope)).length >= 1,
  );
  await assert.rejects(coordinator.discard());
  assert.equal(await context.storage.load(), null);
  assert.equal((await context.syncStore.listOutbox(syncScope)).length, 1);
  const pushes = context.transport.pushes.length;
  const result = await coordinator.sync();
  assert.equal(result.kind, "synced");
  assert.equal(context.transport.pushes.length, pushes);
  assert.deepEqual(await context.syncStore.listOutbox(syncScope), []);
});

test("fails closed when a fresh seed follows an interrupted discard", async () => {
  const context = await setup();
  context.transport.setPull((options) =>
    options.after === 0
      ? {
          kind: "pulled",
          document_id: documentId,
          changes: context.baseChanges.map((change, index) =>
            storedEnvelope(change, index + 1),
          ),
          next_cursor: 2,
          has_more: false,
          cursor: 2,
        }
      : {
          kind: "pulled",
          document_id: documentId,
          changes: [],
          next_cursor: options.after,
          has_more: false,
          cursor: 2,
        },
  );
  assert.equal((await context.coordinator.sync()).kind, "synced");
  assert.equal(
    (await context.metadataStore.read(metadataKey())).mergedCursor,
    2,
  );
  await context.storage.discard();
  await context.storage.save(
    JSON.stringify({ ...source, program_id: "fresh-seed" }),
  );
  await waitFor(
    async () => (await context.syncStore.listOutbox(syncScope)).length >= 1,
  );
  const pushes = context.transport.pushes.length;
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "error");
  assert.equal(result.code, "history_mismatch");
  assert.equal(context.transport.pushes.length, pushes);
  assert.equal(
    (await context.syncStore.listOutbox(syncScope)).length >= 1,
    true,
  );
  assert.equal(
    JSON.parse(await context.storage.load()).program_id,
    "fresh-seed",
  );
  assert.equal(
    (await context.metadataStore.read(metadataKey())).mergedCursor,
    2,
  );
  assert.equal((await context.syncStore.seenHashes(syncScope)).size > 0, true);
});

test("rate limits retry bootstrap, pull, and identical push envelopes after Retry-After", async () => {
  for (const operation of ["bootstrap", "pull", "push"]) {
    const context = await setup();
    const original = context.transport[operation].bind(context.transport);
    let attempts = 0;
    const requests = [];
    context.transport[operation] = async (...args) => {
      attempts += 1;
      requests.push(structuredClone(args));
      return attempts === 1
        ? {
            kind: "rate_limited",
            code: "rate_limited",
            retryable: true,
            retry_after: 2,
          }
        : original(...args);
    };
    const delays = [];
    const coordinator = createSyncCoordinator({
      storage: context.storage,
      transport: context.transport,
      ...(operation === "bootstrap" ? {} : { documentId }),
      apiOrigin,
      syncStore: context.syncStore,
      metadataStore: context.metadataStore,
      sleep: async (ms) => delays.push(ms),
      random: () => 0,
      locks: null,
    });
    assert.equal((await coordinator.sync()).kind, "synced");
    assert.equal(attempts, 2);
    assert.deepEqual(requests[0], requests[1]);
    assert.deepEqual(delays, [2000]);
  }
});

test("rate-limit retry exhaustion preserves the outbox and cooldown metadata", async () => {
  const context = await setup();
  let attempts = 0;
  context.transport.push = async () => {
    attempts += 1;
    return {
      kind: "rate_limited",
      code: "rate_limited",
      retryable: true,
      retry_after: 2,
    };
  };
  const delays = [];
  const statuses = [];
  const coordinator = createSyncCoordinator({
    storage: context.storage,
    transport: context.transport,
    documentId,
    apiOrigin,
    syncStore: context.syncStore,
    metadataStore: context.metadataStore,
    maxRetry: 2,
    sleep: async (ms) => delays.push(ms),
    random: () => 0,
    locks: null,
    onStatus: (status) => statuses.push(status),
  });
  assert.deepEqual(await coordinator.sync(), {
    kind: "error",
    code: "rate_limited",
    retry_after: 2,
  });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [2000, 2000]);
  assert.equal(statuses.at(-1).retry_after, 2);
  assert.equal((await context.syncStore.listOutbox(syncScope)).length, 2);
});
