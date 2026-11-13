import { AuthClientError, createAuthClient } from "./auth-client.js";
import {
  createSessionStatusClient,
  SESSION_STATUS_KINDS,
} from "./sync-session.js";

// Minimal Phase 5 account surface. Rabbita owns the planner shell and the
// account button mount point; this module owns the passkey dialog, local
// account state transitions, and the explicit copy/first-upload consent
// boundary. The session token stays in the HttpOnly cookie. The CSRF token
// lives only in the session status client's memory.
const CONFIG = globalThis["__TANIKUN_SYNC_CONFIG__"];
const SESSION_MODE = CONFIG?.mode === "session";
const authState = globalThis.tanikunAuthState;
const root = document.querySelector("#auth-root");
const accountButton = () => {
  const buttons = ["#account-button", "#account-button-mobile"]
    .map((selector) => document.querySelector(selector))
    .filter(Boolean);
  return (
    buttons.find((button) => button.getClientRects().length > 0) ??
    buttons[0] ??
    null
  );
};

const state = {
  auth: null,
  session: null,
  displayName: null,
  sessionState: "loading",
  busy: false,
  mode: "main",
  message: null,
  messageKind: "status",
  pendingCopy: false,
  pendingUpload: false,
  stale: false,
  historyMismatch: false,
  retryAfter: undefined,
  open: false,
};

let dialog = null;
let notice = null;
let refreshPromise = null;
let statusClient = null;
let authClient = null;
let controller = null;

function element(tag, properties = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(properties)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  }
  return node;
}

function actionButton(
  action,
  label,
  { primary = false, autofocus = false } = {},
) {
  const node = element(
    "button",
    {
      type: "button",
      "data-action": action,
      ...(autofocus ? { "data-autofocus": "true" } : {}),
      class: primary
        ? "min-h-11 w-full rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        : "min-h-11 w-full rounded-md border border-rule px-3 text-sm text-ink hover:bg-canvas disabled:opacity-50",
    },
    label,
  );
  return node;
}

function paragraph(text, className = "text-sm text-muted") {
  return element("p", { class: className }, text);
}

function errorMessage(error) {
  const code = error instanceof AuthClientError ? error.code : error?.code;
  switch (code) {
    case "canceled":
      return "操作をキャンセルしました。";
    case "unsupported":
      return "このブラウザまたは端末ではパスキーを利用できません。";
    case "expired":
      return "認証の有効期限が切れたか、確認できませんでした。もう一度お試しください。";
    case "offline":
      return "オフラインです。接続を確認して、もう一度お試しください。";
    case "timeout":
      return "認証がタイムアウトしました。もう一度お試しください。";
    case "rate_limited":
      return "しばらく待ってから再試行してください。";
    case "already_authenticated":
      return "すでにサインインしています。";
    case "credential_conflict":
      return "このパスキーは既に登録されています。別の端末のパスキーを使ってください。";
    case "csrf_forbidden":
      return "セッションを更新できませんでした。もう一度お試しください。";
    case "unauthorized":
    case "reauth_required":
      return "セッションの有効期限が切れました。サインインし直してください。";
    case "account_changed":
      return "別のアカウントのセッションに変わりました。サインインし直してください。";
    case "not_found":
      return "この環境ではアカウント機能を利用できません。";
    case "temporarily_unavailable":
      return "サーバーに一時的に接続できません。少し待ってから再試行してください。";
    default:
      return "認証を完了できませんでした。もう一度お試しください。";
  }
}

function descriptionForStatus(status) {
  switch (status.kind) {
    case SESSION_STATUS_KINDS.SIGNED_OUT:
      return "サインインしていません。";
    case SESSION_STATUS_KINDS.REAUTH_REQUIRED:
      return "セッションの有効期限が切れました。ローカルのプランはそのまま編集できます。同期は停止しています。";
    case SESSION_STATUS_KINDS.RATE_LIMITED:
      return status.retry_after
        ? `認証状態を確認できません。${status.retry_after}秒ほど待ってから再試行してください。`
        : "認証状態を確認できません。しばらく待ってから再試行してください。";
    case SESSION_STATUS_KINDS.MALFORMED:
      return "認証状態を確認できませんでした。";
    default:
      return "サーバーに接続できません。ローカルの編集は保存されます。";
  }
}

