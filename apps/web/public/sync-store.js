// Separate IndexedDB database for sync-only state. Planner bytes and merge
// metadata stay in `tanikun-planner`; this database owns the outbox and the
// hash sets used to avoid re-uploading remote or already acknowledged changes.
const requestDone = (request) =>
  new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("同期状態にアクセスできません")),
      { once: true },
    );
  });

const transactionDone = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "error",
      () =>
        reject(transaction.error ?? new Error("同期状態にアクセスできません")),
      { once: true },
    );
    transaction.addEventListener(
      "abort",
      () =>
        reject(
          transaction.error ?? new Error("同期状態の保存が中断されました"),
        ),
      { once: true },
    );
  });

const readAll = (store) => requestDone(store.getAll());
const readKeys = (store) => requestDone(store.getAllKeys());

{
  const databaseName = "tanikun-sync";
  const databaseVersion = 1;
  const outboxStore = "outbox";
  const seenStore = "seen";

  const createSyncStore = ({ indexedDB } = {}) => {
    if (!indexedDB) throw new Error("同期状態を利用できません");
    let opening;

    const open = () => {
      if (opening) return opening;
      opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, databaseVersion);
        request.addEventListener(
          "upgradeneeded",
          () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(outboxStore))
              database.createObjectStore(outboxStore);
            if (!database.objectStoreNames.contains(seenStore))
              database.createObjectStore(seenStore);
          },
          { once: true },
        );
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener(
          "error",
          () =>
            reject(request.error ?? new Error("同期状態にアクセスできません")),
          { once: true },
        );
      });
      return opening;
    };

    const run = async (stores, mode, operation) => {
      const database = await open();
      const transaction = database.transaction(stores, mode);
      try {
        const result = await operation(transaction);
        await transactionDone(transaction);
        return result;
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          // A completed transaction cannot be aborted.
        }
        throw error;
      }
    };

    return {
      async enqueue(entries) {
        if (entries.length === 0) return;
        await run([outboxStore], "readwrite", (transaction) => {
          const store = transaction.objectStore(outboxStore);
          for (const entry of entries) store.put(entry, entry.change_id);
        });
      },

      async listOutbox() {
        const entries = await run([outboxStore], "readonly", (transaction) =>
          readAll(transaction.objectStore(outboxStore)),
        );
        return entries.toSorted(
          (left, right) =>
            left.order - right.order ||
            left.change_id.localeCompare(right.change_id),
        );
      },

      async outboxHashes() {
        const keys = await run([outboxStore], "readonly", (transaction) =>
          readKeys(transaction.objectStore(outboxStore)),
        );
        return new Set(keys);
      },

      async acknowledge(changeIds) {
        if (changeIds.length === 0) return;
        await run([outboxStore, seenStore], "readwrite", (transaction) => {
          const outbox = transaction.objectStore(outboxStore);
          const seen = transaction.objectStore(seenStore);
          for (const changeId of changeIds) {
            outbox.delete(changeId);
            seen.put({ kind: "synced" }, changeId);
          }
        });
      },

      async markRemote(changeIds) {
        if (changeIds.length === 0) return;
        await run([seenStore], "readwrite", (transaction) => {
          const seen = transaction.objectStore(seenStore);
          for (const changeId of changeIds)
            seen.put({ kind: "remote" }, changeId);
        });
      },

      async seenHashes() {
        const keys = await run([seenStore], "readonly", (transaction) =>
          readKeys(transaction.objectStore(seenStore)),
        );
        return new Set(keys);
      },

      async clear() {
        await run([outboxStore, seenStore], "readwrite", (transaction) => {
          transaction.objectStore(outboxStore).clear();
          transaction.objectStore(seenStore).clear();
        });
      },

      close() {
        opening?.then((database) => database.close()).catch(() => {});
        opening = undefined;
      },
    };
  };

  globalThis.tanikunSyncStore = { createSyncStore };
}
