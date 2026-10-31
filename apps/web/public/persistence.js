// Keep this prefix in sync with persistence_runtime.mbt.
const storageErrorPrefix = "__tanikun_storage_error__";
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
// Abort transactions on timeout. A late open is closed without running work,
// so a timed-out write can never overwrite a later successful write.
const transact = (mode, operation) =>
  new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("保存領域を利用できません"));
      return;
    }
    let settled = false;
    let database;
    let transaction;
    let request;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      database?.close();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      finish(new Error("保存領域へのアクセスがタイムアウトしました"));
      try {
        transaction?.abort();
      } catch {
        // A transaction may already have completed before its event runs.
      }
    }, 5000);
    const opening = indexedDB.open("tanikun-planner", 1);
    opening.addEventListener(
      "upgradeneeded",
      () => opening.result.createObjectStore("documents"),
      { once: true },
    );
    opening.addEventListener("error", () => finish(opening.error), {
      once: true,
    });
    opening.addEventListener(
      "success",
      () => {
        database = opening.result;
        if (settled) {
          database.close();
          return;
        }
        try {
          transaction = database.transaction("documents", mode);
          transaction.addEventListener(
            "complete",
            () => finish(null, request?.result),
            { once: true },
          );
          transaction.addEventListener(
            "error",
            () =>
              finish(
                transaction.error ?? new Error("保存領域にアクセスできません"),
              ),
            { once: true },
          );
          transaction.addEventListener(
            "abort",
            () =>
              finish(transaction.error ?? new Error("保存が中断されました")),
            { once: true },
          );
          request = operation(transaction.objectStore("documents"), (error) => {
            transaction.abort();
            finish(error);
          });
        } catch (error) {
          transaction?.abort();
          finish(error);
        }
      },
      { once: true },
    );
  });
{
  const A = globalThis.Automerge;
  const codec = globalThis.tanikunDocument;
  let document = null;
  let lastRecord;
  let validate;
  let writeQueue = Promise.resolve();
  const enqueue = (operation) => {
    const result = writeQueue.then(operation, operation);
    writeQueue = result.catch(() => {});
    return result;
  };
  const persist = async (next, replace = false) => {
    const record = { storageVersion: 2, bytes: A.save(next) };
    await transact("readwrite", (store, fail) => {
      const get = store.get("planner");
      get.addEventListener(
        "success",
        () => {
          if (!replace && !sameStoredPlan(get.result, lastRecord)) {
            fail(new Error("別のタブで保存されました。再読み込みしてください"));
            return;
          }
          try {
            store.put(record, "planner");
          } catch (error) {
            fail(error);
          }
        },
        { once: true },
      );
      return get;
    });
    document = next;
    lastRecord = record;
  };
  globalThis.tanikunStorage = {
    configure: (validator) => {
      validate = validator;
    },
    load: async () => {
      try {
        const stored = await transact("readonly", (store) =>
          store.get("planner"),
        );
        lastRecord = stored;
        if (stored === undefined) return "";
        // Version 1 JSON is validated by MoonBit before any migration write.
        // The next successful source edit upgrades it atomically to version 2.
        if (typeof stored === "string") {
          if (!validate?.(stored))
            throw new Error("保存データを読み込めません");
          document = codec.update(null, stored);
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
        document = next;
        return text;
      } catch (error) {
        document = null;
        return `${storageErrorPrefix}${error instanceof Error ? error.message : String(error)}`;
      }
    },
    save: (text, replace = false) =>
      enqueue(() => {
        if (!validate?.(text)) throw new Error("保存データが正しくありません");
        return persist(codec.update(document, text), replace);
      }),
    // Device-local exchange boundary, with no transport or background sync.
    // Validate the complete merged source through the configured app model
    // before replacing the last committed document.
    changes: () => (document ? A.getAllChanges(document) : []),
    merge: (changes) =>
      enqueue(async () => {
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
}