async function pauseSync() {
  try {
    await globalThis.tanikunSyncShell?.pauseForAuthChange?.();
  } catch {
    // A missing or already stopped shell does not block a local state change.
  }
}

function refreshAccountButton() {
  const buttons = ["#account-button", "#account-button-mobile"]
    .map((selector) => document.querySelector(selector))
    .filter(Boolean);
  if (buttons.length === 0) return;
  const bar = document.querySelector("#account-mobile-bar");
  bar?.classList.remove("hidden");
  for (const button of buttons) button.classList.remove("hidden");
  let label = "サインイン";
  if (state.sessionState === "active") {
    label =
      state.pendingUpload || state.pendingCopy
        ? "要確認"
        : state.displayName?.trim() || "アカウント";
  } else if (state.sessionState === "reauth_required") label = "再認証";
  else if (state.sessionState === "loading") label = "アカウント…";
  else if (state.stale || state.historyMismatch) label = "要確認";
  for (const button of buttons) {
    button.textContent = label;
    button.setAttribute(
      "aria-label",
      state.sessionState === "active"
        ? `アカウント: ${label}。アカウント情報を開く`
        : `${label}。アカウント情報を開く`,
    );
  }
}

function renderAccountButton() {
  refreshAccountButton();
}

function openSettingsSection() {
  const section = document.querySelector("#account-settings-section");
  if (!section) return;
  section.classList.remove("hidden");
  const button = section.querySelector("#open-account-settings");
  if (!button || button.dataset.bound === "true") return;
  button.dataset.bound = "true";
  button.addEventListener("click", () => openDialog());
}

function createNotice() {
  if (!root) return null;
  const node = element("div", {
    id: "auth-notice",
    class:
      "fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-lg flex-col gap-2 rounded-lg border border-rule bg-paper p-3 text-sm shadow-lg sm:flex-row sm:items-center sm:justify-between",
    role: "status",
    "aria-live": "polite",
  });
  root.append(node);
  return node;
}

function hideNotice() {
  notice?.remove();
  notice = null;
}

function renderNotice() {
  if (!root) return;
  let text = null;
  let action = null;
  let alert = false;
  if (state.stale) {
    text = "アカウントが切り替わりました。この画面の編集内容は残っています。";
    action = "copy-edited";
    alert = true;
  } else if (state.historyMismatch) {
    text =
      "サーバーとローカルの履歴が異なるため同期を停止しました。どちらも保持しています。";
    action = "download-local";
    alert = true;
  } else if (state.pendingUpload) {
    text = "ローカルコピーの初回アップロードはまだ許可されていません。";
    action = "open-account";
  } else if (state.pendingCopy) {
    text =
      "サインイン前のプランをこのアカウントにコピーするか確認してください。";
    action = "open-account";
  }
  if (!text) {
    hideNotice();
    return;
  }
  notice ??= createNotice();
  if (!notice) return;
  notice.setAttribute("role", alert ? "alert" : "status");
  const label = state.stale
    ? "編集内容をコピー"
    : state.historyMismatch
      ? "ローカルプランを書き出す"
      : "確認する";
  notice.replaceChildren(
    element("p", { class: "min-w-0" }, text),
    element(
      "div",
      { class: "flex shrink-0 gap-2" },
      element(
        "button",
        {
          type: "button",
          class:
            "min-h-9 rounded-md bg-primary px-3 text-xs font-medium text-white hover:bg-primary/90",
          "data-notice-action": action === "open-account" ? "open" : action,
        },
        label,
      ),
      state.stale || state.historyMismatch
        ? element(
            "button",
            {
              type: "button",
              class:
                "min-h-9 rounded-md border border-rule px-3 text-xs text-ink hover:bg-canvas",
              "data-notice-action": "reload",
            },
            "再読み込み",
          )
        : null,
    ),
  );
  notice.querySelectorAll("[data-notice-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const actionName = button.dataset.noticeAction;
      if (actionName === "open") openDialog();
      else if (actionName === "reload") globalThis.location.reload();
      else if (actionName === "copy-edited") void copyEditedPlan();
      else if (actionName === "download-local") downloadPlan();
    });
  });
}

