import assert from "node:assert/strict";
import test from "node:test";

import { IDBFactory } from "fake-indexeddb";

import { installPlannerRecordReader } from "./planner-record-reader.mjs";

for (const method of ["readRecord", "readSource"]) {
  test(
    `${method} rejects when a readonly request aborts before success`,
    { timeout: 1000 },
    async (t) => {
      const previousDatabase = globalThis.indexedDB;
      const previousReader = globalThis.tanikunPlannerRecordReader;
      t.after(() => {
        globalThis.indexedDB = previousDatabase;
        globalThis.tanikunPlannerRecordReader = previousReader;
      });
      const factory = new IDBFactory();
      let closes = 0;
      globalThis.indexedDB = {
        open(...args) {
          const request = factory.open(...args);
          request.addEventListener("success", () => {
            const database = request.result;
            const transact = database.transaction.bind(database);
            const close = database.close.bind(database);
            database.close = () => {
              closes += 1;
              close();
            };
            database.transaction = (...transactionArgs) => {
              const transaction = transact(...transactionArgs);
              queueMicrotask(() => transaction.abort());
              return transaction;
            };
          });
          return request;
        },
      };
      delete globalThis.tanikunPlannerRecordReader;
      installPlannerRecordReader();
      await assert.rejects(globalThis.tanikunPlannerRecordReader[method](), {
        name: "AbortError",
      });
      assert.equal(closes, 1, "the failed read closes its connection");
    },
  );
}
