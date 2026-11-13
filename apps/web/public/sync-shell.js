import { createSessionStatusClient } from "./sync-session.js";
import { createSyncTransport, SYNC_TRANSPORT_MODES } from "./sync-transport.js";

// Optional local runtime configuration, set before this module loads. The
// mode is explicit; there is no token-or-cookie inference and no implicit dev
// fallback.
//   dev_bearer: { mode: "dev_bearer", apiOrigin, token, maxRetry? }
//   session:    { mode: "session", apiOrigin?, expectedAccountHandle?, maxRetry? }
// Session mode never receives a runtime token. #183 owns sign-in UI and local
// account partitioning; this shell only consumes the session status.

const CONFIG = globalThis["__TANIKUN_SYNC_CONFIG__"];
const M = SYNC_TRANSPORT_MODES;
const STATUS_LABELS = Object.freeze({
  starting: "同期準備中",
  syncing: "同期中",
  synced: "同期済み",
  offline: "オフライン",
  error: "同期エラー",
  unconfigured: "同期未設定",
  reauth_required: "再認証が必要",
  account_changed: "アカウントを確認してください",
  signed_out: "サインインしてください",
  pending_upload_consent: "初回アップロード未許可",
  history_mismatch: "履歴が一致しません",
  stale_account: "アカウントが切り替わりました",
  paused: "アカウント切り替え中",
});

let current = {
  state: "starting",
  text: STATUS_LABELS.starting,
  retry: false,
  code: null,
};
const history = [];
let coordinator = null;
let sessionClient = null;
let retryQueued = false;
let saveTriggerInstalled = false;
let starting = false;
let retryNotBefore = 0;
let retryTimer;

function callFetch(...args) {
  return globalThis.fetch(...args);
}

function labelFor(state, code) {
  if (state === "error" && code && STATUS_LABELS[code])
    return STATUS_LABELS[code];
  return STATUS_LABELS[state] ?? STATUS_LABELS.error;
}

function render() {
  const status = document.querySelector("#sync-status");
  const text = document.querySelector("#sync-status-text");
  const button = document.querySelector("#sync-retry");
  if (status) status.dataset.state = current.state;
  if (text) text.textContent = current.text;
  if (button) {
    button.classList.toggle("hidden", !current.retry);
    button.disabled =
      current.state === "syncing" || Date.now() < retryNotBefore;
  }
}

const RETRYABLE_CODES = new Set([
  "offline",
  "timeout",
  "temporarily_unavailable",
  "sync_failed",
  "rate_limited",
]);

function retryIsSafe(state, code) {
  return (
    state === "offline" || (state === "error" && RETRYABLE_CODES.has(code))
  );
}

function setStatus(state, code = null, retryAfter) {
  clearTimeout(retryTimer);
  retryNotBefore =
    code === "rate_limited" ? Date.now() + (retryAfter ?? 1) * 1000 : 0;
  if (retryNotBefore > Date.now())
    retryTimer = setTimeout(render, retryNotBefore - Date.now());
  current = {
    state,
    text: labelFor(state, code),
    retry: retryIsSafe(state, code),
    code,
  };
  history.push({ ...current });
  if (history.length > 100) history.shift();
  render();
}

function notifyAuth(status) {
  try {
    globalThis.tanikunAuthController?.onSyncStatus?.(status);
  } catch {
    // The account surface is optional; sync still reports its own state.
  }
}

function pauseForAuthChange() {
  coordinator?.abort?.();
  coordinator = null;
  setStatus("paused");
}