function disclosure() {
  return element(
    "div",
    { class: "space-y-2 rounded-md bg-canvas p-3 text-xs text-muted" },
    paragraph(
      "パスキーをすべて失うと、このアカウントにはサインインできません。パスワード、メール、復旧コード、サポートによる迂回はありません。",
    ),
    paragraph(
      "サインアウトしても、この端末のローカルデータは削除されません。また暗号化もされません。認証はPhase 6の文書鍵を提供しません。",
    ),
  );
}

function copySection() {
  return element(
    "section",
    {
      class: "space-y-2 rounded-md border border-rule p-3",
      "aria-labelledby": "auth-copy-title",
    },
    element(
      "h3",
      { id: "auth-copy-title", class: "text-sm font-semibold" },
      "サインイン前のプラン",
    ),
    paragraph(
      "この端末にはサインイン前のプランがあります。このアカウントにローカルコピーを作成できます。元のプランは残り、自動アップロードは行われません。",
    ),
    actionButton("copy-plan", "ローカルコピーを作成", { primary: true }),
    actionButton("decline-copy", "コピーしない"),
  );
}

function uploadSection() {
  return element(
    "section",
    {
      class: "space-y-2 rounded-md border border-rule p-3",
      "aria-labelledby": "auth-upload-title",
    },
    element(
      "h3",
      { id: "auth-upload-title", class: "text-sm font-semibold" },
      "初回アップロードの確認",
    ),
    paragraph(
      "ローカルコピーはまだサーバーに送信されていません。初回アップロードを許可するまで同期は停止します。",
    ),
    actionButton("consent-upload", "初回アップロードを許可", { primary: true }),
    actionButton("decline-upload", "今はアップロードしない"),
  );
}

function staleSection() {
  return element(
    "section",
    {
      class: "space-y-2 rounded-md border border-danger/30 bg-danger/5 p-3",
      "aria-labelledby": "auth-stale-title",
    },
    element(
      "h3",
      { id: "auth-stale-title", class: "text-sm font-semibold" },
      "アカウントが切り替わりました",
    ),
    paragraph(
      "別のタブまたは操作でアカウントが変わりました。この画面の編集内容は残っています。コピーまたは書き出しをしてから再読み込みしてください。",
    ),
    actionButton("copy-edited", "編集内容をコピー", { primary: true }),
    actionButton("download-edited", "編集内容を書き出す"),
    actionButton("reload", "再読み込み"),
  );
}

function historySection() {
  return element(
    "section",
    {
      class: "space-y-2 rounded-md border border-danger/30 bg-danger/5 p-3",
      "aria-labelledby": "auth-history-title",
    },
    element(
      "h3",
      { id: "auth-history-title", class: "text-sm font-semibold" },
      "同期を停止しました",
    ),
    paragraph(
      "サーバーとこのアカウントのローカル履歴が異なるため、自動統合せずに停止しました。両方のプランとカーソルは保持しています。ローカルプランを書き出してから再読み込みしてください。",
    ),
    actionButton("download-local", "ローカルプランを書き出す", {
      primary: true,
    }),
    actionButton("reload", "再読み込み"),
  );
}

