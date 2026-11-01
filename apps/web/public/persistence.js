const sameStoredPlan = (left, right) => {
  if (left === right) return true;
  return (
    left?.storageVersion === 2 &&
    right?.storageVersion === 2 &&
    left.bytes instanceof Uint8Array &&
    right.bytes instanceof Uint8Array &&
    left.bytes.length === right.bytes.length &&
    left.bytes.every((byte, index) => byte === right.bytes[index])
  );
};
const storageErrorMessage = (error, fallback) =>
  error instanceof Error ? error.message : fallback;
{
  // Validation, CAS comparison, and handle adoption live here. The transaction
  // lifecycle is injected so isolated instances can share one database.
  const createStorage = ({ Automerge: A, codec, transact }) => {
    let document = null;
    let lastRecord;
    let nextVersion = 0;
    let adoptedVersion = 0;
    const attempts = new Map();
    const adopt = (next, record, version) => {
      if (version < adoptedVersion) return;
      document = next;
      lastRecord = record;
      adoptedVersion = version;
      for (const key of attempts.keys())
        if (key <= version) attempts.delete(key);
    };
    const reconcile = async () => {
      if (attempts.size === 0) return;
      const stored = await transact("readonly", (store) =>
        store.get("planner"),
      );
      for (const [version, attempt] of attempts) {
        if (sameStoredPlan(stored, attempt.record)) {
          adopt(attempt.next, stored, version);
          return;
        }
      }
    };
    let validate;
    let writeQueue = Promise.resolve();
    const enqueue = (operation) => {
      const result = writeQueue.then(operation, operation);
      writeQueue = result.catch(() => {});
      return result;
    };
    const persist = async (next, replace = false) => {
      const version = ++nextVersion;
      const record = { storageVersion: 2, bytes: A.save(next) };
      await transact(
        "readwrite",
        (store, fail) => {
          const get = store.get("planner");
          get.addEventListener(
            "success",
            () => {
              if (!replace && !sameStoredPlan(get.result, lastRecord)) {
                fail(
                  new Error("別のタブで保存されました。再読み込みしてください"),
                );
                return;
              }
              try {
                store.put(record, "planner");
                attempts.set(version, { next, record });
              } catch (error) {
                fail(error);
              }
            },
            { once: true },
          );
          return get;
        },
        {
          onCommit: () => adopt(next, record, version),
          onAbort: () => attempts.delete(version),
        },
      );
    };
    const load = async () => {
      const version = ++nextVersion;
      try {
        const stored = await transact("readonly", (store) =>
          store.get("planner"),
        );
        if (stored === undefined) {
          adopt(null, stored, version);
          return null;
        }
        // Version 1 JSON is validated by MoonBit before any migration write.
        // The next successful source edit upgrades it atomically to version 2.
        if (typeof stored === "string") {
          if (!validate?.(stored))
            throw new Error("保存データを読み込めません");
          adopt(codec.update(null, stored), stored, version);
          return stored;
        }
        if (
          stored?.storageVersion !== 2 ||
          !(stored.bytes instanceof Uint8Array)
        ) {
          throw new Error("未対応の保存データ形式です");
        }
        const next = A.load(stored.bytes);
        const text = codec.text(next);
        if (!validate?.(text)) throw new Error("保存データを読み込めません");
        adopt(next, stored, version);
        return text;
      } catch (error) {
        if (version >= adoptedVersion) {
          document = null;
          adoptedVersion = version;
        }
        throw error;
      }
    };
    const save = (text, replace = false) =>
      enqueue(async () => {
        if (!validate?.(text)) throw new Error("保存データが正しくありません");
        if (!replace) await reconcile();
        return persist(codec.update(document, text), replace);
      });
    const storage = {
      configure: (validator) => {
        validate = validator;
      },
      load,
      save,
      // Device-local exchange boundary, with no transport or background sync.
      // Validate the complete merged source through the configured app model
      // before replacing the last committed document.
      changes: () => (document ? A.getAllChanges(document) : []),
      merge: (changes) =>
        enqueue(async () => {
          await reconcile();
          const incoming = changes.map((change) => A.decodeChange(change));
          const known = new Set([
            ...A.getAllChanges(document ?? A.init()).map(
              (change) => A.decodeChange(change).hash,
            ),
            ...incoming.map((change) => change.hash),
          ]);
          if (
            incoming.some((change) =>
              change.deps.some((dependency) => !known.has(dependency)),
            )
          ) {
            throw new Error("統合する変更の履歴が不足しています");
          }
          const next = A.applyChanges(
            document ? A.clone(document) : A.init(),
            changes,
          )[0];
          const text = codec.text(next);
          if (validate?.(text) !== true)
            throw new Error("統合した保存データが正しくありません");
          await persist(next);
          return text;
        }),
    };
    // Explicit wire results for the MoonBit boundary. `storage.mbt` decodes
    // these arrays into variants, so no caller inspects messages for control
    // flow. A failure keeps its localized recovery guidance. Call the public
    // methods so a test or a future adapter can replace them.
    storage.loadResult = async () => {
      try {
        const text = await storage.load();
        if (text === null) return ["missing"];
        if (typeof text === "string") return ["loaded", text];
        return ["failed", "保存データを読み込めません"];
      } catch (error) {
        return [
          "failed",
          storageErrorMessage(error, "保存データを読み込めません"),
        ];
      }
    };
    storage.saveResult = (text, replace = false) =>
      storage.save(text, replace).then(
        () => ["saved"],
        (error) => [
          "failed",
          storageErrorMessage(error, "保存できません。再読み込みしてください"),
        ],
      );
    return storage;
  };
  const storage = createStorage({
    Automerge: globalThis.Automerge,
    codec: globalThis.tanikunDocument,
    transact: globalThis.tanikunPersistenceTransactions.createTransactions({
      indexedDB: globalThis.indexedDB,
      // Delegate through globals so existing browser fault injection still
      // shortens the production timeout.
      timers: {
        setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
        clearTimeout: (handle) => globalThis.clearTimeout(handle),
      },
    }),
  });
  globalThis.tanikunStorage = storage;
  globalThis.tanikunPersistence = { createStorage };
}
