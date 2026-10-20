///|
extern "js" fn install_bridge() -> @js_async.Promise[Unit] =
  #| () => (async () => {
  #|   const Automerge = await import("@automerge/automerge");
  #|   const { indexedDB } = await import("fake-indexeddb");
  #|   globalThis.indexedDB = indexedDB;
  #|   const databaseName = "tanikun-spike";
  #|   const storeName = "documents";
  #|   const openDatabase = () => new Promise((resolve, reject) => {
  #|     const request = indexedDB.open(databaseName, 1);
  #|     request.onupgradeneeded = () => request.result.createObjectStore(storeName);
  #|     request.onerror = () => reject(request.error);
  #|     request.onsuccess = () => resolve(request.result);
  #|   });
  #|   const withStore = (mode, operation) => openDatabase().then((database) => {
  #|     return new Promise((resolve, reject) => {
  #|       const transaction = database.transaction(storeName, mode);
  #|       const request = operation(transaction.objectStore(storeName));
  #|       transaction.oncomplete = () => { database.close(); resolve(request?.result); };
  #|       transaction.onerror = () => { database.close(); reject(transaction.error); };
  #|       transaction.onabort = () => { database.close(); reject(transaction.error); };
  #|     });
  #|   });
  #|   globalThis.__tanikunAutomerge = {
  #|     create: () => Automerge.from({}),
  #|     set: (doc, key, value) => Automerge.change(
  #|       Automerge.clone(doc),
  #|       (draft) => { draft[key] = value; },
  #|     ),
  #|     save: (doc) => Automerge.save(doc),
  #|     load: (bytes) => Automerge.load(bytes),
  #|     get: (doc, key) => doc[key],
  #|     changes: (from, to) => Automerge.getChanges(from, to),
  #|     apply: (doc, changes) => Automerge.applyChanges(doc, changes)[0],
  #|     idbPut: (key, bytes) => withStore("readwrite", (store) => store.put(bytes, key)),
  #|     idbGet: (key) => withStore("readonly", (store) => store.get(key)),
  #|   };
  #| })()

///|
async test "save and load round-trip" {
  install_bridge().wait()
  let doc = @tanikun-automerge-spike.set_field(
    @tanikun-automerge-spike.create_doc(),
    "course",
    "physics",
  )
  let bytes = @tanikun-automerge-spike.save_doc(doc)
  assert_eq(
    @tanikun-automerge-spike.get_field(
      @tanikun-automerge-spike.load_doc(bytes),
      "course",
    ),
    "physics",
  )
}

///|
async test "changes from two replicas merge" {
  install_bridge().wait()
  let base = @tanikun-automerge-spike.create_doc()
  let left = @tanikun-automerge-spike.set_field(base, "left", "1")
  let right = @tanikun-automerge-spike.set_field(base, "right", "2")
  let merged = @tanikun-automerge-spike.apply_changes(
    left,
    @tanikun-automerge-spike.get_changes(base, right),
  )
  assert_eq(@tanikun-automerge-spike.get_field(merged, "left"), "1")
  assert_eq(@tanikun-automerge-spike.get_field(merged, "right"), "2")
}

///|
async test "IndexedDB stores and restores document bytes" {
  install_bridge().wait()
  let doc = @tanikun-automerge-spike.set_field(
    @tanikun-automerge-spike.create_doc(),
    "term",
    "2026-spring",
  )
  @tanikun-automerge-spike.idb_put(
    "document-1",
    @tanikun-automerge-spike.save_doc(doc),
  ).wait()
  let restored = @tanikun-automerge-spike.load_doc(
    @tanikun-automerge-spike.idb_get("document-1").wait(),
  )
  assert_eq(@tanikun-automerge-spike.get_field(restored, "term"), "2026-spring")
}
