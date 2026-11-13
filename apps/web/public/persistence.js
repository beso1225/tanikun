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
const storageFailure = (error) =>
  error instanceof Error ? ["failed", error.message] : ["failed"];
const staleAccountMessage =
  "別のアカウントに切り替わりました。編集内容はこの画面に残ります。コピーしてから再読み込みしてください";
const AUTH_STATE_KEY = "auth:state";
const GENERATION = /^[A-Za-z0-9_-]{22}$/u;
const HANDLE = /^[A-Za-z0-9_-]{43}$/u;
const SESSION_STATES = new Set(["active", "signed_out", "reauth_required"]);

class StaleAccountError extends Error {
  constructor() {
    super(staleAccountMessage);
    this.name = "StaleAccountError";
    this.code = "stale_account";
  }
}

function validAuthState(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 4 &&
    Object.hasOwn(value, "authVersion") &&
    Object.hasOwn(value, "generation") &&
    Object.hasOwn(value, "accountHandle") &&
    Object.hasOwn(value, "sessionState") &&
    value.authVersion === 1 &&
    typeof value.generation === "string" &&
    GENERATION.test(value.generation) &&
    (value.accountHandle === null ||
      (typeof value.accountHandle === "string" &&
        HANDLE.test(value.accountHandle))) &&
    SESSION_STATES.has(value.sessionState) &&
    (value.sessionState === "signed_out") === (value.accountHandle === null)
  );
}

const legacyScope = () => ({
  mode: "legacy",
  plannerKey: "planner",
  generation: null,
  accountHandle: null,
});

const sameScope = (left, right) =>
  left.mode === right.mode &&
  left.plannerKey === right.plannerKey &&
  left.generation === right.generation &&
  left.accountHandle === right.accountHandle;

function validateScope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("アカウント状態を読み込めません");
  if (value.mode !== "session" && value.mode !== "legacy")
    throw new Error("アカウント状態を読み込めません");
  if (
    typeof value.plannerKey !== "string" ||
    value.plannerKey.length === 0 ||
    value.plannerKey.length > 256
  )
    throw new Error("アカウント状態を読み込めません");
  if (value.mode === "session") {
    if (
      typeof value.generation !== "string" ||
      !GENERATION.test(value.generation) ||
      !(
        value.accountHandle === null ||
        (typeof value.accountHandle === "string" &&
          HANDLE.test(value.accountHandle))
      )
    )
      throw new Error("アカウント状態を読み込めません");
    return {
      mode: "session",
      plannerKey: value.plannerKey,
      generation: value.generation,
      accountHandle: value.accountHandle,
    };
  }
  return legacyScope();
}

function checkFence(scope, authState) {
  if (scope.mode !== "session") return;
  if (
    !validAuthState(authState) ||
    authState.generation !== scope.generation ||
    authState.accountHandle !== scope.accountHandle
  )
    throw new StaleAccountError();
}

