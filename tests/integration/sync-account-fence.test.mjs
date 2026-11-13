import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as Automerge from "@automerge/automerge";
import { IDBFactory } from "fake-indexeddb";

import { buildSyncContract } from "../../scripts/build-sync-contract.mjs";

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");
const artifactDir = mkdtempSync(join(tmpdir(), "tanikun-sync-account-"));
after(() => rmSync(artifactDir, { recursive: true, force: true }));
copyFileSync(
  join(root, "apps/web/public/sync-coordinator.js"),
  join(artifactDir, "sync-coordinator.js"),
);
buildSyncContract(join(artifactDir, "sync-contract.mjs"));

globalThis.Automerge = Automerge;
globalThis["__TANIKUN_AUTH_AUTOSTART__"] = false;
await import("../../apps/web/public/planner-document.js");
await import("../../apps/web/public/persistence-transactions.js");
await import("../../apps/web/public/auth-state.js");
await import("../../apps/web/public/persistence.js");
await import("../../apps/web/public/sync-store.js");
await import("../../apps/web/public/sync-metadata.js");
await import(pathToFileURL(join(artifactDir, "sync-coordinator.js")).href);

const codec = globalThis.tanikunDocument;
const { createStorage } = globalThis.tanikunPersistence;
const { createTransactions } = globalThis.tanikunPersistenceTransactions;
const { createAuthStateStore } = globalThis.tanikunAuthStateModule;
const { createSyncStore } = globalThis.tanikunSyncStore;
const { createSyncMetadataStore } = globalThis.tanikunSyncMetadata;
const { createSyncCoordinator } = globalThis.tanikunSyncCoordinator;

