const withTimeout = (promise, message) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), 5000);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
(() => {
  const databaseName = "tanikun-planner";
  const storeName = "documents";
  const documentKey = "planner";
  let writeQueue = Promise.resolve();
  const openDatabase = () =>
    new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error("IndexedDB is unavailable"));
        return;
      }
      const request = indexedDB.open(databaseName, 1);
      request.addEventListener(
        "upgradeneeded",
        () => {
          request.result.createObjectStore(storeName);
        },
        { once: true },
      );
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
    });
  const readDocument = () =>
    withTimeout(
      openDatabase().then(
        (database) =>
          new Promise((resolve, reject) => {
            const transaction = database.transaction(storeName, "readonly");
            const request = transaction.objectStore(storeName).get(documentKey);
            transaction.addEventListener(
              "complete",
              () => {
                database.close();
                resolve(
                  typeof request.result === "string" ? request.result : "",
                );
              },
              { once: true },
            );
            transaction.addEventListener(
              "error",
              () => {
                database.close();
                reject(transaction.error);
              },
              { once: true },
            );
            transaction.addEventListener(
              "abort",
              () => {
                database.close();
                reject(transaction.error);
              },
              { once: true },
            );
          }),
      ),
      "IndexedDB load timed out",
    );
  const writeDocument = (text) =>
    withTimeout(
      openDatabase().then(
        (database) =>
          new Promise((resolve, reject) => {
            const transaction = database.transaction(storeName, "readwrite");
            transaction.objectStore(storeName).put(text, documentKey);
            transaction.addEventListener(
              "complete",
              () => {
                database.close();
                resolve();
              },
              { once: true },
            );
            transaction.addEventListener(
              "error",
              () => {
                database.close();
                reject(transaction.error);
              },
              { once: true },
            );
            transaction.addEventListener(
              "abort",
              () => {
                database.close();
                reject(transaction.error);
              },
              { once: true },
            );
          }),
      ),
      "IndexedDB save timed out",
    );
  const enqueueWrite = (text) => {
    const operation = writeQueue.then(
      () => writeDocument(text),
      () => writeDocument(text),
    );
    writeQueue = operation.catch(() => {});
    return operation;
  };
  globalThis.tanikunStorage = {
    load: readDocument,
    save: enqueueWrite,
  };
})();