{
  // Validation, CAS comparison, account-generation fencing, and handle
  // adoption live here. The transaction lifecycle is injected so isolated
  // instances can share one database.
  const createStorage = ({ Automerge: A, codec, transact, scopeProvider }) => {
    let document = null;
    let lastRecord;
    let nextVersion = 0;
    let adoptedVersion = 0;
    let loadedScope = null;
    let lastRejectedText = null;
    const staleListeners = new Set();
    const attempts = new Map();

    async function resolveScope() {
      if (!scopeProvider) {
        loadedScope ??= legacyScope();
        return loadedScope;
      }
      const next = validateScope(await scopeProvider());
      if (loadedScope && !sameScope(loadedScope, next))
        throw new StaleAccountError();
      loadedScope ??= next;
      return loadedScope;
    }

    function noteStaleAccount() {
      for (const listener of staleListeners) {
        try {
          listener();
        } catch {
          // A page observer must not change the persistence outcome.
        }
      }
      try {
        if (typeof globalThis.dispatchEvent === "function") {
          const event =
            typeof globalThis.CustomEvent === "function"
              ? new globalThis.CustomEvent("tanikun:stale-account")
              : new Event("tanikun:stale-account");
          globalThis.dispatchEvent(event);
        }
      } catch {
        // A page observer must not change the persistence outcome.
      }
      return new StaleAccountError();
    }

    function staleAccount() {
      return noteStaleAccount();
    }

    const adopt = (next, record, version) => {
      if (version < adoptedVersion) return;
      document = next;
      lastRecord = record;
      adoptedVersion = version;
      lastRejectedText = null;
      for (const key of attempts.keys())
        if (key <= version) attempts.delete(key);
    };
    const reconcile = async () => {
      if (attempts.size === 0) return;
      const scope = scopeProvider
        ? await resolveScope()
        : (loadedScope ??= legacyScope());
      const stored = await transact("readonly", (store, fail) => {
        const plannerRequest = store.get(scope.plannerKey);
        const authRequest =
          scope.mode === "session" ? store.get(AUTH_STATE_KEY) : null;
        let remaining = authRequest ? 2 : 1;
        const apply = () => {
          remaining -= 1;
          if (remaining !== 0) return;
          try {
            if (authRequest) checkFence(scope, authRequest.result);
          } catch (error) {
            fail(error);
          }
        };
        plannerRequest.addEventListener("success", apply, { once: true });
        authRequest?.addEventListener("success", apply, { once: true });
        return plannerRequest;
      });
      for (const [version, attempt] of attempts) {
        if (sameStoredPlan(stored, attempt.record)) {
          adopt(attempt.next, stored, version);
          return;
        }
      }
    };
    let validate;
    let localChangeListener;
    let writeQueue = Promise.resolve();
    const enqueue = (operation) => {
      const result = writeQueue.then(operation, operation);
      writeQueue = result.catch(() => {});
      return result;
    };
    const persist = async (next, replace = false) => {
      const scope = scopeProvider
        ? await resolveScope()
        : (loadedScope ??= legacyScope());
      const version = ++nextVersion;
      const record = { storageVersion: 2, bytes: A.save(next) };
      await transact(
        "readwrite",
        (store, fail) => {
          const plannerRequest = store.get(scope.plannerKey);
          const authRequest =
            scope.mode === "session" ? store.get(AUTH_STATE_KEY) : null;
          let remaining = authRequest ? 2 : 1;
          const apply = () => {
            remaining -= 1;
            if (remaining !== 0) return;
            try {
              if (authRequest) checkFence(scope, authRequest.result);
              if (
                !replace &&
                !sameStoredPlan(plannerRequest.result, lastRecord)
              ) {
                fail(
                  new Error("別のタブで保存されました。再読み込みしてください"),
                );
                return;
              }
              store.put(record, scope.plannerKey);
              attempts.set(version, { next, record });
            } catch (error) {
              fail(error);
            }
          };
          plannerRequest.addEventListener("success", apply, { once: true });
          authRequest?.addEventListener("success", apply, { once: true });
          return plannerRequest;
        },
        {
          onCommit: () => adopt(next, record, version),
          onAbort: () => attempts.delete(version),
        },
      );
    };
    const load = async () => {
      const scope = scopeProvider
        ? await resolveScope()
        : (loadedScope ??= legacyScope());
      const version = ++nextVersion;
      try {
        const stored = await transact("readonly", (store, fail) => {
          const plannerRequest = store.get(scope.plannerKey);
          const authRequest =
            scope.mode === "session" ? store.get(AUTH_STATE_KEY) : null;
          let remaining = authRequest ? 2 : 1;
          const apply = () => {
            remaining -= 1;
            if (remaining !== 0) return;
            try {
              if (authRequest) checkFence(scope, authRequest.result);
            } catch (error) {
              fail(error);
            }
          };
          plannerRequest.addEventListener("success", apply, { once: true });
          authRequest?.addEventListener("success", apply, { once: true });
          return plannerRequest;
        });
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
        try {
          if (scopeProvider) await resolveScope();
          else loadedScope ??= legacyScope();
          if (!validate?.(text))
            throw new Error("保存データが正しくありません");
          if (!replace) await reconcile();
          const next = codec.update(document, text);
          await persist(next, replace);
          lastRejectedText = null;
          const change = A.getLastLocalChange(next);
          if (change && localChangeListener) {
            try {
              localChangeListener(change);
            } catch {
              // The committed save remains successful; sync can rescan later.
            }
          }
        } catch (error) {
          if (error?.code === "stale_account") {
            lastRejectedText = text;
            throw staleAccount();
          }
          throw error;
        }
      });
    const storage = {
      configure: (validator) => {
        validate = validator;
      },
      validateText: (text) => validate?.(text) === true,
      onLocalChange: (listener) => {
        localChangeListener = listener;
      },
      snapshot: () => {
        if (lastRecord === undefined) return null;
        if (
          lastRecord?.storageVersion === 2 &&
          lastRecord.bytes instanceof Uint8Array
        )
          return {
            storageVersion: 2,
            bytes: new Uint8Array(lastRecord.bytes),
          };
        return {
          storageVersion:
            typeof lastRecord === "string" ? 1 : lastRecord?.storageVersion,
        };
      },
      scope: () => (loadedScope ? { ...loadedScope } : null),
      lastRejectedText: () => lastRejectedText,
      onStaleAccount: (listener) => {
        if (typeof listener !== "function") return () => {};
        staleListeners.add(listener);
        return () => staleListeners.delete(listener);
      },
      discard: () =>
        enqueue(async () => {
          const scope = scopeProvider
            ? await resolveScope()
            : (loadedScope ??= legacyScope());
          await transact("readwrite", (store, fail) => {
            if (scope.mode !== "session") {
              return store.delete(scope.plannerKey);
            }
            const authRequest = store.get(AUTH_STATE_KEY);
            const plannerRequest = store.get(scope.plannerKey);
            let remaining = 2;
            const apply = () => {
              remaining -= 1;
              if (remaining !== 0) return;
              try {
                checkFence(scope, authRequest.result);
                store.delete(scope.plannerKey);
              } catch (error) {
                fail(error);
              }
            };
            authRequest.addEventListener("success", apply, { once: true });
            plannerRequest.addEventListener("success", apply, { once: true });
            return plannerRequest;
          });
          document = null;
          lastRecord = undefined;
          adoptedVersion = ++nextVersion;
          lastRejectedText = null;
          attempts.clear();
        }),
      load,
      save,
      // Device-local exchange boundary, with no transport or background sync.
      // Validate the complete merged source through the configured app model
      // before replacing the last committed document.
      changes: () => (document ? A.getAllChanges(document) : []),
      merge: (changes) =>
        enqueue(async () => {
          if (scopeProvider) await resolveScope();
          else loadedScope ??= legacyScope();
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
    // flow. The decoder owns the standard guidance when a payload is absent or
    // empty. Call the public methods so a test or a future adapter can replace
    // them.
    storage.loadResult = async () => {
      try {
        const text = await storage.load();
        if (text === null) return ["missing"];
        if (typeof text === "string") return ["loaded", text];
        return ["failed"];
      } catch (error) {
        return storageFailure(error);
      }
    };
    storage.saveResult = (text, replace = false) =>
      storage.save(text, replace).then(() => ["saved"], storageFailure);
    return storage;
  };
  const authState = globalThis.tanikunAuthState;
  const scopeProvider =
    authState && globalThis["__TANIKUN_SYNC_CONFIG__"]?.mode === "session"
      ? async () => {
          await globalThis.tanikunAuthReady;
          // Select the initial account before fixing the planner's scope.
          // The session client's bounded timeout provides the offline fallback;
          // a second, shorter timer can select a scope that bootstrap replaces.
          await globalThis.tanikunAuthBootstrap;
          return authState.currentScope();
        }
      : undefined;
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
    scopeProvider,
  });
  globalThis.tanikunStorage = storage;
  globalThis.tanikunPersistence = { createStorage, StaleAccountError };
}