function signedOutBody() {
  return [
    paragraph(
      "Tanikunのアカウントはパスキーで保護されます。パスキーはこの端末またはパスワードマネージャーに保存されます。",
    ),
    actionButton("register-start", "パスキーで新規登録", {
      primary: true,
      autofocus: true,
    }),
    actionButton("sign-in", "パスキーでサインイン"),
  ];
}

function reauthBody() {
  return [
    paragraph(
      "セッションの有効期限が切れました。ローカルのプランはそのまま編集できます。同期は停止しています。",
    ),
    actionButton("sign-in", "再認証する", { primary: true, autofocus: true }),
  ];
}

function activeBody() {
  const body = [
    element(
      "p",
      { class: "text-sm" },
      state.displayName
        ? `サインイン中: ${state.displayName}`
        : "サインイン中のアカウント",
    ),
  ];
  if (state.stale) body.push(staleSection());
  if (state.historyMismatch) body.push(historySection());
  if (state.pendingCopy) body.push(copySection());
  if (state.pendingUpload) body.push(uploadSection());
  if (state.pendingCopy && !state.pendingUpload)
    body.push(
      paragraph(
        "サインイン前のプランはまだこのアカウントにコピーされていません。",
        "text-xs text-muted",
      ),
    );
  body.push(actionButton("logout", "サインアウト"));
  return body;
}

function registrationBody() {
  return [
    element(
      "label",
      { for: "auth-display-name", class: "block text-sm font-medium" },
      "表示名（任意）",
    ),
    element("input", {
      id: "auth-display-name",
      type: "text",
      maxlength: "80",
      autocomplete: "nickname",
      class:
        "min-h-11 w-full rounded-md border border-rule bg-paper px-3 text-sm",
      "aria-describedby": "auth-display-name-help",
    }),
    element(
      "p",
      { id: "auth-display-name-help", class: "text-xs text-muted" },
      "1〜80文字。空欄の場合は「Tanikun user」になります。",
    ),
    actionButton("register-submit", "パスキーを作成", {
      primary: true,
      autofocus: true,
    }),
    actionButton("back", "戻る"),
  ];
}

function mainBody() {
  if (state.mode === "register") return registrationBody();
  if (state.stale || state.historyMismatch) {
    return [
      ...(state.stale ? [staleSection()] : []),
      ...(state.historyMismatch ? [historySection()] : []),
    ];
  }
  if (state.sessionState === "active") return activeBody();
  if (state.sessionState === "reauth_required") return reauthBody();
  if (state.sessionState === "loading")
    return [paragraph("アカウント状態を確認しています。")];
  if (state.sessionState === "offline") {
    return [
      paragraph(
        descriptionForStatus({ kind: SESSION_STATUS_KINDS.UNAVAILABLE }),
      ),
      actionButton("retry", "再試行", { primary: true, autofocus: true }),
      actionButton("sign-in", "パスキーでサインイン"),
    ];
  }
  if (state.auth?.sessionState === "active") return activeBody();
  return signedOutBody();
}

function renderDialog() {
  if (!state.open || !dialog) return;
  const activeAction = document.activeElement
    ?.closest?.("[data-action]")
    ?.getAttribute("data-action");
  const body = mainBody();
  if (
    state.sessionState === "active" &&
    !state.pendingCopy &&
    !state.pendingUpload
  ) {
    body.push(disclosure());
  } else if (state.sessionState === "active") {
    body.push(disclosure());
  } else if (state.mode === "register") {
    body.push(disclosure());
  }
  dialog.body.replaceChildren(...body);
  const message = state.message;
  dialog.status.textContent = message ?? "";
  dialog.status.className =
    state.messageKind === "alert"
      ? "mt-3 min-h-5 text-sm text-danger-text"
      : "mt-3 min-h-5 text-sm text-muted";
  for (const button of dialog.body.querySelectorAll("button")) {
    button.disabled = state.busy;
  }
  const input = dialog.body.querySelector("#auth-display-name");
  if (input) input.disabled = state.busy;
  const focusTarget =
    (activeAction &&
      dialog.body.querySelector(`[data-action="${activeAction}"]`)) ||
    dialog.body.querySelector("[data-autofocus]") ||
    dialog.body.querySelector("button");
  if (focusTarget && !focusTarget.disabled)
    focusTarget.focus({ preventScroll: true });
}

