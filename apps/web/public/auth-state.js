(() => {
  // Account-scoped local state for Phase 5. `auth:state` is intentionally tiny:
  // a generation fence, the public account handle, and a local session state.
  // It never contains a session token, a CSRF token, a challenge, or a planner
  // payload. Planner, metadata, outbox, seen, and lock names follow the accepted
  // account isolation layout in docs/PHASE_5.md.
  const schema = globalThis.tanikunPersistenceTransactions?.plannerDatabase;
  const AUTH_DATABASE = schema?.name ?? "tanikun-planner";
  const AUTH_STORE = schema?.storeName ?? "documents";
  const AUTH_STATE_KEY = "auth:state";
  const AUTH_LOCK = "tanikun-auth-v1";
  const AUTH_CHANNEL = "tanikun-auth-v1";
  const AUTH_VERSION = 1;
  const GENERATION = /^[A-Za-z0-9_-]{22}$/u;
  const HANDLE = /^[A-Za-z0-9_-]{43}$/u;
  const SESSION_STATES = new Set(["active", "signed_out", "reauth_required"]);

  class AuthStateError extends Error {
    constructor(code) {
      super(code);
      this.name = "AuthStateError";
      this.code = code;
    }
  }

  function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function exactKeys(value, keys) {
    if (!record(value)) return false;
    const actual = Object.keys(value);
    return (
      actual.length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key))
    );
  }

  function encodeBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
  }

  function randomBytes(length) {
    const bytes = new Uint8Array(length);
    if (globalThis.crypto?.getRandomValues)
      globalThis.crypto.getRandomValues(bytes);
    else throw new AuthStateError("unavailable");
    return bytes;
  }

  function newGeneration(random) {
    const bytes = random(16);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 16)
      throw new AuthStateError("invalid_generation");
    return encodeBase64Url(bytes);
  }

  function validateExpected(value) {
    if (
      !record(value) ||
      typeof value.generation !== "string" ||
      !GENERATION.test(value.generation) ||
      !(
        value.accountHandle === null ||
        (typeof value.accountHandle === "string" &&
          HANDLE.test(value.accountHandle))
      )
    )
      throw new AuthStateError("invalid_expected_scope");
    return {
      generation: value.generation,
      accountHandle: value.accountHandle,
    };
  }

  function snapshotOf(value) {
    const state = validateState(value);
    return {
      generation: state.generation,
      accountHandle: state.accountHandle,
    };
  }

  function validateState(value) {
    if (
      !exactKeys(value, [
        "authVersion",
        "generation",
        "accountHandle",
        "sessionState",
      ]) ||
      value.authVersion !== AUTH_VERSION ||
      typeof value.generation !== "string" ||
      !GENERATION.test(value.generation) ||
      !(
        value.accountHandle === null ||
        (typeof value.accountHandle === "string" &&
          HANDLE.test(value.accountHandle))
      ) ||
      !SESSION_STATES.has(value.sessionState)
    )
      throw new AuthStateError("invalid_auth_state");
    if (
      (value.sessionState === "signed_out" && value.accountHandle !== null) ||
      (value.sessionState !== "signed_out" && value.accountHandle === null)
    )
      throw new AuthStateError("invalid_auth_state");
    return value;
  }

  function requestDone(request) {
    return new Promise((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new AuthStateError("unavailable")),
        { once: true },
      );
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.addEventListener("complete", resolve, { once: true });
      transaction.addEventListener(
        "abort",
        () => reject(transaction.error ?? new AuthStateError("unavailable")),
        { once: true },
      );
    });
  }

  function channelOf(factory) {
    if (typeof factory !== "function") return null;
    try {
      return factory(AUTH_CHANNEL) ?? null;
    } catch {
      return null;
    }
  }

  function plannerKeyFor(state) {
    return state?.accountHandle
      ? `account:${state.accountHandle}:planner`
      : "planner";
  }

  function metadataKeyFor({ accountHandle, apiOrigin, documentId }) {
    return accountHandle
      ? "sync:" + JSON.stringify([accountHandle, apiOrigin, documentId])
      : "sync:" + JSON.stringify([apiOrigin, documentId]);
  }

  function syncScopeFor({ accountHandle, apiOrigin, documentId }) {
    return accountHandle
      ? `${accountHandle}|${apiOrigin}|${documentId}`
      : `${apiOrigin}:${documentId}`;
  }

  function syncLockFor({ accountHandle, apiOrigin, documentId }) {
    return accountHandle
      ? `tanikun-sync:${accountHandle}:${apiOrigin}:${documentId}`
      : `tanikun-sync:${apiOrigin}:${documentId}`;
  }

  function createAuthStateStore({
    indexedDB,
    channelFactory = globalThis.BroadcastChannel
      ? (name) => new globalThis.BroadcastChannel(name)
      : null,
    random = randomBytes,
    locks = globalThis.navigator?.locks,
  } = {}) {
    if (!indexedDB) throw new AuthStateError("unavailable");
    const channel = channelOf(channelFactory);
    const listeners = new Set();
    let opening;

    function open() {
      if (opening) return opening;
      opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(AUTH_DATABASE, 1);
        request.addEventListener(
          "upgradeneeded",
          () => {
            if (!request.result.objectStoreNames.contains(AUTH_STORE))
              request.result.createObjectStore(AUTH_STORE);
          },
          { once: true },
        );
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener(
          "error",
          () => reject(request.error ?? new AuthStateError("unavailable")),
          { once: true },
        );
      });
      return opening;
    }

    function withLock(operation) {
      if (locks?.request)
        return locks.request(AUTH_LOCK, { mode: "exclusive" }, operation);
      return operation();
    }

    function broadcast(state) {
      if (!channel) return;
      try {
        // BroadcastChannel has no targetOrigin argument.
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        channel.postMessage({ type: "tanikun-auth-changed", state });
      } catch {
        // The IndexedDB generation check remains authoritative.
      }
    }

    async function read() {
      const database = await open();
      const transaction = database.transaction(AUTH_STORE, "readonly");
      const value = await requestDone(
        transaction.objectStore(AUTH_STORE).get(AUTH_STATE_KEY),
      );
      await transactionDone(transaction);
      if (value === undefined) throw new AuthStateError("invalid_auth_state");
      return { ...validateState(value) };
    }

    async function initialize({ mode }) {
      if (mode !== "session") return null;
      return withLock(async () => {
        const database = await open();
        return new Promise((resolve, reject) => {
          const transaction = database.transaction(AUTH_STORE, "readwrite");
          const store = transaction.objectStore(AUTH_STORE);
          let state;
          const request = store.get(AUTH_STATE_KEY);
          request.addEventListener(
            "success",
            () => {
              try {
                if (request.result !== undefined) {
                  state = { ...validateState(request.result) };
                  return;
                }
                state = {
                  authVersion: AUTH_VERSION,
                  generation: newGeneration(random),
                  accountHandle: null,
                  sessionState: "signed_out",
                };
                store.put(state, AUTH_STATE_KEY);
              } catch (error) {
                reject(error);
                try {
                  transaction.abort();
                } catch {
                  // The transaction may already be inactive.
                }
              }
            },
            { once: true },
          );
          transaction.addEventListener("complete", () => resolve(state), {
            once: true,
          });
          transaction.addEventListener(
            "abort",
            () =>
              reject(transaction.error ?? new AuthStateError("unavailable")),
            { once: true },
          );
        });
      });
    }

    async function writeState({
      accountHandle,
      sessionState,
      bumpGeneration,
      expected,
    }) {
      if (!SESSION_STATES.has(sessionState))
        throw new AuthStateError("invalid_session_state");
      if (
        !(
          accountHandle === null ||
          (typeof accountHandle === "string" && HANDLE.test(accountHandle))
        )
      )
        throw new AuthStateError("invalid_account_handle");
      const checkedExpected =
        expected === undefined ? null : validateExpected(expected);
      return withLock(async () => {
        const database = await open();
        const state = await new Promise((resolve, reject) => {
          const transaction = database.transaction(AUTH_STORE, "readwrite");
          const store = transaction.objectStore(AUTH_STORE);
          let next;
          const request = store.get(AUTH_STATE_KEY);
          request.addEventListener(
            "success",
            () => {
              try {
                const previous =
                  request.result === undefined
                    ? null
                    : validateState(request.result);
                if (
                  checkedExpected &&
                  (!previous ||
                    previous.generation !== checkedExpected.generation ||
                    previous.accountHandle !== checkedExpected.accountHandle)
                )
                  throw new AuthStateError("stale_account");
                next = {
                  authVersion: AUTH_VERSION,
                  generation: bumpGeneration
                    ? newGeneration(random)
                    : previous?.generation,
                  accountHandle: bumpGeneration
                    ? accountHandle
                    : (previous?.accountHandle ?? accountHandle),
                  sessionState,
                };
                validateState(next);
                store.put(next, AUTH_STATE_KEY);
              } catch (error) {
                reject(error);
                try {
                  transaction.abort();
                } catch {
                  // The transaction may already be inactive.
                }
              }
            },
            { once: true },
          );
          transaction.addEventListener("complete", () => resolve(next), {
            once: true,
          });
          transaction.addEventListener(
            "abort",
            () =>
              reject(transaction.error ?? new AuthStateError("unavailable")),
            { once: true },
          );
        });
        broadcast(state);
        return { ...state };
      });
    }

    async function writeLocalDecision({ accountHandle, expected, write }) {
      const checkedExpected = validateExpected(expected);
      const database = await open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(AUTH_STORE, "readwrite");
        const objectStore = transaction.objectStore(AUTH_STORE);
        const authRequest = objectStore.get(AUTH_STATE_KEY);
        authRequest.addEventListener(
          "success",
          () => {
            try {
              const current =
                authRequest.result === undefined
                  ? null
                  : validateState(authRequest.result);
              if (
                !current ||
                current.generation !== checkedExpected.generation ||
                current.accountHandle !== checkedExpected.accountHandle ||
                current.accountHandle !== accountHandle
              )
                throw new AuthStateError("stale_account");
              write(objectStore);
            } catch (error) {
              reject(error);
              try {
                transaction.abort();
              } catch {
                // The transaction may already be inactive.
              }
            }
          },
          { once: true },
        );
        transaction.addEventListener("complete", () => resolve(), {
          once: true,
        });
        transaction.addEventListener(
          "abort",
          () => reject(transaction.error ?? new AuthStateError("unavailable")),
          { once: true },
        );
      });
    }

    const store = {
      initialize,
      read,
      write: ({ accountHandle, sessionState, expected }) =>
        writeState({
          accountHandle,
          sessionState,
          bumpGeneration: true,
          expected,
        }),
      setSessionState: (sessionState, expected) =>
        writeState({
          accountHandle: null,
          sessionState,
          bumpGeneration: false,
          expected,
        }),
      snapshot: async () => snapshotOf(await read()),
      currentScope: async () => {
        const state = await read();
        return {
          mode: "session",
          plannerKey: plannerKeyFor(state),
          generation: state.generation,
          accountHandle: state.accountHandle,
          sessionState: state.sessionState,
        };
      },
      plannerKey: plannerKeyFor,
      metadataKey: metadataKeyFor,
      syncScope: syncScopeFor,
      syncLockName: syncLockFor,
      async planExists(key) {
        if (typeof key !== "string" || key.length === 0 || key.length > 256)
          throw new AuthStateError("invalid_planner_key");
        const database = await open();
        const transaction = database.transaction(AUTH_STORE, "readonly");
        const value = await requestDone(
          transaction.objectStore(AUTH_STORE).get(key),
        );
        await transactionDone(transaction);
        return value !== undefined;
      },
      async accountPlanExists(accountHandle) {
        if (typeof accountHandle !== "string" || !HANDLE.test(accountHandle))
          throw new AuthStateError("invalid_account_handle");
        return store.planExists(`account:${accountHandle}:planner`);
      },
      async isCopyDeclined(accountHandle) {
        if (typeof accountHandle !== "string" || !HANDLE.test(accountHandle))
          throw new AuthStateError("invalid_account_handle");
        const database = await open();
        const transaction = database.transaction(AUTH_STORE, "readonly");
        const value = await requestDone(
          transaction.objectStore(AUTH_STORE).get(`auth:copy:${accountHandle}`),
        );
        await transactionDone(transaction);
        return value?.declined === true;
      },
      async setCopyDeclined(accountHandle, declined, expected) {
        if (typeof accountHandle !== "string" || !HANDLE.test(accountHandle))
          throw new AuthStateError("invalid_account_handle");
        if (typeof declined !== "boolean")
          throw new AuthStateError("invalid_copy_marker");
        return writeLocalDecision({
          accountHandle,
          expected,
          write(objectStore) {
            if (declined)
              objectStore.put({ declined: true }, `auth:copy:${accountHandle}`);
            else objectStore.delete(`auth:copy:${accountHandle}`);
          },
        });
      },
      async copyUnboundToAccount(accountHandle, expected) {
        if (typeof accountHandle !== "string" || !HANDLE.test(accountHandle))
          throw new AuthStateError("invalid_account_handle");
        const checkedExpected = validateExpected(expected);
        const database = await open();
        return new Promise((resolve, reject) => {
          const transaction = database.transaction(AUTH_STORE, "readwrite");
          const objectStore = transaction.objectStore(AUTH_STORE);
          const accountKey = `account:${accountHandle}:planner`;
          const authRequest = objectStore.get(AUTH_STATE_KEY);
          const unboundRequest = objectStore.get("planner");
          const accountRequest = objectStore.get(accountKey);
          let remaining = 3;
          let copied = false;
          const apply = () => {
            remaining -= 1;
            if (remaining !== 0) return;
            try {
              const current =
                authRequest.result === undefined
                  ? null
                  : validateState(authRequest.result);
              if (
                !current ||
                current.generation !== checkedExpected.generation ||
                current.accountHandle !== checkedExpected.accountHandle ||
                current.accountHandle !== accountHandle
              )
                throw new AuthStateError("stale_account");
              if (
                unboundRequest.result === undefined ||
                accountRequest.result !== undefined
              ) {
                return;
              }
              const source = unboundRequest.result;
              const copiedRecord =
                source?.storageVersion === 2 &&
                source.bytes instanceof Uint8Array
                  ? {
                      storageVersion: 2,
                      bytes: new Uint8Array(source.bytes),
                    }
                  : source;
              objectStore.put(copiedRecord, accountKey);
              objectStore.put(
                { pendingUpload: true },
                `auth:upload:${accountHandle}`,
              );
              copied = true;
            } catch (error) {
              reject(error);
              try {
                transaction.abort();
              } catch {
                // The transaction may already be inactive.
              }
            }
          };
          for (const request of [authRequest, unboundRequest, accountRequest])
            request.addEventListener("success", apply, { once: true });
          transaction.addEventListener("complete", () => resolve(copied), {
            once: true,
          });
          transaction.addEventListener(
            "abort",
            () =>
              reject(transaction.error ?? new AuthStateError("unavailable")),
            { once: true },
          );
        });
      },
      async isPendingUpload(accountHandle) {
        if (typeof accountHandle !== "string" || !HANDLE.test(accountHandle))
          throw new AuthStateError("invalid_account_handle");
        const database = await open();
        const transaction = database.transaction(AUTH_STORE, "readonly");
        const value = await requestDone(
          transaction
            .objectStore(AUTH_STORE)
            .get(`auth:upload:${accountHandle}`),
        );
        await transactionDone(transaction);
        return value?.pendingUpload === true;
      },
      async setPendingUpload(accountHandle, pending, expected) {
        if (typeof accountHandle !== "string" || !HANDLE.test(accountHandle))
          throw new AuthStateError("invalid_account_handle");
        if (typeof pending !== "boolean")
          throw new AuthStateError("invalid_pending_upload");
        return writeLocalDecision({
          accountHandle,
          expected,
          write(objectStore) {
            if (pending)
              objectStore.put(
                { pendingUpload: true },
                `auth:upload:${accountHandle}`,
              );
            else objectStore.delete(`auth:upload:${accountHandle}`);
          },
        });
      },
      subscribe(listener) {
        if (typeof listener !== "function") return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      close() {
        try {
          channel?.close?.();
        } catch {
          // Closing a channel is best effort.
        }
        opening?.then((database) => database.close()).catch(() => {});
        opening = undefined;
        listeners.clear();
      },
    };

    if (channel) {
      channel.addEventListener("message", (event) => {
        const state = event?.data?.state;
        if (event?.data?.type !== "tanikun-auth-changed") return;
        let checked;
        try {
          checked = validateState(state);
        } catch {
          return;
        }
        for (const listener of listeners) {
          try {
            listener({ ...checked });
          } catch {
            // A subscriber must not break another tab's state transition.
          }
        }
      });
    }

    return Object.freeze(store);
  }

  // The page may inject a session configuration before this classic script loads.
  // Dev bearer and the static planner keep no auth state. Tests disable this hook
  // so the factory stays pure.
  if (globalThis["__TANIKUN_AUTH_AUTOSTART__"] !== false) {
    const mode = globalThis["__TANIKUN_SYNC_CONFIG__"]?.mode;
    if (mode === "session") {
      const store = createAuthStateStore({
        indexedDB: globalThis.indexedDB,
        locks: globalThis.navigator?.locks,
      });
      globalThis.tanikunAuthState = store;
      globalThis.tanikunAuthReady = store
        .initialize({ mode: "session" })
        .catch(() => null);
    } else {
      globalThis.tanikunAuthReady = Promise.resolve(null);
    }
  }

  globalThis.tanikunAuthStateModule = Object.freeze({
    createAuthStateStore,
    AUTH_CHANNEL,
    AUTH_LOCK,
    AUTH_STATE_KEY,
    AUTH_VERSION,
    AuthStateError,
  });
})();
