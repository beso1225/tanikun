// Own the planner IndexedDB schema, opening, connection, and transaction
// lifecycle. Callers inject the database and timer functions so tests can drive
// completion order without patching browser globals or waiting on the
// production timeout. CAS checks, document validation, and handle adoption stay
// in persistence.js.
{
  // Planner storage and sync metadata share this version 1 database. Keep the
  // name, version, store, and upgrade path in one owner; each caller still owns
  // its connection lifetime and caller-specific errors.
  const databaseName = "tanikun-planner";
  const databaseVersion = 1;
  const storeName = "documents";
  // Return the raw request so callers keep synchronous event registration and
  // their own timeout, late-open, and connection cleanup.
  const open = (indexedDB) => {
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
    return request;
  };
  const plannerDatabase = {
    name: databaseName,
    version: databaseVersion,
    storeName,
    open,
  };
  const createTransactions =
    ({ indexedDB, timers, timeout = 5000 }) =>
    (mode, operation, hooks = {}) =>
      new Promise((resolve, reject) => {
        if (!indexedDB) {
          reject(new Error("保存領域を利用できません"));
          return;
        }
        let settled = false;
        let abortNotified = false;
        let database;
        let transaction;
        let request;
        // An abort event proves the transaction rolled back, including an abort
        // triggered after the timeout. A commit that raced the timeout fires
        // complete instead, so only then does the attempt stay for
        // reconciliation.
        const notifyAbort = () => {
          if (abortNotified) return;
          abortNotified = true;
          hooks.onAbort?.();
        };
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          timers.clearTimeout(timer);
          database?.close();
          if (error) reject(error);
          else resolve(value);
        };
        const timer = timers.setTimeout(() => {
          finish(new Error("保存領域へのアクセスがタイムアウトしました"));
          try {
            transaction?.abort();
          } catch {
            // A transaction may already have completed before its event runs.
          }
        }, timeout);
        let opening;
        try {
          opening = plannerDatabase.open(indexedDB);
        } catch (error) {
          finish(error);
          return;
        }
        opening.addEventListener(
          "error",
          () =>
            finish(opening.error ?? new Error("保存領域にアクセスできません")),
          { once: true },
        );
        opening.addEventListener(
          "success",
          () => {
            database = opening.result;
            if (settled) {
              database.close();
              return;
            }
            try {
              transaction = database.transaction(storeName, mode);
              transaction.addEventListener(
                "complete",
                () => {
                  // A commit can precede its event handler and the timeout.
                  // Track the durable outcome even if the promise already
                  // timed out.
                  hooks.onCommit?.();
                  finish(null, request?.result);
                },
                { once: true },
              );
              transaction.addEventListener(
                "error",
                () => {
                  notifyAbort();
                  finish(
                    transaction.error ??
                      new Error("保存領域にアクセスできません"),
                  );
                },
                { once: true },
              );
              transaction.addEventListener(
                "abort",
                () => {
                  notifyAbort();
                  finish(
                    transaction.error ?? new Error("保存が中断されました"),
                  );
                },
                { once: true },
              );
              request = operation(
                transaction.objectStore(storeName),
                (error) => {
                  notifyAbort();
                  transaction.abort();
                  finish(error);
                },
              );
            } catch (error) {
              notifyAbort();
              try {
                transaction?.abort();
              } catch {
                // The transaction may already be inactive.
              }
              finish(error);
            }
          },
          { once: true },
        );
      });
  globalThis.tanikunPersistenceTransactions = {
    createTransactions,
    plannerDatabase,
  };
}