function openDialog() {
  if (!SESSION_MODE || !root) return;
  if (state.open) return;
  state.open = true;
  const panel = element("div", {
    id: "auth-dialog",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "auth-dialog-title",
    class:
      "max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-xl border border-rule bg-paper p-4 shadow-xl sm:p-5",
  });
  const close = element(
    "button",
    {
      type: "button",
      id: "auth-close",
      "data-dialog-close": "true",
      "aria-label": "アカウント画面を閉じる",
      class:
        "min-h-9 min-w-9 rounded-md border border-rule px-2 text-sm text-muted hover:bg-canvas",
    },
    "×",
  );
  const bodyNode = element("div", { class: "mt-3 space-y-3" });
  const status = element("p", {
    id: "auth-dialog-status",
    role: "status",
    "aria-live": "polite",
    class: "mt-3 min-h-5 text-sm text-muted",
  });
  const backdrop = element(
    "div",
    {
      id: "auth-backdrop",
      class:
        "fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3 sm:items-center",
    },
    element("div", { class: "flex max-h-full flex-col" }, panel),
  );
  panel.append(
    element(
      "div",
      { class: "flex items-center justify-between gap-3" },
      element(
        "h2",
        { id: "auth-dialog-title", class: "text-base font-semibold" },
        "アカウント",
      ),
      close,
    ),
    bodyNode,
    status,
  );
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeDialog();
  });
  close.addEventListener("click", closeDialog);
  root.append(backdrop);
  dialog = { backdrop, panel, body: bodyNode, status, bound: false };
  bindDialogActions();
  renderDialog();
  panel.querySelector("[data-autofocus]")?.focus({ preventScroll: true });
}

function closeDialog() {
  if (!dialog) return;
  dialog.backdrop.remove();
  dialog = null;
  state.open = false;
  state.mode = "main";
  state.message = null;
  state.messageKind = "status";
  accountButton()?.focus({ preventScroll: true });
}

function setMessage(message, kind = "status") {
  state.message = message;
  state.messageKind = kind;
  renderDialog();
}

async function copyNeeded(handle) {
  if (!authState || typeof handle !== "string") return false;
  if (await authState.accountPlanExists(handle)) return false;
  if (await authState.isCopyDeclined(handle)) return false;
  return authState.planExists("planner");
}

async function adoptActiveSession(session) {
  await pauseSync();
  await authState.write({
    accountHandle: session.account.handle,
    sessionState: "active",
  });
  state.auth = await authState.read();
  state.displayName = session.account.display_name;
  state.session = session;
  state.sessionState = "active";
  try {
    await statusClient.read();
  } catch {
    // The coordinator verifies the session again before sync.
  }
}

async function afterSignIn(session) {
  await adoptActiveSession(session);
  const needsCopy = await copyNeeded(session.account.handle);
  state.pendingUpload = await authState.isPendingUpload(session.account.handle);
  state.pendingCopy = needsCopy;
  state.busy = false;
  renderAccountButton();
  renderNotice();
  if (needsCopy) {
    state.mode = "main";
    renderDialog();
    return;
  }
  closeDialog();
  globalThis.location.reload();
}

async function recoverCeremony() {
  try {
    const status = await statusClient.read();
    if (status.kind !== SESSION_STATUS_KINDS.ACTIVE) return false;
    await afterSignIn(status.session);
    return true;
  } catch {
    return false;
  }
}