const apiOrigin = "https://localhost:4300";
const aliceHandle = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const bobHandle = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI";
const aliceDocument = "11111111-1111-4111-8111-111111111111";
const bobDocument = "22222222-2222-4222-8222-222222222222";
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
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const envelope = (change, documentId) => {
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

function deterministicBytes(fill) {
  return (length) => {
    const bytes = new Uint8Array(length);
    bytes.fill(fill);
    return bytes;
  };
}

function fakeTransport({ documentId, page = () => null } = {}) {
  const calls = {
    bootstrap: 0,
    pushes: [],
    pulls: [],
  };
  const sequences = new Map();
  const entries = [];
  return {
    calls,
    async bootstrap() {
      calls.bootstrap += 1;
      return { kind: "bootstrapped", document_id: documentId, cursor: 0 };
    },
    async push(_documentId, envelopes) {
      calls.pushes.push(envelopes);
      const accepted = envelopes.map((item) => {
        if (!sequences.has(item.change_id)) {
          const sequence = entries.length + 1;
          sequences.set(item.change_id, sequence);
          entries.push({ envelope: item, sequence });
        }
        return {
          change_id: item.change_id,
          server_sequence: sequences.get(item.change_id),
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
      calls.pulls.push(options);
      const injected = page(options);
      if (injected) return injected;
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

async function createSessionContext({
  handle,
  fill,
  documentId,
  page,
  indexedDB = new IDBFactory(),
} = {}) {
  const auth = createAuthStateStore({
    indexedDB,
    channelFactory: null,
    randomBytes: deterministicBytes(fill),
  });
  await auth.initialize({ mode: "session" });
  const state = await auth.write({
    accountHandle: handle,
    sessionState: "active",
  });
  const transact = createTransactions({
    indexedDB,
    timers: { setTimeout, clearTimeout },
    timeout: 5_000,
  });
  const storage = createStorage({
    Automerge,
    codec,
    transact,
    scopeProvider: () => auth.currentScope(),
  });
  storage.configure(validSource);
  const syncStore = createSyncStore({ indexedDB });
  const metadataStore = createSyncMetadataStore({ indexedDB });
  const transport = fakeTransport({ documentId, page });
  const lockNames = [];
  const statuses = [];
  let fenceFailure = null;
  let verifyError = null;
  let verifyCalls = 0;
  const coordinator = createSyncCoordinator({
    storage,
    transport,
    apiOrigin,
    syncStore,
    metadataStore,
    accountHandle: handle,
    generation: state.generation,
    plannerKey: `account:${handle}:planner`,
    syncLockName: `tanikun-sync:${handle}:${apiOrigin}:${documentId}`,
    fence: async () => {
      if (fenceFailure)
        throw Object.assign(new Error("stale"), {
          code: fenceFailure,
        });
      const current = await auth.read();
      if (
        current.generation !== state.generation ||
        current.accountHandle !== handle
      )
        throw Object.assign(new Error("stale"), { code: "stale_account" });
    },
    verifySession: async () => {
      verifyCalls += 1;
      if (verifyError)
        throw Object.assign(new Error("verify"), {
          code: verifyError,
        });
    },
    locks: {
      request(name, _options, operation) {
        lockNames.push(name);
        return operation();
      },
    },
    onStatus: (status) => statuses.push(status),
  });
  return {
    indexedDB,
    auth,
    state,
    storage,
    syncStore,
    metadataStore,
    transport,
    coordinator,
    lockNames,
    statuses,
    setFenceFailure(value) {
      fenceFailure = value;
    },
    setVerifyError(value) {
      verifyError = value;
    },
    get verifyCalls() {
      return verifyCalls;
    },
    async readMetadata() {
      return metadataStore.read(
        "sync:" + JSON.stringify([handle, apiOrigin, documentId]),
      );
    },
  };
}

test("session sync uses the exact account metadata, outbox, and lock layout", async () => {
  const context = await createSessionContext({
    handle: aliceHandle,
    fill: 1,
    documentId: aliceDocument,
  });
  await context.storage.load();
  await context.storage.save(JSON.stringify(source));
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "synced");
  assert.deepEqual(context.lockNames, [
    `tanikun-sync:${aliceHandle}:${apiOrigin}:${aliceDocument}`,
  ]);
  assert.equal(context.transport.calls.pushes.length, 1);
  assert.equal(context.transport.calls.pushes[0].length >= 1, true);
  assert.deepEqual(
    await context.syncStore.listOutbox(
      `${aliceHandle}|${apiOrigin}|${aliceDocument}`,
    ),
    [],
  );
  const metadata = await context.readMetadata();
  assert.equal(metadata.observedHighWater >= 1, true);
  assert.equal(Object.hasOwn(metadata, "handle"), false);
});

test("a generation fence failure before bootstrap stops without binding", async () => {
  const context = await createSessionContext({
    handle: aliceHandle,
    fill: 1,
    documentId: aliceDocument,
  });
  context.setFenceFailure("stale_account");
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "error");
  assert.equal(result.code, "stale_account");
  assert.equal(context.transport.calls.bootstrap, 0);
  assert.equal(context.transport.calls.pulls.length, 0);
  assert.equal(context.transport.calls.pushes.length, 0);
});

test("a switch after bootstrap never binds the returned document", async () => {
  const context = await createSessionContext({
    handle: aliceHandle,
    fill: 1,
    documentId: aliceDocument,
  });
  const bootstrap = context.transport.bootstrap.bind(context.transport);
  context.transport.bootstrap = async () => {
    const result = await bootstrap();
    context.setFenceFailure("stale_account");
    return result;
  };
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "error");
  assert.equal(result.code, "stale_account");
  assert.equal(context.transport.calls.bootstrap, 1);
  assert.deepEqual(
    await context.syncStore.listOutbox(
      `${aliceHandle}|${apiOrigin}|${aliceDocument}`,
    ),
    [],
  );
  assert.equal(
    (
      await context.metadataStore.read(
        "sync:" + JSON.stringify([aliceHandle, apiOrigin, aliceDocument]),
      )
    ).observedHighWater,
    0,
  );
});

test("a switch while a pull is in flight leaves the planner and cursor untouched", async () => {
  const context = await createSessionContext({
    handle: aliceHandle,
    fill: 1,
    documentId: aliceDocument,
    page: () => ({
      kind: "pulled",
      document_id: aliceDocument,
      changes: [],
      next_cursor: 0,
      has_more: false,
      cursor: 0,
    }),
  });
  await context.storage.load();
  const pull = context.transport.pull.bind(context.transport);
  context.transport.pull = async (...args) => {
    const result = await pull(...args);
    context.setFenceFailure("stale_account");
    return result;
  };
  const result = await context.coordinator.sync();
  assert.equal(result.code, "stale_account");
  assert.equal(context.transport.calls.pushes.length, 0);
  assert.equal((await context.readMetadata()).observedHighWater, 0);
});

test("a switch after an append leaves the outbox unacknowledged", async () => {
  const context = await createSessionContext({
    handle: aliceHandle,
    fill: 1,
    documentId: aliceDocument,
  });
  await context.storage.load();
  await context.storage.save(JSON.stringify(source));
  const push = context.transport.push.bind(context.transport);
  context.transport.push = async (...args) => {
    const result = await push(...args);
    context.setFenceFailure("stale_account");
    return result;
  };
  const result = await context.coordinator.sync();
  assert.equal(result.code, "stale_account");
  const scope = `${aliceHandle}|${apiOrigin}|${aliceDocument}`;
  assert.equal((await context.syncStore.listOutbox(scope)).length >= 1, true);
  assert.equal((await context.readMetadata()).mergedCursor, 0);
});

test("server session verification fails closed before bootstrap", async () => {
  const context = await createSessionContext({
    handle: aliceHandle,
    fill: 1,
    documentId: aliceDocument,
  });
  context.setVerifyError("account_changed");
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "error");
  assert.equal(result.code, "account_changed");
  assert.equal(context.verifyCalls, 1);
  assert.equal(context.transport.calls.bootstrap, 0);

  context.setVerifyError("reauth_required");
  const reauth = await context.coordinator.sync();
  assert.equal(reauth.code, "reauth_required");
  assert.equal(context.verifyCalls, 2);
  assert.equal(context.transport.calls.bootstrap, 0);
});

test("one account never pushes, merges, or reuses another account's cursor", async () => {
  const alice = await createSessionContext({
    handle: aliceHandle,
    fill: 1,
    documentId: aliceDocument,
  });
  await alice.storage.load();
  await alice.storage.save(JSON.stringify(source));
  await alice.storage.save(
    JSON.stringify({ ...source, program_id: "alice-second" }),
  );
  assert.equal((await alice.coordinator.sync()).kind, "synced");
  const aliceCursor = (await alice.readMetadata()).observedHighWater;
  assert.equal(aliceCursor > 1, true);

  await alice.auth.write({ accountHandle: bobHandle, sessionState: "active" });
  const bob = await createSessionContext({
    handle: bobHandle,
    fill: 2,
    documentId: bobDocument,
    indexedDB: alice.indexedDB,
  });
  await bob.storage.load();
  await bob.storage.save(JSON.stringify({ ...source, program_id: "bob" }));
  const bobResult = await bob.coordinator.sync();
  assert.equal(bobResult.kind, "synced");
  assert.equal(bob.transport.calls.pushes.length, 1);
  assert.equal(bob.transport.calls.pushes[0].length >= 1, true);
  assert.equal(
    bob.transport.calls.pushes[0].some(
      (change) => change.document_id !== bobDocument,
    ),
    false,
  );
  const bobMetadata = await bob.readMetadata();
  assert.equal(bobMetadata.observedHighWater >= 1, true);
  assert.equal(
    bobMetadata.observedHighWater <
      (await alice.readMetadata()).observedHighWater,
    true,
  );
});

test("an unrelated server root stops with history_mismatch and preserves state", async () => {
  const foreign = Automerge.change(
    Automerge.init({ actor: "bb".repeat(32) }),
    (draft) => {
      draft.version = 1;
    },
  );
  const foreignChange = Automerge.getAllChanges(foreign)[0];
  const context = await createSessionContext({
    handle: aliceHandle,
    fill: 1,
    documentId: aliceDocument,
    page: () => ({
      kind: "pulled",
      document_id: aliceDocument,
      changes: [
        {
          ...envelope(foreignChange, aliceDocument),
          server_sequence: 1,
        },
      ],
      next_cursor: 1,
      has_more: false,
      cursor: 1,
    }),
  });
  await context.storage.load();
  await context.storage.save(JSON.stringify(source));
  const before = await context.storage.snapshot();
  const scope = `${aliceHandle}|${apiOrigin}|${aliceDocument}`;
  const outboxBefore = await context.syncStore.listOutbox(scope);
  const result = await context.coordinator.sync();
  assert.equal(result.kind, "error");
  assert.equal(result.code, "history_mismatch");
  const afterSnapshot = await context.storage.snapshot();
  assert.deepEqual(afterSnapshot.bytes, before.bytes);
  assert.deepEqual(await context.syncStore.listOutbox(scope), outboxBefore);
  assert.equal((await context.syncStore.seenHashes(scope)).size, 0);
  assert.equal((await context.readMetadata()).mergedCursor, 0);
  assert.equal(context.transport.calls.pushes.length, 0);
});