function triggerSync() {
  if (Date.now() < retryNotBefore) return;
  if (
    CONFIG?.mode === M.SESSION &&
    !coordinator &&
    (current.code === "auth_bootstrap" ||
      current.code === "temporarily_unavailable" ||
      (current.code === "rate_limited" && !coordinator))
  ) {
    globalThis.location.reload();
    return;
  }
  if (!coordinator) {
    void start();
    return;
  }
  void coordinator.sync().catch((error) => {
    const code = error?.code;
    if (
      CONFIG?.mode === M.SESSION &&
      (code === "unauthorized" || code === "reauth_required")
    ) {
      sessionClient?.clear();
      coordinator = null;
      notifyAuth({ code: "reauth_required" });
      setStatus("reauth_required");
      return;
    }
    if (CONFIG?.mode === M.SESSION && code === "stale_account") {
      coordinator = null;
      notifyAuth({ code: "stale_account" });
      setStatus("error", "stale_account");
      return;
    }
    setStatus("error", "sync_failed");
  });
}

function queueSync() {
  if (retryQueued) return;
  retryQueued = true;
  setTimeout(() => {
    retryQueued = false;
    if (coordinator) triggerSync();
  }, 0);
}

function installLocalSaveTrigger(storage) {
  if (saveTriggerInstalled || !storage || typeof storage.save !== "function")
    return;
  saveTriggerInstalled = true;
  const save = storage.save.bind(storage);
  storage.save = async (...args) => {
    const result = await save(...args);
    queueSync();
    return result;
  };
}