async function register() {
  if (state.busy || !authClient) return;
  const handle = state.auth?.accountHandle;
  if (handle) {
    setMessage("すでにサインインしています。", "alert");
    return;
  }
  const input = dialog?.body.querySelector("#auth-display-name");
  const displayName = input?.value.trim() ?? "";
  state.busy = true;
  state.message = null;
  renderDialog();
  try {
    const session = await authClient.register({
      displayName: displayName.length > 0 ? displayName : undefined,
    });
    await afterSignIn(session);
  } catch (error) {
    if (error?.code === "offline" || error?.code === "timeout") {
      if (await recoverCeremony()) return;
    }
    state.busy = false;
    setMessage(errorMessage(error), "alert");
  }
}

async function signIn() {
  if (state.busy || !authClient) return;
  state.busy = true;
  state.message = null;
  renderDialog();
  try {
    const session = await authClient.signIn();
    await afterSignIn(session);
  } catch (error) {
    if (error?.code === "offline" || error?.code === "timeout") {
      if (await recoverCeremony()) return;
    }
    state.busy = false;
    if (error?.code === "expired") {
      state.message =
        "認証の有効期限が切れたか、確認できませんでした。もう一度お試しください。";
      state.messageKind = "alert";
      state.mode = "main";
      renderDialog();
      return;
    }
    setMessage(errorMessage(error), "alert");
  }
}

async function logout() {
  if (state.busy || !authState) return;
  state.busy = true;
  state.message = null;
  renderDialog();
  await pauseSync();
  try {
    let csrf = statusClient?.csrfToken ?? undefined;
    try {
      await authClient.logout({ csrfToken: csrf });
    } catch (error) {
      if (error?.code === "csrf_forbidden") {
        const refreshed = await statusClient.read();
        if (refreshed.kind === SESSION_STATUS_KINDS.ACTIVE)
          await authClient.logout({ csrfToken: statusClient.csrfToken });
        else if (refreshed.kind !== SESSION_STATUS_KINDS.SIGNED_OUT)
          throw error;
      } else if (error?.code !== "unauthorized" && error?.code !== "expired") {
        throw error;
      }
    }
    await authState.write({ accountHandle: null, sessionState: "signed_out" });
    statusClient.clear();
    state.busy = false;
    state.session = null;
    state.displayName = null;
    state.pendingCopy = false;
    state.pendingUpload = false;
    closeDialog();
    globalThis.location.reload();
  } catch (error) {
    state.busy = false;
    setMessage(errorMessage(error), "alert");
  }
}

async function copyPlan() {
  if (state.busy || !authState) return;
  const handle = state.auth?.accountHandle;
  if (!handle) return;
  state.busy = true;
  state.message = null;
  renderDialog();
  try {
    await authState.copyUnboundToAccount(handle);
    state.busy = false;
    closeDialog();
    globalThis.location.reload();
  } catch (error) {
    state.busy = false;
    setMessage(errorMessage(error), "alert");
  }
}

async function declineCopy() {
  if (state.busy || !authState) return;
  const handle = state.auth?.accountHandle;
  if (!handle) return;
  state.busy = true;
  try {
    await authState.setCopyDeclined(handle, true);
    closeDialog();
    globalThis.location.reload();
  } catch (error) {
    state.busy = false;
    setMessage(errorMessage(error), "alert");
  }
}

async function consentUpload() {
  if (state.busy || !authState || !state.auth?.accountHandle) return;
  state.busy = true;
  try {
    await authState.setPendingUpload(state.auth.accountHandle, false);
    state.pendingUpload = false;
    state.busy = false;
    closeDialog();
    renderAccountButton();
    renderNotice();
    await globalThis.tanikunSyncShell?.refresh?.();
  } catch (error) {
    state.busy = false;
    setMessage(errorMessage(error), "alert");
  }
}

