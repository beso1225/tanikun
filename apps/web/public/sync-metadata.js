// Sync metadata lives beside the planner in `tanikun-planner`/`documents`.
// This module owns the two-phase client commit: observe the server high-water,
// then write the merged planner and merged cursor in one transaction.
const validCursor = (value) => Number.isSafeInteger(value) && value >= 0;

const emptyMetadata = () => ({
  syncVersion: 1,
  mergedCursor: 0,
  observedHighWater: 0,
});

const sameBytes = (left, right) =>
  left instanceof Uint8Array &&
  right instanceof Uint8Array &&
  left.length === right.length &&
  left.every((byte, index) => byte === right[index]);

{
  const databaseName = "tanikun-planner";
  const databaseVersion = 1;
  const storeName = "documents";

  class SyncMetadataError extends Error {
    constructor(code) {
      super(code);
      this.name = "SyncMetadataError";
      this.code = code;
    }
  }

  const validateMetadata = (value) => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 3 ||
      value.syncVersion !== 1 ||
      !validCursor(value.mergedCursor) ||
      !validCursor(value.observedHighWater) ||
      value.mergedCursor > value.observedHighWater
    ) {
      throw new SyncMetadataError("invalid_sync_state");
    }
    return value;
  };

  const createSyncMetadataStore = ({ indexedDB } = {}) => {
    if (!indexedDB) throw new Error("同期メタデータを利用できません");
    let opening;

    const open = () => {
      if (opening) return opening;
      opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, databaseVersion);
        request.addEventListener(
          "upgradeneeded",
          () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(storeName))
              database.createObjectStore(storeName);
          },
          { once: true },
        );
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener(
          "error",
          () =>
            reject(
              request.error ?? new Error("同期メタデータにアクセスできません"),
            ),
          { once: true },
        );
      });
      return opening;
    };

    const read = async (key) => {
      const database = await open();
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(key);
      const value = await new Promise((resolve, reject) => {
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener(
          "error",
          () =>
            reject(
              request.error ?? new Error("同期メタデータにアクセスできません"),
            ),
          { once: true },
        );
      });
      return value === undefined ? emptyMetadata() : validateMetadata(value);
    };

    const observe = async (key, cursor) => {
      if (!validCursor(cursor)) throw new SyncMetadataError("invalid_cursor");
      const database = await open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        let failure;
        let updated;
        transaction.addEventListener("complete", () => resolve(updated), {
          once: true,
        });
        transaction.addEventListener(
          "abort",
          () =>
            reject(
              failure ??
                transaction.error ??
                new Error("同期メタデータの保存が中断されました"),
            ),
          { once: true },
        );
        transaction.addEventListener(
          "error",
          () => {
            failure ??=
              transaction.error ??
              new Error("同期メタデータにアクセスできません");
          },
          { once: true },
        );
        const request = store.get(key);
        request.addEventListener(
          "success",
          () => {
            try {
              const current =
                request.result === undefined
                  ? emptyMetadata()
                  : validateMetadata(request.result);
              if (
                cursor < current.mergedCursor ||
                cursor < current.observedHighWater
              ) {
                throw new SyncMetadataError("rollback");
              }
              updated = {
                syncVersion: 1,
                mergedCursor: current.mergedCursor,
                observedHighWater: Math.max(current.observedHighWater, cursor),
              };
              store.put(updated, key);
            } catch (error) {
              failure = error;
              transaction.abort();
            }
          },
          { once: true },
        );
        request.addEventListener(
          "error",
          () => {
            failure =
              request.error ?? new Error("同期メタデータにアクセスできません");
            transaction.abort();
          },
          { once: true },
        );
      });
    };

    const applyPage = async ({
      key,
      expectedMergedCursor,
      expectedPlannerBytes,
      changes,
      nextMergedCursor,
      observedHighWater,
      validate,
    }) => {
      if (!validCursor(expectedMergedCursor) || !validCursor(nextMergedCursor))
        throw new SyncMetadataError("invalid_cursor");
      const automerge = globalThis.Automerge;
      const codec = globalThis.tanikunDocument;
      if (!automerge || !codec)
        throw new SyncMetadataError("missing_document_codec");
      const database = await open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        let failure;
        let text;
        transaction.addEventListener("complete", () => resolve({ text }), {
          once: true,
        });
        transaction.addEventListener(
          "abort",
          () =>
            reject(
              failure ??
                transaction.error ??
                new Error("同期メタデータの保存が中断されました"),
            ),
          { once: true },
        );
        transaction.addEventListener(
          "error",
          () => {
            failure ??=
              transaction.error ??
              new Error("同期メタデータにアクセスできません");
          },
          { once: true },
        );

        let remaining = 2;
        let planner;
        let metadata;
        const apply = () => {
          remaining -= 1;
          if (remaining !== 0) return;
          try {
            const current = validateMetadata(metadata);
            if (current.mergedCursor !== expectedMergedCursor)
              throw new SyncMetadataError("stale_cursor");
            if (nextMergedCursor < current.mergedCursor)
              throw new SyncMetadataError("cursor_regression");
            let document;
            if (expectedPlannerBytes === null) {
              if (planner !== undefined)
                throw new SyncMetadataError("stale_planner");
              document = automerge.init();
            } else {
              if (
                planner?.storageVersion !== 2 ||
                !(planner.bytes instanceof Uint8Array) ||
                !sameBytes(planner.bytes, expectedPlannerBytes)
              ) {
                throw new SyncMetadataError("stale_planner");
              }
              document = automerge.load(planner.bytes);
            }
            const next = automerge.applyChanges(
              automerge.clone(document),
              changes,
            )[0];
            text = codec.text(next);
            if (!validate(text))
              throw new SyncMetadataError("invalid_document");
            const record = {
              storageVersion: 2,
              bytes: automerge.save(next),
            };
            const nextMetadata = {
              syncVersion: 1,
              mergedCursor: nextMergedCursor,
              observedHighWater: Math.max(
                current.observedHighWater,
                observedHighWater,
                nextMergedCursor,
              ),
            };
            validateMetadata(nextMetadata);
            store.put(record, "planner");
            store.put(nextMetadata, key);
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        };

        const plannerRequest = store.get("planner");
        plannerRequest.addEventListener(
          "success",
          () => {
            planner = plannerRequest.result;
            apply();
          },
          { once: true },
        );
        plannerRequest.addEventListener(
          "error",
          () => {
            failure =
              plannerRequest.error ??
              new Error("保存データにアクセスできません");
            transaction.abort();
          },
          { once: true },
        );
        const metadataRequest = store.get(key);
        metadataRequest.addEventListener(
          "success",
          () => {
            metadata = metadataRequest.result;
            apply();
          },
          { once: true },
        );
        metadataRequest.addEventListener(
          "error",
          () => {
            failure =
              metadataRequest.error ??
              new Error("同期メタデータにアクセスできません");
            transaction.abort();
          },
          { once: true },
        );
      });
    };

    const clear = async (key) => {
      const database = await open();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).delete(key);
        transaction.addEventListener("complete", () => resolve(), {
          once: true,
        });
        transaction.addEventListener(
          "abort",
          () =>
            reject(
              transaction.error ??
                new Error("同期メタデータの保存が中断されました"),
            ),
          { once: true },
        );
      });
    };

    return {
      read,
      observe,
      applyPage,
      clear,
      close: () => {
        opening?.then((database) => database.close()).catch(() => {});
        opening = undefined;
      },
    };
  };

  globalThis.tanikunSyncMetadata = {
    createSyncMetadataStore,
    SyncMetadataError,
  };
}
