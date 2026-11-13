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
  account_changed: "アカウントが変更されました",
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
    button.disabled = current.state === "syncing";
  }
}

const RETRYABLE_CODES = new Set([
  "offline",
  "timeout",
  "temporarily_unavailable",
  "sync_failed",
]);

function retryIsSafe(state, code) {
  return (
    state === "offline" || (state === "error" && RETRYABLE_CODES.has(code))
  );
}

function setStatus(state, code = null) {
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

function triggerSync() {
  if (!coordinator) {
    void start();
    return;
  }
  void coordinator.sync().catch((error) => {
    if (
      CONFIG?.mode === M.SESSION &&
      (error?.code === "unauthorized" || error?.code === "reauth_required")
    ) {
      sessionClient?.clear();
      coordinator = null;
      setStatus("reauth_required");
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

function createCoordinator(config, storage, statusClient) {
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
  return globalThis.tanikunSyncCoordinator.createSyncCoordinator({
    storage,
    transport,
    apiOrigin,
    syncStore,
    metadataStore,
    maxRetry: Number.isSafeInteger(config.maxRetry)
      ? config.maxRetry
      : undefined,
    onStatus: ({ state, code, pending }) => {
      if (
        config.mode === M.SESSION &&
        state === "error" &&
        (code === "unauthorized" || code === "reauth_required")
      ) {
        sessionClient?.clear();
        coordinator = null;
        setStatus("reauth_required");
        return;
      }
      setStatus(state, code);
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
    sessionClient = createSessionStatusClient({
      fetch: callFetch,
      baseUrl: config.apiOrigin ?? globalThis.location.origin,
    });
    let status;
    try {
      status = await sessionClient.read();
    } catch {
      sessionClient = null;
      setStatus("error", "sync_setup_failed");
      return;
    }
    if (status.kind === "active") {
      if (
        config.expectedAccountHandle !== undefined &&
        status.session.account.handle !== config.expectedAccountHandle
      ) {
        setStatus("error", "account_changed");
        return;
      }
    } else if (
      status.kind === "signed_out" ||
      status.kind === "reauth_required"
    ) {
      setStatus("reauth_required");
      return;
    } else {
      setStatus("error", "sync_setup_failed");
      return;
    }
    // #183 must supply account-scoped storage and generation fencing before
    // cookie sync can run. The current storage is the unbound offline plan;
    // authenticating alone never authorizes its upload or a remote merge.
    setStatus("unconfigured", "account_isolation_required");
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
});

render();
void start();