function editedPlanText() {
  const storage = globalThis.tanikunStorage;
  if (!storage) return null;
  const rejected = storage.lastRejectedText?.();
  if (typeof rejected === "string" && rejected.length > 0) return rejected;
  const snapshot = storage.snapshot?.();
  if (snapshot?.storageVersion === 2 && snapshot.bytes instanceof Uint8Array) {
    try {
      const document = globalThis.Automerge.load(snapshot.bytes);
      return globalThis.tanikunDocument.text(document);
    } catch {
      return null;
    }
  }
  return null;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    area.remove();
    return copied;
  }
}

async function copyEditedPlan() {
  const text = editedPlanText();
  if (!text) {
    setMessage("コピーできるプランが見つかりません。", "alert");
    return;
  }
  const copied = await copyText(text);
  setMessage(
    copied
      ? "編集内容をコピーしました。"
      : "コピーできませんでした。書き出しを試してください。",
    copied ? "status" : "alert",
  );
}

function downloadPlan() {
  const text = editedPlanText();
  if (!text) {
    setMessage("書き出せるプランが見つかりません。", "alert");
    return;
  }
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "tanikun-plan-recovery.json";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  setMessage("ローカルプランを書き出しました。", "status");
}

async function onAction(action) {
  switch (action) {
    case "register-start":
      state.mode = "register";
      state.message = null;
      renderDialog();
      break;
    case "back":
      state.mode = "main";
      state.message = null;
      renderDialog();
      break;
    case "register-submit":
      await register();
      break;
    case "sign-in":
      await signIn();
      break;
    case "logout":
      await logout();
      break;
    case "copy-plan":
      await copyPlan();
      break;
    case "decline-copy":
      await declineCopy();
      break;
    case "consent-upload":
      await consentUpload();
      break;
    case "decline-upload":
      closeDialog();
      break;
    case "copy-edited":
      await copyEditedPlan();
      break;
    case "download-edited":
    case "download-local":
      downloadPlan();
      break;
    case "reload":
      globalThis.location.reload();
      break;
    case "retry":
      await refresh();
      break;
    default:
      break;
  }
}

function bindDialogActions() {
  if (!dialog || dialog.bound) return;
  dialog.bound = true;
  dialog.body.addEventListener("click", (event) => {
    const button = event.target.closest?.("button[data-action]");
    if (!button) return;
    void onAction(button.getAttribute("data-action"));
  });
}