function sameOrigin(url) {
  const origin = globalThis.location?.origin;
  if (!origin) return true;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function readConfig() {
  if (!CONFIG || typeof CONFIG !== "object") return null;
  if (CONFIG.mode === M.DEV_BEARER) {
    if (
      typeof CONFIG.apiOrigin !== "string" ||
      typeof CONFIG.token !== "string" ||
      CONFIG.token.length === 0
    )
      return null;
    return CONFIG;
  }
  if (CONFIG.mode === M.SESSION) {
    if (CONFIG.token !== undefined) return null;
    if (CONFIG.apiOrigin !== undefined) {
      if (!sameOrigin(CONFIG.apiOrigin)) return null;
    }
    if (
      CONFIG.expectedAccountHandle !== undefined &&
      (typeof CONFIG.expectedAccountHandle !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/u.test(CONFIG.expectedAccountHandle))
    )
      return null;
    return CONFIG;
  }
  return null;
}

async function waitForLocalReady() {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const text = document
      .querySelector("#persistence-status")
      ?.textContent?.trim();
    if (text === "保存済み") return "saved";
    if (text === "保存失敗" || text === "読み込み失敗") return "failed";
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return "timeout";
}

function createCoordinator(config, storage, statusClient, auth) {
  const syncStore = globalThis.tanikunSyncStore.createSyncStore({
    indexedDB: globalThis.indexedDB,
  });
  const metadataStore = globalThis.tanikunSyncMetadata.createSyncMetadataStore({
    indexedDB: globalThis.indexedDB,
  });
  const apiOrigin = config.apiOrigin ?? globalThis.location.origin;
  const transport =
    config.mode === M.DEV_BEARER
      ? createSyncTransport({
          fetch: callFetch,
          mode: M.DEV_BEARER,
          baseUrl: config.apiOrigin,
          token: config.token,
        })
      : createSyncTransport({
          fetch: callFetch,
          mode: M.SESSION,
          baseUrl: apiOrigin,
          getCsrfToken: () => statusClient?.csrfToken ?? "",
        });
  const accountHandle = config.mode === M.SESSION ? auth.accountHandle : null;
  const generation = config.mode === M.SESSION ? auth.generation : null;
  const authState = globalThis.tanikunAuthState;
  const plannerKey =
    config.mode === M.SESSION ? authState.plannerKey(auth) : "planner";
  const fence =
    config.mode === M.SESSION
      ? async () => {
          const scope = await authState.currentScope();
          if (
            scope.generation !== generation ||
            scope.accountHandle !== accountHandle
          )
            throw Object.assign(new Error("stale_account"), {
              code: "stale_account",
            });
          if (scope.sessionState !== "active")
            throw Object.assign(new Error("reauth_required"), {
              code: "reauth_required",
            });
        }
      : null;
  const verifySession =
    config.mode === M.SESSION
      ? async () => {
          const status = await statusClient.read();
          if (status.kind === "active") {
            if (status.session.account.handle !== accountHandle)
              throw Object.assign(new Error("account_changed"), {
                code: "account_changed",
              });
            return;
          }
          if (status.kind === "signed_out" || status.kind === "reauth_required")
            throw Object.assign(new Error("reauth_required"), {
              code: "reauth_required",
            });
          if (status.kind === "rate_limited")
            throw Object.assign(new Error("rate_limited"), {
              code: "rate_limited",
            });
          throw Object.assign(
            new Error(
              status.reason === "offline"
                ? "offline"
                : "temporarily_unavailable",
            ),
            {
              code:
                status.reason === "offline"
                  ? "offline"
                  : "temporarily_unavailable",
            },
          );
        }
      : null;
  return globalThis.tanikunSyncCoordinator.createSyncCoordinator({
    storage,
    transport,
    apiOrigin,
    syncStore,
    metadataStore,
    accountHandle,
    generation,
    plannerKey,
    fence,
    verifySession,
    syncLockName:
      config.mode === M.SESSION
        ? (documentId) =>
            authState.syncLockName({
              accountHandle,
              apiOrigin,
              documentId,
            })
        : null,
    maxRetry: Number.isSafeInteger(config.maxRetry)
      ? config.maxRetry
      : undefined,
    onStatus: ({ state, code, pending, retry_after }) => {
      if (
        CONFIG?.mode === M.SESSION &&
        (code === "unauthorized" || code === "reauth_required")
      ) {
        sessionClient?.clear();
        coordinator = null;
        notifyAuth({ code: "reauth_required" });
        setStatus("reauth_required");
        return;
      }
      if (
        CONFIG?.mode === M.SESSION &&
        (code === "stale_account" || code === "account_changed")
      ) {
        coordinator = null;
        notifyAuth({ code });
        setStatus("error", code);
        return;
      }
      if (CONFIG?.mode === M.SESSION && code === "history_mismatch") {
        notifyAuth({ code });
        setStatus("error", code);
        return;
      }
      setStatus(state, code, retry_after);
      if (state === "synced" && pending > 0) queueSync();
    },
  });
}

function start() {
  if (starting) return;
  starting = true;
  void startOnce()
    .catch(() => setStatus("error", "sync_setup_failed"))
    .finally(() => {
      starting = false;
    });
}

async function startOnce() {
  const config = readConfig();
  if (!config) {
    setStatus("unconfigured");
    return;
  }
  setStatus("starting");
  const storage = globalThis.tanikunStorage;
  if (!storage) {
    setStatus("error", "storage_unavailable");
    return;
  }
  const local = await waitForLocalReady();
  if (local !== "saved") {
    setStatus("error", "local_storage_unavailable");
    return;
  }
  if (config.mode === M.SESSION) {
    const authState = globalThis.tanikunAuthState;
    if (!authState) {
      setStatus("unconfigured");
      return;
    }
    const authController = globalThis.tanikunAuthController;
    await authController?.ready;
    const controllerState = authController?.state;
    if (controllerState?.kind === "malformed") {
      setStatus("error", "sync_setup_failed");
      return;
    }
    let auth;
    try {
      auth = await authState.read();
    } catch {
      setStatus("error", "auth_state_failed");
      return;
    }
    if (
      auth.sessionState !== "active" &&
      controllerState?.sessionState === "offline"
    ) {
      const retryAfter = controllerState.retryAfter;
      setStatus(
        retryAfter === undefined
          ? controllerState.reason === "server"
            ? "error"
            : "offline"
          : "error",
        retryAfter === undefined
          ? controllerState.reason === "server"
            ? "temporarily_unavailable"
            : "auth_bootstrap"
          : "rate_limited",
        retryAfter,
      );
      return;
    }
    if (auth.sessionState === "signed_out") {
      setStatus("signed_out");
      return;
    }
    if (auth.sessionState === "reauth_required") {
      setStatus("reauth_required");
      return;
    }
    const client =
      authController?.sessionClient ??
      createSessionStatusClient({
        fetch: callFetch,
        baseUrl: config.apiOrigin ?? globalThis.location.origin,
      });
    sessionClient = client;
    const status = await client.read();
    if (status.kind !== "active") {
      if (status.kind === "signed_out" || status.kind === "reauth_required") {
        try {
          auth = await authState.setSessionState("reauth_required");
        } catch {
          // The local plan remains editable even when the state write fails.
        }
        notifyAuth({ code: "reauth_required" });
        setStatus("reauth_required");
        return;
      }
      setStatus(
        status.reason === "offline" ? "offline" : "error",
        status.retryable
          ? status.kind === "rate_limited"
            ? "rate_limited"
            : status.reason === "server"
              ? "temporarily_unavailable"
              : "offline"
          : "sync_setup_failed",
        status.retry_after,
      );
      return;
    }
    if (
      status.session.account.handle !== auth.accountHandle ||
      (config.expectedAccountHandle !== undefined &&
        status.session.account.handle !== config.expectedAccountHandle)
    ) {
      notifyAuth({ code: "account_changed" });
      setStatus("error", "account_changed");
      return;
    }
    const localState = await waitForLocalReady();
    if (localState !== "saved") {
      setStatus("error", "local_storage_unavailable");
      return;
    }
    const storageScope = storage.scope?.();
    if (
      !storageScope ||
      storageScope.plannerKey !== authState.plannerKey(auth)
    ) {
      notifyAuth({ code: "stale_account" });
      setStatus("error", "stale_account");
      return;
    }
    if (await authState.isPendingUpload(auth.accountHandle)) {
      setStatus("pending_upload_consent");
      return;
    }
    installLocalSaveTrigger(storage);
    try {
      coordinator = createCoordinator(config, storage, client, auth);
    } catch {
      setStatus("error", "sync_setup_failed");
      return;
    }
    triggerSync();
    return;
  }
  installLocalSaveTrigger(storage);
  try {
    coordinator = createCoordinator(config, storage, sessionClient);
  } catch {
    setStatus("error", "sync_setup_failed");
    return;
  }
  triggerSync();
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  if (!event.target.closest("#sync-retry")) return;
  event.preventDefault();
  // The retry control is hidden as soon as the state becomes syncing. Move
  // focus to the stable status element after the event finishes so browser
  // focus restoration cannot fall through to the next control.
  triggerSync();
  setTimeout(() => {
    document.querySelector("#sync-status")?.focus({ preventScroll: true });
  }, 0);
});

const app = document.querySelector("#app");
if (app) {
  let renderedText = null;
  let renderedButton = null;
  new MutationObserver(() => {
    const text = document.querySelector("#sync-status-text");
    const button = document.querySelector("#sync-retry");
    if (text && (text !== renderedText || button !== renderedButton)) {
      renderedText = text;
      renderedButton = button;
      render();
    }
    const persistence = document
      .querySelector("#persistence-status")
      ?.textContent?.trim();
    if (
      persistence === "保存済み" &&
      !coordinator &&
      !starting &&
      current.code === "local_storage_unavailable"
    )
      void start();
  }).observe(app, { childList: true, subtree: true, characterData: true });
}

globalThis.tanikunSyncShell = Object.freeze({
  get status() {
    return { ...current };
  },
  get history() {
    return history.slice();
  },
  get session() {
    const account = sessionClient?.account;
    return account ? { account } : null;
  },
  sync: triggerSync,
  pauseForAuthChange,
  async refresh() {
    coordinator?.abort?.();
    coordinator = null;
    await start();
  },
});

render();
void start();
