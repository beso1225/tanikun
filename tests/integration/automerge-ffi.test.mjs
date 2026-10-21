import assert from "node:assert/strict";
import test from "node:test";

import "fake-indexeddb/auto";
import * as Automerge from "@automerge/automerge";

const databaseName = "tanikun-spike";
const storeName = "documents";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function withStore(mode, operation) {
  return openDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, mode);
        const request = operation(transaction.objectStore(storeName));
        transaction.oncomplete = () => {
          database.close();
          resolve(request?.result);
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error);
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error);
        };
      }),
  );
}

globalThis.__tanikunAutomerge = {
  create: () => Automerge.from({}),
  set: (doc, key, value) =>
    Automerge.change(Automerge.clone(doc), (draft) => {
      draft[key] = value;
    }),
  save: (doc) => Automerge.save(doc),
  load: (bytes) => Automerge.load(bytes),
  get: (doc, key) => doc[key],
  changes: (from, to) => Automerge.getChanges(from, to),
  apply: (doc, changes) => Automerge.applyChanges(doc, changes)[0],
  idbPut: (key, bytes) =>
    withStore("readwrite", (store) => store.put(bytes, key)),
  idbGet: (key) => withStore("readonly", (store) => store.get(key)),
};

const {
  apply_changes,
  create_doc,
  get_changes,
  get_field,
  idb_get,
  idb_put,
  load_doc,
  save_doc,
  set_field,
} =
  await import("../../_build/js/release/build/beso1225/tanikun-automerge-spike/tanikun-automerge-spike.js");

test("Bytes round-trip through Automerge save and load", () => {
  const doc = set_field(create_doc(), "course", "physics");
  const bytes = save_doc(doc);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(get_field(load_doc(bytes), "course"), "physics");
});

test("changes from two replicas merge through opaque handles", () => {
  const base = create_doc();
  const left = set_field(base, "left", "1");
  const right = set_field(base, "right", "2");
  const merged = apply_changes(left, get_changes(base, right));
  assert.equal(get_field(merged, "left"), "1");
  assert.equal(get_field(merged, "right"), "2");
});

test("IndexedDB stores and restores bytes through an exported promise", async () => {
  const doc = set_field(create_doc(), "term", "2026-spring");
  await idb_put("document-2", save_doc(doc));
  const restored = load_doc(await idb_get("document-2"));
  assert.equal(get_field(restored, "term"), "2026-spring");
});