async function refresh() {
  if (!SESSION_MODE || !authState || !statusClient) return null;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    state.sessionState = "loading";
    state.message = null;
    state.messageKind = "status";
    renderAccountButton();
    try {
      state.auth = await authState.read();
    } catch {
      state.sessionState = "offline";
      state.message = "ローカルのアカウント状態を読み込めませんでした。";
      state.messageKind = "alert";
      renderAccountButton();
      renderNotice();
      renderDialog();
      return null;
    }
    const status = await statusClient.read();
    state.kind = status.kind;
    state.reason = status.reason;
    if (status.kind === SESSION_STATUS_KINDS.ACTIVE) {
      const session = status.session;
      if (
        state.auth.accountHandle !== null &&
        state.auth.accountHandle !== session.account.handle
      ) {
        state.sessionState =
          state.auth.sessionState === "reauth_required"
            ? "reauth_required"
            : "active";
        state.message =
          "別のアカウントのセッションに変わりました。サインインし直してください。";
        state.messageKind = "alert";
        state.displayName = null;
      } else {
        if (
          state.auth.sessionState !== "active" ||
          state.auth.accountHandle !== session.account.handle
        ) {
          await pauseSync();
          await authState.write({
            accountHandle: session.account.handle,
            sessionState: "active",
          });
          state.auth = await authState.read();
        }
        state.session = session;
        state.displayName = session.account.display_name;
        state.sessionState = "active";
        state.pendingUpload = await authState.isPendingUpload(
          session.account.handle,
        );
        state.pendingCopy =
          !state.pendingUpload && (await copyNeeded(session.account.handle));
      }
    } else if (
      status.kind === SESSION_STATUS_KINDS.SIGNED_OUT ||
      status.kind === SESSION_STATUS_KINDS.REAUTH_REQUIRED
    ) {
      if (state.auth.sessionState === "active") {
        await pauseSync();
        state.auth = await authState.setSessionState("reauth_required");
      }
      state.session = null;
      state.sessionState =
        state.auth.sessionState === "signed_out"
          ? "signed_out"
          : "reauth_required";
    } else if (status.kind === SESSION_STATUS_KINDS.MALFORMED) {
      state.session = null;
      state.sessionState = "error";
      state.message = descriptionForStatus(status);
      state.messageKind = "alert";
    } else {
      state.session = null;
      state.sessionState =
        state.auth.sessionState === "reauth_required"
          ? "reauth_required"
          : "offline";
      state.retryAfter = status.retry_after;
      state.message = descriptionForStatus(status);
      state.messageKind = "status";
    }
    state.busy = false;
    renderAccountButton();
    renderNotice();
    openSettingsSection();
    renderDialog();
    return state.auth;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

function handleSyncStatus(status = {}) {
  if (status.code === "reauth_required" || status.code === "unauthorized") {
    state.sessionState = "reauth_required";
    if (state.auth?.sessionState === "active") {
      void authState
        .setSessionState("reauth_required")
        .then((next) => {
          state.auth = next;
        })
        .catch(() => {});
    }
    renderAccountButton();
  } else if (status.code === "stale_account") {
    state.stale = true;
    renderAccountButton();
    renderNotice();
  } else if (status.code === "history_mismatch") {
    state.historyMismatch = true;
    renderAccountButton();
    renderNotice();
  } else if (status.code === "account_changed") {
    state.message =
      "別のアカウントのセッションに変わりました。サインインし直してください。";
    state.messageKind = "alert";
    renderDialog();
  }
  renderDialog();
}

function boot() {
  if (!SESSION_MODE || !authState || !root) return;
  statusClient = createSessionStatusClient({
    fetch: (...args) => globalThis.fetch(...args),
    baseUrl: CONFIG.apiOrigin ?? globalThis.location.origin,
  });
  authClient = createAuthClient({
    fetch: (...args) => globalThis.fetch(...args),
    baseUrl: CONFIG.apiOrigin ?? globalThis.location.origin,
  });
  controller = {
    ready: null,
    sessionClient: statusClient,
    get state() {
      return { ...state };
    },
    refresh,
    open: openDialog,
    onSyncStatus: handleSyncStatus,
  };
  globalThis.tanikunAuthController = controller;
  controller.ready = refresh();
  globalThis.tanikunAuthBootstrap = controller.ready;
  authState.subscribe((next) => {
    const current = state.auth;
    if (
      !current ||
      next.generation !== current.generation ||
      next.accountHandle !== current.accountHandle
    ) {
      state.auth = next;
      state.stale = true;
      state.sessionState =
        next.sessionState === "signed_out" ? "signed_out" : next.sessionState;
      void pauseSync();
    } else if (next.sessionState !== current.sessionState) {
      state.auth = next;
      state.sessionState =
        next.sessionState === "signed_out" ? "signed_out" : next.sessionState;
    } else {
      return;
    }
    renderAccountButton();
    renderNotice();
    renderDialog();
  });
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest("#account-button") ||
      target.closest("#account-button-mobile")
    ) {
      event.preventDefault();
      openDialog();
      return;
    }
    if (target.closest("#open-account-settings")) {
      event.preventDefault();
      openDialog();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.open) {
      event.preventDefault();
      closeDialog();
    }
  });
  const observer = new MutationObserver(() => {
    if (
      document.querySelector("#account-button")?.classList.contains("hidden") ||
      document
        .querySelector("#account-button-mobile")
        ?.classList.contains("hidden")
    )
      refreshAccountButton();
    openSettingsSection();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

boot();
