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
  retryNotBefore: 0,
  retryTimer: null,
  ceremony: null,
  ceremonyReason: null,
  decisionScope: null,
  credentials: null,
  credentialsLoading: false,
  credentialsError: null,
  pendingRemoval: null,
  open: false,
};

let dialog = null;
let notice = null;
let refreshPromise = null;
let lifecycleEpoch = 0;
let statusClient = null;
let authClient = null;
let controller = null;
let opening = false;
let credentialsPromise = null;
let logoutPending = false;

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
  { primary = false, autofocus = false, danger = false } = {},
) {
  const node = element(
    "button",
    {
      type: "button",
      "data-action": action,
      ...(autofocus ? { "data-autofocus": "true" } : {}),
      class: danger
        ? "min-h-11 w-full rounded-md bg-danger-text px-3 text-sm font-medium text-white hover:bg-danger-text/90 disabled:opacity-50"
        : primary
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
    case "credential_limit":
      return "パスキーは20個までです。不要なパスキーを削除してから追加してください。";
    case "last_credential":
      return "最後のパスキーは削除できません。先に別のパスキーを追加してください。";
    case "recent_auth_required":
      return "安全のため、現在のパスキーでもう一度本人確認してください。";
    case "csrf_forbidden":
      return "セッションを更新できませんでした。もう一度お試しください。";
    case "unauthorized":
    case "reauth_required":
      return "セッションの有効期限が切れました。サインインし直してください。";
    case "account_changed":
      return "別のアカウントのセッションに変わりました。サインインし直してください。";
    case "stale_account":
      return "別のアカウントに切り替わりました。この画面の編集内容は残っています。";
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

function scopeOf(auth) {
  if (!auth) return null;
  return {
    generation: auth.generation,
    accountHandle: auth.accountHandle,
    sessionState: auth.sessionState,
  };
}

function sameScope(left, right) {
  return (
    left !== null &&
    right !== null &&
    left.generation === right.generation &&
    left.accountHandle === right.accountHandle &&
    left.sessionState === right.sessionState
  );
}

async function currentScope() {
  const current = await authState.read();
  state.auth = current;
  return scopeOf(current);
}

function abortCeremony(reason) {
  if (!state.ceremony) return;
  state.ceremonyReason = reason;
  state.ceremony.abort();
  state.ceremony = null;
}

function setRetryCooldown(seconds) {
  clearTimeout(state.retryTimer);
  const wait =
    Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined;
  state.retryAfter = wait;
  state.retryNotBefore = wait === undefined ? 0 : Date.now() + wait * 1000;
  if (state.retryNotBefore > Date.now())
    state.retryTimer = setTimeout(() => {
      state.retryNotBefore = 0;
      state.retryTimer = null;
      renderDialog();
    }, state.retryNotBefore - Date.now());
}

const AUTH_COOLDOWN_ACTIONS = new Set([
  "register-start",
  "register-submit",
  "sign-in",
  "retry",
  "add-passkey-confirm",
  "add-passkey-create",
  "remove-passkey-confirm",
]);

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
  button.addEventListener("click", () => void openDialog());
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
      if (actionName === "open") void openDialog();
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
      "パスキーを追加しても、暗号化キーの登録や、失われた暗号化キーの復旧は行われません。",
    ),
    paragraph(
      "サインアウトしても、この端末のローカルデータは削除されません。サインインしてもローカルデータは暗号化されず、失われた暗号化鍵を復旧することもできません。",
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

function formatTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) return "不明";
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return "不明";
  }
}

function timestampIso(value) {
  try {
    return new Date(value).toISOString();
  } catch {
    return "";
  }
}

function sortedCredentials(credentials) {
  return credentials.toSorted(
    (left, right) =>
      left.created_at - right.created_at || left.id.localeCompare(right.id),
  );
}

function credentialSection() {
  const credentials = state.credentials;
  const known = Array.isArray(credentials);
  const count = known ? credentials.length : 0;
  const children = [
    element(
      "h3",
      { id: "auth-credentials-title", class: "text-sm font-semibold" },
      "パスキー",
    ),
    paragraph(
      "このアカウントでサインインに使えるパスキーです。パスキーを追加しても、暗号化キーの登録や失われた鍵の復旧は行われません。",
    ),
  ];
  if (state.credentialsLoading && !known) {
    children.push(
      paragraph("パスキーを読み込んでいます。", "text-xs text-muted"),
    );
  } else if (state.credentialsError) {
    children.push(
      element(
        "p",
        { role: "alert", class: "text-sm text-danger-text" },
        state.credentialsError,
      ),
      actionButton("reload-credentials", "一覧を再読み込み"),
    );
  } else if (known) {
    if (count === 0) {
      children.push(paragraph("登録済みのパスキーを読み込めませんでした。"));
    } else {
      const list = element("ul", {
        class: "list-none space-y-2 p-0",
        "aria-label": "登録済みのパスキー",
      });
      credentials.forEach((credential, index) => {
        const label = `パスキー ${index + 1}`;
        const created = formatTimestamp(credential.created_at);
        const lastUsed = formatTimestamp(credential.last_used_at);
        const backup = credential.backup_eligible
          ? credential.backup_state
            ? "バックアップ対象（バックアップ済み）"
            : "バックアップ対象"
          : "バックアップ対象外";
        const detail = element(
          "div",
          { class: "min-w-0 space-y-1" },
          element("p", { class: "break-words text-sm font-medium" }, label),
          element(
            "p",
            { class: "text-xs text-muted" },
            "作成: ",
            element(
              "time",
              { datetime: timestampIso(credential.created_at) },
              created,
            ),
          ),
          element(
            "p",
            { class: "text-xs text-muted" },
            "最終使用: ",
            element(
              "time",
              { datetime: timestampIso(credential.last_used_at) },
              lastUsed,
            ),
          ),
          element("p", { class: "text-xs text-muted" }, backup),
        );
        const remove = element(
          "button",
          {
            type: "button",
            "data-action": "remove-passkey",
            "data-credential-index": String(index),
            "aria-label": `${label}（作成 ${created}）を削除`,
            ...(count <= 1 ? { disabled: true, "data-disabled": "true" } : {}),
            class:
              "min-h-9 shrink-0 rounded-md border border-danger/30 px-3 text-xs text-danger-text hover:bg-danger/10 disabled:opacity-50",
          },
          "削除",
        );
        list.append(
          element(
            "li",
            {
              class:
                "flex flex-wrap items-start justify-between gap-2 rounded-md border border-rule bg-canvas p-2",
            },
            detail,
            remove,
          ),
        );
      });
      children.push(list);
    }
    if (count >= 20) {
      children.push(
        paragraph(
          "パスキーは20個までです。追加するには、不要なパスキーを削除してください。",
        ),
      );
    } else {
      children.push(
        actionButton("add-passkey", "パスキーを追加", { primary: true }),
      );
    }
    if (count === 1) {
      children.push(
        element(
          "p",
          {
            id: "auth-last-credential-note",
            class: "text-xs text-muted",
          },
          "最後のパスキーは削除できません。先に別のパスキーを追加してください。",
        ),
      );
    }
    children.push(
      paragraph(
        "すべてのパスキーを失うと、このアカウントにはサインインできません。パスワード、メール、復旧コード、サポートによる復旧はありません。",
        "text-xs text-muted",
      ),
    );
  }
  return element(
    "section",
    {
      class: "space-y-2 rounded-md border border-rule p-3",
      "aria-labelledby": "auth-credentials-title",
      ...(state.credentialsLoading ? { "aria-busy": "true" } : {}),
    },
    children,
  );
}

function addPasskeyBody() {
  const count = state.credentials?.length ?? 0;
  const recent = state.session?.recent_auth === true;
  const body = [
    element("h3", { class: "text-sm font-semibold" }, "パスキーを追加"),
    paragraph(
      "パスキーを追加すると、このアカウントのサインイン手段が増えます。暗号化キーや失われたデータの復旧にはなりません。",
    ),
    paragraph(
      recent
        ? "この操作を確認してください。追加する前に、現在のパスキーで本人確認を行う場合があります。"
        : "安全のため、追加する前に現在のパスキーで本人確認を行います。",
    ),
  ];
  if (count >= 20) {
    body.push(
      element(
        "p",
        { class: "text-sm text-danger-text" },
        "パスキーは20個までです。追加するには、不要なパスキーを削除してください。",
      ),
    );
  } else {
    body.push(
      actionButton(
        "add-passkey-confirm",
        recent ? "パスキーを追加" : "本人確認して追加",
        { primary: true, autofocus: true },
      ),
    );
  }
  body.push(actionButton("add-passkey-back", "キャンセル"));
  return body;
}

function addPasskeyReadyBody() {
  return [
    element("h3", { class: "text-sm font-semibold" }, "本人確認が完了しました"),
    paragraph(
      "新しいパスキーを作成します。作成しても、このアカウントの既存のパスキーはそのまま使えます。",
    ),
    actionButton("add-passkey-create", "パスキーを作成", {
      primary: true,
      autofocus: true,
    }),
    actionButton("add-passkey-back", "キャンセル"),
  ];
}

function removePasskeyBody() {
  const credential = state.pendingRemoval;
  if (!credential) return [paragraph("削除するパスキーを選んでください。")];
  return [
    element(
      "h3",
      { class: "text-sm font-semibold" },
      "パスキーを削除しますか？",
    ),
    paragraph(
      `作成日 ${formatTimestamp(credential.created_at)} のパスキーを削除します。`,
    ),
    element(
      "div",
      {
        class: "space-y-2 rounded-md border border-danger/30 bg-danger/5 p-3",
      },
      element(
        "p",
        { class: "text-sm font-medium text-danger-text" },
        "このパスキーを削除すると、このアカウントのすべてのサインイン中のセッションが終了します。",
      ),
      paragraph(
        "残っているパスキーでサインインし直す必要があります。この端末のローカルプランは削除されません。",
        "text-xs text-muted",
      ),
      paragraph(
        "最後のパスキーは削除できません。すべてのパスキーを失うと、このアカウントにはサインインできません。パスワード、メール、復旧コード、サポートによる復旧はありません。",
        "text-xs text-muted",
      ),
    ),
    actionButton("remove-passkey-confirm", "このパスキーを削除", {
      danger: true,
      autofocus: true,
    }),
    actionButton("remove-passkey-back", "キャンセル"),
  ];
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
  if (!state.stale && !state.historyMismatch) body.push(credentialSection());
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
  if (state.mode === "add-passkey") return addPasskeyBody();
  if (state.mode === "add-passkey-ready") return addPasskeyReadyBody();
  if (state.mode === "remove-passkey") return removePasskeyBody();
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
    (state.sessionState === "active" || state.mode === "register") &&
    (state.mode === "main" || state.mode === "register")
  ) {
    body.push(disclosure());
  }
  dialog.body.replaceChildren(...body);
  const message = state.message;
  dialog.status.textContent = message ?? "";
  dialog.status.className =
    state.messageKind === "alert"
      ? "mt-3 min-h-5 text-sm text-danger-text"
      : "mt-3 min-h-5 text-sm text-muted";
  const cooldown = Date.now() < state.retryNotBefore;
  for (const button of dialog.body.querySelectorAll("button")) {
    const action = button.getAttribute("data-action");
    button.disabled =
      button.dataset.disabled === "true" ||
      state.busy ||
      (cooldown && AUTH_COOLDOWN_ACTIONS.has(action));
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

function waitForDisconnect(node, timeout = 500) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeout;
    const check = () => {
      if (!node.isConnected || Date.now() >= deadline) resolve();
      else setTimeout(check, 10);
    };
    check();
  });
}

async function openDialog() {
  if (!SESSION_MODE || !root || state.open || opening) return;
  opening = true;
  try {
    const other = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (other) {
      other.querySelector("[data-dialog-close]")?.click();
      await waitForDisconnect(other);
      if (other.isConnected) return;
    }
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
    if (state.sessionState === "active") void loadCredentials();
    const focusTarget =
      panel.querySelector("[data-autofocus]") ??
      panel.querySelector("button:not([disabled])");
    focusTarget?.focus({ preventScroll: true });
  } finally {
    opening = false;
  }
}

function closeDialog() {
  if (!dialog) return;
  abortCeremony("dialog");
  dialog.backdrop.remove();
  dialog = null;
  state.open = false;
  state.mode = "main";
  state.pendingRemoval = null;
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

async function startCeremony() {
  const expected = await currentScope();
  const ceremony = new AbortController();
  state.ceremony = ceremony;
  state.ceremonyReason = null;
  return { expected, ceremony };
}

async function checkCeremonyScope(expected) {
  const current = await authState.read();
  if (!sameScope(current, expected))
    throw Object.assign(new Error("stale_account"), { code: "stale_account" });
}

async function adoptActiveSession(session, expected) {
  await pauseSync();
  const written = await authState.write({
    accountHandle: session.account.handle,
    sessionState: "active",
    expected,
  });
  state.auth = written;
  state.decisionScope = scopeOf(written);
  state.displayName = session.account.display_name;
  state.session = session;
  state.sessionState = "active";
  state.credentials = null;
  state.credentialsError = null;
  state.pendingRemoval = null;
  state.mode = "main";
  try {
    await statusClient.read();
  } catch {
    // The coordinator verifies the session again before sync.
  }
}

async function afterSignIn(session, expected) {
  await adoptActiveSession(session, expected);
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

async function recoverCeremony(expected, ceremony) {
  try {
    if (ceremony.signal.aborted) return false;
    const status = await statusClient.read();
    if (status.kind !== SESSION_STATUS_KINDS.ACTIVE || ceremony.signal.aborted)
      return false;
    await afterSignIn(status.session, expected);
    return true;
  } catch (error) {
    if (error?.code === "stale_account") throw error;
    return false;
  }
}

function statusFailure(status) {
  if (status.kind === SESSION_STATUS_KINDS.RATE_LIMITED) {
    setRetryCooldown(status.retry_after);
    return new AuthClientError("rate_limited", {
      retryAfter: status.retry_after,
    });
  }
  if (
    status.kind === SESSION_STATUS_KINDS.SIGNED_OUT ||
    status.kind === SESSION_STATUS_KINDS.REAUTH_REQUIRED
  )
    return new AuthClientError("unauthorized");
  return new AuthClientError("temporarily_unavailable");
}

async function activeStatus(expected) {
  await checkCeremonyScope(expected);
  const status = await statusClient.read();
  await checkCeremonyScope(expected);
  if (status.kind !== SESSION_STATUS_KINDS.ACTIVE) throw statusFailure(status);
  if (status.session.account.handle !== expected.accountHandle)
    throw Object.assign(new Error("account_changed"), {
      code: "account_changed",
    });
  const csrfToken = statusClient.csrfTokenFor(status);
  if (csrfToken === null) throw new AuthClientError("csrf_forbidden");
  state.session = { ...status.session };
  state.displayName = status.session.account.display_name;
  return { ...status.session, csrf_token: csrfToken };
}

async function freshCsrf(expected) {
  const session = await activeStatus(expected);
  return { csrfToken: session.csrf_token };
}

async function ensureRecentAuth(expected, signal) {
  const session = await activeStatus(expected);
  if (session.recent_auth === true) return;
  const result = await authClient.stepUp({
    csrfToken: statusClient.csrfToken,
    signal,
    beforeVerify: () => freshCsrf(expected),
  });
  state.session = {
    ...(state.session ?? session),
    recent_auth: true,
    recent_auth_expires_at: result.recent_auth_expires_at,
  };
}

function renderCredentialState() {
  renderAccountButton();
  renderNotice();
  renderDialog();
}

async function markReauthRequired(expected, message) {
  abortCeremony("auth_change");
  state.busy = false;
  state.session = null;
  state.sessionState = "reauth_required";
  state.mode = "main";
  state.pendingRemoval = null;
  state.credentials = null;
  state.credentialsError = null;
  statusClient?.clear();
  if (authState && expected) {
    try {
      const written = await authState.setSessionState(
        "reauth_required",
        expected,
      );
      state.auth = written;
      state.decisionScope = scopeOf(written);
    } catch (error) {
      if (error?.code === "stale_account") {
        state.stale = true;
        state.sessionState =
          state.auth?.sessionState === "signed_out"
            ? "signed_out"
            : "reauth_required";
      }
    }
  }
  void pauseSync();
  state.message = message;
  state.messageKind = "status";
  renderCredentialState();
}

function markStale(message = errorMessage({ code: "stale_account" })) {
  abortCeremony("auth_change");
  state.busy = false;
  state.stale = true;
  state.mode = "main";
  state.pendingRemoval = null;
  state.credentials = null;
  state.credentialsError = null;
  statusClient?.clear();
  void pauseSync();
  state.message = message;
  state.messageKind = "alert";
  renderCredentialState();
}

async function handleCredentialFailure(
  error,
  expected,
  { retryMode = "main" } = {},
) {
  if (error?.code === "rate_limited") setRetryCooldown(error.retryAfter);
  const code = error?.code;
  if (code === "stale_account" || code === "account_changed") {
    markStale(errorMessage(error));
    return;
  }
  if (code === "unauthorized" || code === "expired") {
    await markReauthRequired(
      expected,
      "セッションの有効期限が切れました。残っているパスキーでサインインし直してください。ローカルのプランは残っています。",
    );
    return;
  }
  if (code === "not_found") {
    state.busy = false;
    state.pendingRemoval = null;
    state.mode = "main";
    await loadCredentials({ expected });
    state.message = "このパスキーは見つかりませんでした。一覧を更新しました。";
    state.messageKind = "alert";
    renderDialog();
    return;
  }
  if (code === "credential_limit" || code === "last_credential") {
    state.busy = false;
    state.pendingRemoval = null;
    state.mode = "main";
    await loadCredentials({ expected });
    state.message = errorMessage(error);
    state.messageKind = "alert";
    renderDialog();
    return;
  }
  if (code === "credential_conflict") {
    state.busy = false;
    state.mode = "main";
    state.message = errorMessage(error);
    state.messageKind = "alert";
    renderDialog();
    return;
  }
  state.busy = false;
  if (code === "recent_auth_required") {
    state.mode = retryMode === "add-passkey-ready" ? "add-passkey" : retryMode;
    state.message = errorMessage(error);
    state.messageKind = "alert";
    renderDialog();
    return;
  }
  state.mode = retryMode;
  state.message = errorMessage(error);
  state.messageKind = "alert";
  renderDialog();
}

async function loadCredentials({ expected } = {}) {
  if (
    !authClient ||
    !authState ||
    logoutPending ||
    state.sessionState !== "active"
  )
    return;
  if (credentialsPromise) return credentialsPromise;
  const scope = expected ?? state.decisionScope ?? scopeOf(state.auth);
  if (!scope?.accountHandle) return;
  state.credentialsLoading = true;
  state.credentialsError = null;
  renderDialog();
  credentialsPromise = (async () => {
    try {
      await activeStatus(scope);
      const credentials = await authClient.listCredentials();
      await activeStatus(scope);
      await checkCeremonyScope(scope);
      state.credentials = sortedCredentials(credentials);
      state.credentialsError = null;
    } catch (error) {
      if (
        error?.code === "stale_account" ||
        error?.code === "account_changed"
      ) {
        markStale(errorMessage(error));
      } else if (error?.code === "unauthorized") {
        await markReauthRequired(
          scope,
          "セッションの有効期限が切れました。残っているパスキーでサインインし直してください。ローカルのプランは残っています。",
        );
      } else {
        if (error?.code === "rate_limited") setRetryCooldown(error.retryAfter);
        state.credentialsError = errorMessage(error);
      }
    } finally {
      state.credentialsLoading = false;
      credentialsPromise = null;
      renderDialog();
    }
  })();
  return credentialsPromise;
}

function beginAddPasskey() {
  if (state.busy || state.sessionState !== "active") return;
  if ((state.credentials?.length ?? 0) >= 20) {
    setMessage(errorMessage({ code: "credential_limit" }), "alert");
    return;
  }
  state.mode = "add-passkey";
  state.message = null;
  state.messageKind = "status";
  renderDialog();
}

async function confirmAddPasskey() {
  if (state.busy || !authClient || !authState) return;
  let expected;
  try {
    expected = state.decisionScope ?? (await currentScope());
  } catch (error) {
    markStale(errorMessage(error));
    return;
  }
  if (!expected?.accountHandle) {
    setMessage("サインイン状態を確認できませんでした。", "alert");
    return;
  }
  state.busy = true;
  state.message = null;
  state.messageKind = "status";
  const ceremony = new AbortController();
  state.ceremony = ceremony;
  state.ceremonyReason = null;
  renderDialog();
  try {
    await ensureRecentAuth(expected, ceremony.signal);
    if (ceremony.signal.aborted || state.ceremony !== ceremony)
      throw new AuthClientError("canceled");
    finishCeremony(ceremony);
    state.busy = false;
    state.mode = "add-passkey-ready";
    state.message =
      "本人確認が完了しました。新しいパスキーを作成してください。";
    state.messageKind = "status";
    renderDialog();
  } catch (error) {
    const reason = state.ceremonyReason;
    const aborted = ceremony.signal.aborted;
    finishCeremony(ceremony);
    if (aborted) {
      state.busy = false;
      if (reason === "dialog") {
        state.mode = "main";
        state.pendingRemoval = null;
        state.message = null;
        return;
      }
      if (reason === "auth_change") {
        markStale(errorMessage({ code: "stale_account" }));
      } else {
        state.mode = "add-passkey";
        setMessage(errorMessage({ code: "canceled" }), "alert");
      }
      return;
    }
    await handleCredentialFailure(error, expected, {
      retryMode: "add-passkey",
    });
  }
}

async function createPasskey() {
  if (state.busy || !authClient || !authState) return;
  let expected;
  try {
    expected = state.decisionScope ?? (await currentScope());
  } catch (error) {
    markStale(errorMessage(error));
    return;
  }
  if (!expected?.accountHandle) {
    setMessage("サインイン状態を確認できませんでした。", "alert");
    return;
  }
  state.busy = true;
  state.message = null;
  state.messageKind = "status";
  const ceremony = new AbortController();
  state.ceremony = ceremony;
  state.ceremonyReason = null;
  renderDialog();
  try {
    const added = await authClient.addCredential({
      csrfToken: statusClient.csrfToken ?? undefined,
      signal: ceremony.signal,
      beforeVerify: () => freshCsrf(expected),
    });
    if (ceremony.signal.aborted || state.ceremony !== ceremony)
      throw new AuthClientError("canceled");
    finishCeremony(ceremony);
    state.busy = false;
    state.mode = "main";
    const current = state.credentials ?? [];
    state.credentials = sortedCredentials([
      ...current.filter((credential) => credential.id !== added.id),
      added,
    ]);
    state.credentialsError = null;
    state.message = "パスキーを追加しました。";
    state.messageKind = "status";
    renderCredentialState();
    void loadCredentials({ expected });
  } catch (error) {
    const reason = state.ceremonyReason;
    const aborted = ceremony.signal.aborted;
    finishCeremony(ceremony);
    if (aborted) {
      state.busy = false;
      if (reason === "dialog") {
        state.mode = "main";
        state.pendingRemoval = null;
        state.message = null;
        return;
      }
      if (reason === "auth_change") {
        markStale(errorMessage({ code: "stale_account" }));
      } else {
        state.mode = "add-passkey-ready";
        setMessage(errorMessage({ code: "canceled" }), "alert");
      }
      return;
    }
    if (error?.code === "offline" || error?.code === "timeout") {
      await loadCredentials({ expected });
      state.busy = false;
      state.mode = "main";
      state.message =
        "追加できたか一覧を確認してください。通信が不安定な場合は、新しい画面で状態を確認してください。";
      state.messageKind = "alert";
      renderCredentialState();
      return;
    }
    await handleCredentialFailure(error, expected, {
      retryMode: "add-passkey-ready",
    });
  }
}

function beginRemovePasskey(index) {
  if (state.busy) return;
  const credential = state.credentials?.[index];
  if (!credential) {
    setMessage(
      "削除するパスキーを確認できません。一覧を再読み込みしてください。",
      "alert",
    );
    return;
  }
  if ((state.credentials?.length ?? 0) <= 1) {
    setMessage(errorMessage({ code: "last_credential" }), "alert");
    return;
  }
  state.pendingRemoval = credential;
  state.mode = "remove-passkey";
  state.message = null;
  state.messageKind = "status";
  renderDialog();
}

async function confirmRemovePasskey() {
  if (state.busy || !authClient || !authState) return;
  const removed = state.pendingRemoval;
  if (!removed) return;
  let expected;
  try {
    expected = state.decisionScope ?? (await currentScope());
  } catch (error) {
    markStale(errorMessage(error));
    return;
  }
  if (!expected?.accountHandle) {
    setMessage("サインイン状態を確認できませんでした。", "alert");
    return;
  }
  state.busy = true;
  state.message = null;
  state.messageKind = "status";
  const ceremony = new AbortController();
  state.ceremony = ceremony;
  state.ceremonyReason = null;
  renderDialog();
  try {
    await ensureRecentAuth(expected, ceremony.signal);
    if (ceremony.signal.aborted || state.ceremony !== ceremony)
      throw new AuthClientError("canceled");
    await authClient.removeCredential({
      credentialId: removed.id,
      csrfToken: statusClient.csrfToken ?? undefined,
      signal: ceremony.signal,
      beforeVerify: () => freshCsrf(expected),
    });
    finishCeremony(ceremony);
    await markReauthRequired(
      expected,
      "パスキーを削除し、このアカウントのすべてのセッションを終了しました。残りのパスキーでサインインし直してください。ローカルのプランは残っています。",
    );
  } catch (error) {
    const reason = state.ceremonyReason;
    const aborted = ceremony.signal.aborted;
    finishCeremony(ceremony);
    if (aborted) {
      state.busy = false;
      if (reason === "dialog") {
        state.mode = "main";
        state.pendingRemoval = null;
        state.message = null;
        return;
      }
      if (reason === "auth_change") {
        markStale(errorMessage({ code: "stale_account" }));
      } else {
        state.mode = "remove-passkey";
        setMessage(errorMessage({ code: "canceled" }), "alert");
      }
      return;
    }
    if (error?.code === "offline" || error?.code === "timeout") {
      try {
        const status = await statusClient.read();
        if (status.kind !== SESSION_STATUS_KINDS.ACTIVE) {
          await markReauthRequired(
            expected,
            "削除が完了した可能性があります。残りのパスキーでサインインし直してください。ローカルのプランは残っています。",
          );
          return;
        }
      } catch {
        // Fall through to the explicit retry message.
      }
    }
    await handleCredentialFailure(error, expected, {
      retryMode: "remove-passkey",
    });
  }
}

function finishCeremony(ceremony) {
  if (state.ceremony === ceremony) state.ceremony = null;
}

async function register() {
  if (state.busy || !authClient) return;
  if (state.auth?.accountHandle) {
    setMessage("すでにサインインしています。", "alert");
    return;
  }
  const input = dialog?.body.querySelector("#auth-display-name");
  const displayName = input?.value.trim() ?? "";
  let started;
  try {
    started = await startCeremony();
  } catch (error) {
    setMessage(errorMessage(error), "alert");
    return;
  }
  const { expected, ceremony } = started;
  state.busy = true;
  state.message = null;
  renderDialog();
  try {
    const session = await authClient.register({
      displayName: displayName.length > 0 ? displayName : undefined,
      signal: ceremony.signal,
      beforeVerify: () => checkCeremonyScope(expected),
    });
    if (ceremony.signal.aborted || state.ceremony !== ceremony)
      throw new AuthClientError("canceled");
    finishCeremony(ceremony);
    await afterSignIn(session, expected);
  } catch (error) {
    if (error?.code === "rate_limited") setRetryCooldown(error.retryAfter);
    const reason = state.ceremonyReason;
    const aborted = ceremony.signal.aborted;
    finishCeremony(ceremony);
    state.busy = false;
    if (aborted) {
      if (reason === "auth_change") {
        state.stale = true;
        setMessage(errorMessage({ code: "stale_account" }), "alert");
      } else {
        setMessage(errorMessage({ code: "canceled" }), "alert");
      }
      return;
    }
    if (error?.code === "offline" || error?.code === "timeout") {
      try {
        if (await recoverCeremony(expected, ceremony)) return;
      } catch (recovered) {
        if (recovered?.code === "stale_account") {
          state.stale = true;
          void pauseSync();
          setMessage(errorMessage(recovered), "alert");
          return;
        }
      }
    }
    if (error?.code === "stale_account") {
      state.stale = true;
      void pauseSync();
    }
    setMessage(errorMessage(error), "alert");
  }
}

async function signIn() {
  if (state.busy || !authClient) return;
  let started;
  try {
    started = await startCeremony();
  } catch (error) {
    setMessage(errorMessage(error), "alert");
    return;
  }
  const { expected, ceremony } = started;
  state.busy = true;
  state.message = null;
  renderDialog();
  try {
    const session = await authClient.signIn({
      signal: ceremony.signal,
      beforeVerify: () => checkCeremonyScope(expected),
    });
    if (ceremony.signal.aborted || state.ceremony !== ceremony)
      throw new AuthClientError("canceled");
    finishCeremony(ceremony);
    await afterSignIn(session, expected);
  } catch (error) {
    if (error?.code === "rate_limited") setRetryCooldown(error.retryAfter);
    const reason = state.ceremonyReason;
    const aborted = ceremony.signal.aborted;
    finishCeremony(ceremony);
    state.busy = false;
    if (aborted) {
      if (reason === "auth_change") {
        state.stale = true;
        setMessage(errorMessage({ code: "stale_account" }), "alert");
      } else {
        setMessage(errorMessage({ code: "canceled" }), "alert");
      }
      return;
    }
    if (error?.code === "offline" || error?.code === "timeout") {
      try {
        if (await recoverCeremony(expected, ceremony)) return;
      } catch (recovered) {
        if (recovered?.code === "stale_account") {
          state.stale = true;
          void pauseSync();
          setMessage(errorMessage(recovered), "alert");
          return;
        }
      }
    }
    if (error?.code === "stale_account") {
      state.stale = true;
      void pauseSync();
      setMessage(errorMessage(error), "alert");
      return;
    }
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
  let expected;
  try {
    expected = state.decisionScope ?? scopeOf(state.auth);
    await checkCeremonyScope(expected);
  } catch (error) {
    state.stale = error?.code === "stale_account";
    renderNotice();
    setMessage(errorMessage(error), "alert");
    return;
  }
  logoutPending = true;
  state.busy = true;
  state.message = null;
  renderDialog();
  abortCeremony("auth_change");
  await pauseSync();
  try {
    // Finish account reads before invalidating the cookie they use.
    await credentialsPromise;
    await checkCeremonyScope(expected);
    const verified = await statusClient.read();
    await checkCeremonyScope(expected);
    if (
      verified.kind === SESSION_STATUS_KINDS.ACTIVE &&
      verified.session.account.handle !== expected.accountHandle
    )
      throw Object.assign(new Error("account_changed"), {
        code: "account_changed",
      });
    if (
      verified.kind !== SESSION_STATUS_KINDS.ACTIVE &&
      verified.kind !== SESSION_STATUS_KINDS.SIGNED_OUT &&
      verified.kind !== SESSION_STATUS_KINDS.REAUTH_REQUIRED
    )
      throw new AuthClientError("temporarily_unavailable");
    const csrf =
      verified.kind === SESSION_STATUS_KINDS.ACTIVE
        ? (statusClient.csrfTokenFor(verified) ?? undefined)
        : undefined;
    try {
      await authClient.logout({ csrfToken: csrf });
    } catch (error) {
      if (error?.code === "csrf_forbidden") {
        const refreshed = await statusClient.read();
        await checkCeremonyScope(expected);
        if (refreshed.kind === SESSION_STATUS_KINDS.ACTIVE) {
          if (refreshed.session.account.handle !== expected.accountHandle)
            throw Object.assign(new Error("account_changed"), {
              code: "account_changed",
            });
          await authClient.logout({
            csrfToken: statusClient.csrfTokenFor(refreshed) ?? undefined,
          });
        } else if (
          refreshed.kind !== SESSION_STATUS_KINDS.SIGNED_OUT &&
          refreshed.kind !== SESSION_STATUS_KINDS.REAUTH_REQUIRED
        )
          throw error;
      } else if (error?.code !== "unauthorized" && error?.code !== "expired") {
        throw error;
      }
    }
    const written = await authState.write({
      accountHandle: null,
      sessionState: "signed_out",
      expected,
    });
    state.auth = written;
    statusClient.clear();
    state.busy = false;
    state.session = null;
    state.displayName = null;
    state.pendingCopy = false;
    state.pendingUpload = false;
    state.credentials = null;
    state.credentialsError = null;
    state.pendingRemoval = null;
    state.mode = "main";
    closeDialog();
    globalThis.location.reload();
  } catch (error) {
    state.busy = false;
    if (error?.code === "stale_account" || error?.code === "account_changed") {
      state.stale = true;
      statusClient.clear();
      try {
        state.auth = await authState.read();
      } catch {
        // The recovery surface uses the last readable state.
      }
      renderAccountButton();
      renderNotice();
    }
    setMessage(errorMessage(error), "alert");
  } finally {
    logoutPending = false;
  }
}

async function copyPlan() {
  if (state.busy || !authState) return;
  const expected = state.decisionScope;
  if (!expected?.accountHandle) return;
  state.busy = true;
  state.message = null;
  renderDialog();
  try {
    await authState.copyUnboundToAccount(expected.accountHandle, expected);
    state.busy = false;
    closeDialog();
    globalThis.location.reload();
  } catch (error) {
    state.busy = false;
    if (error?.code === "stale_account") {
      state.stale = true;
      void pauseSync();
      renderAccountButton();
      renderNotice();
    }
    setMessage(errorMessage(error), "alert");
  }
}

async function declineCopy() {
  if (state.busy || !authState) return;
  const expected = state.decisionScope;
  if (!expected?.accountHandle) return;
  state.busy = true;
  try {
    await authState.setCopyDeclined(expected.accountHandle, true, expected);
    closeDialog();
    globalThis.location.reload();
  } catch (error) {
    state.busy = false;
    if (error?.code === "stale_account") {
      state.stale = true;
      void pauseSync();
      renderAccountButton();
      renderNotice();
    }
    setMessage(errorMessage(error), "alert");
  }
}

async function consentUpload() {
  if (state.busy || !authState) return;
  const expected = state.decisionScope;
  if (!expected?.accountHandle) return;
  state.busy = true;
  try {
    await authState.setPendingUpload(expected.accountHandle, false, expected);
    state.pendingUpload = false;
    state.busy = false;
    closeDialog();
    renderAccountButton();
    renderNotice();
    await globalThis.tanikunSyncShell?.refresh?.();
  } catch (error) {
    state.busy = false;
    if (error?.code === "stale_account") {
      state.stale = true;
      void pauseSync();
      renderAccountButton();
      renderNotice();
    }
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

async function onAction(action, button) {
  if (AUTH_COOLDOWN_ACTIONS.has(action) && Date.now() < state.retryNotBefore)
    return;
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
    case "reload-credentials":
      await loadCredentials();
      break;
    case "add-passkey":
      beginAddPasskey();
      break;
    case "add-passkey-confirm":
      await confirmAddPasskey();
      break;
    case "add-passkey-create":
      await createPasskey();
      break;
    case "add-passkey-back":
    case "remove-passkey-back":
      state.mode = "main";
      state.pendingRemoval = null;
      state.message = null;
      state.messageKind = "status";
      renderDialog();
      break;
    case "remove-passkey":
      beginRemovePasskey(Number(button?.dataset.credentialIndex));
      break;
    case "remove-passkey-confirm":
      await confirmRemovePasskey();
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
    void onAction(button.getAttribute("data-action"), button);
  });
}

async function refresh() {
  if (!SESSION_MODE || !authState || !statusClient) return null;
  if (Date.now() < state.retryNotBefore) return state.auth;
  if (refreshPromise) return refreshPromise;
  const expectedEpoch = lifecycleEpoch;
  let expected;
  refreshPromise = (async () => {
    state.sessionState = "loading";
    state.message = null;
    state.messageKind = "status";
    renderAccountButton();
    try {
      await globalThis.tanikunAuthReady;
      state.auth = await authState.read();
      expected = scopeOf(state.auth);
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
    if (lifecycleEpoch !== expectedEpoch) return state.auth;
    state.kind = status.kind;
    state.reason = status.reason;
    const current = await authState.read();
    state.auth = current;
    if (!sameScope(current, expected))
      throw Object.assign(new Error("stale_account"), {
        code: "stale_account",
      });

    if (
      status.kind === SESSION_STATUS_KINDS.ACTIVE &&
      current.sessionState === "reauth_required"
    ) {
      // A status GET cannot substitute for an explicit new sign-in ceremony.
      abortCeremony("auth_change");
      state.session = null;
      state.sessionState = "reauth_required";
      state.credentials = null;
      state.credentialsError = null;
      state.pendingRemoval = null;
      state.mode = "main";
    } else if (status.kind === SESSION_STATUS_KINDS.ACTIVE) {
      const session = status.session;
      if (
        current.accountHandle !== null &&
        current.accountHandle !== session.account.handle
      ) {
        state.stale = true;
        statusClient.clear();
        state.sessionState =
          current.sessionState === "reauth_required"
            ? "reauth_required"
            : "active";
        state.message =
          "別のアカウントのセッションに変わりました。サインインし直してください。";
        state.messageKind = "alert";
        state.displayName = null;
        state.credentials = null;
        state.credentialsError = null;
        state.pendingRemoval = null;
        state.mode = "main";
      } else {
        const pendingUpload = await authState.isPendingUpload(
          session.account.handle,
        );
        const pendingCopy =
          !pendingUpload && (await copyNeeded(session.account.handle));
        let adopted = current;
        if (
          current.sessionState !== "active" ||
          current.accountHandle !== session.account.handle
        ) {
          await pauseSync();
          adopted = await authState.write({
            accountHandle: session.account.handle,
            sessionState: "active",
            expected,
          });
        } else {
          // Even an already-active refresh must queue behind pending expiry.
          adopted = await authState.setSessionState("active", expected);
        }
        if (lifecycleEpoch !== expectedEpoch) return state.auth;
        state.auth = adopted;
        state.decisionScope = scopeOf(adopted);
        state.session = session;
        state.displayName = session.account.display_name;
        state.sessionState = "active";
        state.pendingUpload = pendingUpload;
        state.pendingCopy = pendingCopy;
        if (state.open) void loadCredentials({ expected: scopeOf(adopted) });
      }
    } else if (
      status.kind === SESSION_STATUS_KINDS.SIGNED_OUT ||
      status.kind === SESSION_STATUS_KINDS.REAUTH_REQUIRED
    ) {
      if (current.sessionState === "active") {
        await pauseSync();
        state.auth = await authState.setSessionState(
          "reauth_required",
          expected,
        );
      }
      state.session = null;
      state.sessionState =
        state.auth.sessionState === "signed_out"
          ? "signed_out"
          : "reauth_required";
      state.credentials = null;
      state.credentialsError = null;
      state.pendingRemoval = null;
      state.mode = "main";
    } else if (status.kind === SESSION_STATUS_KINDS.MALFORMED) {
      state.session = null;
      state.sessionState = "error";
      state.credentials = null;
      state.credentialsError = null;
      state.pendingRemoval = null;
      state.mode = "main";
      state.message = descriptionForStatus(status);
      state.messageKind = "alert";
    } else {
      state.session = null;
      state.sessionState =
        state.auth.sessionState === "reauth_required"
          ? "reauth_required"
          : "offline";
      state.credentials = null;
      state.credentialsError = null;
      state.pendingRemoval = null;
      state.mode = "main";
      state.message = descriptionForStatus(status);
      state.messageKind = "status";
    }
    if (status.kind === SESSION_STATUS_KINDS.RATE_LIMITED)
      setRetryCooldown(status.retry_after);
    else setRetryCooldown(0);
    state.busy = false;
    renderAccountButton();
    renderNotice();
    openSettingsSection();
    renderDialog();
    return state.auth;
  })()
    .catch(async (error) => {
      if (error?.code === "stale_account") {
        let current;
        try {
          current = await authState.read();
          state.auth = current;
        } catch {
          // An unreadable scope still requires explicit stale recovery.
        }
        if (
          expected &&
          current &&
          current.generation === expected.generation &&
          current.accountHandle === expected.accountHandle &&
          current.sessionState === "reauth_required"
        ) {
          // Expiry preserves the account and generation; offer reauthentication.
          state.stale = false;
          state.session = null;
          state.sessionState = "reauth_required";
          state.message = null;
          state.messageKind = "status";
          statusClient.clear();
        } else {
          state.stale = true;
          state.session = null;
          state.sessionState = current?.sessionState ?? "offline";
          statusClient.clear();
          state.message = errorMessage(error);
          state.messageKind = "alert";
        }
        renderAccountButton();
        renderNotice();
      } else {
        state.sessionState = "offline";
        state.message = errorMessage(error);
        state.messageKind = "alert";
        renderAccountButton();
        renderNotice();
      }
      state.busy = false;
      renderDialog();
      return state.auth;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

function handleSyncStatus(status = {}) {
  if (
    [
      "reauth_required",
      "unauthorized",
      "stale_account",
      "account_changed",
    ].includes(status.code)
  )
    lifecycleEpoch += 1;
  if (status.code === "reauth_required" || status.code === "unauthorized") {
    abortCeremony("auth_change");
    state.sessionState = "reauth_required";
    state.credentials = null;
    state.credentialsError = null;
    state.pendingRemoval = null;
    state.mode = "main";
    const expected = scopeOf(state.auth);
    if (expected && state.auth?.sessionState === "active") {
      void authState
        .setSessionState("reauth_required", expected)
        .then((next) => {
          state.auth = next;
          state.sessionState = next.sessionState;
          renderAccountButton();
          renderNotice();
          renderDialog();
        })
        .catch((error) => {
          if (error?.code === "stale_account") {
            state.stale = true;
            renderAccountButton();
            renderNotice();
          }
        });
    }
    renderAccountButton();
  } else if (status.code === "stale_account") {
    abortCeremony("auth_change");
    state.stale = true;
    state.credentials = null;
    state.credentialsError = null;
    state.pendingRemoval = null;
    state.mode = "main";
    renderAccountButton();
    renderNotice();
  } else if (status.code === "history_mismatch") {
    state.historyMismatch = true;
    renderAccountButton();
    renderNotice();
  } else if (status.code === "account_changed") {
    state.stale = true;
    statusClient.clear();
    renderAccountButton();
    renderNotice();
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
      abortCeremony("auth_change");
      state.auth = next;
      state.stale = true;
      state.sessionState =
        next.sessionState === "signed_out" ? "signed_out" : next.sessionState;
      state.credentials = null;
      state.credentialsError = null;
      state.pendingRemoval = null;
      state.mode = "main";
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
      void openDialog();
      return;
    }
    if (target.closest("#open-account-settings")) {
      event.preventDefault();
      void openDialog();
    }
  });
  globalThis.tanikunStorage?.onStaleAccount?.(() => {
    state.stale = true;
    state.sessionState =
      state.auth?.sessionState === "active"
        ? "active"
        : state.auth?.sessionState === "reauth_required"
          ? "reauth_required"
          : "signed_out";
    void pauseSync();
    renderAccountButton();
    renderNotice();
    renderDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.open) {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key === "Tab" && state.open && dialog) {
      const focusable = [
        ...dialog.panel.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((node) => node.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      const active = document.activeElement;
      if (
        event.shiftKey &&
        (active === first || !dialog.panel.contains(active))
      ) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (
        !event.shiftKey &&
        (active === last || !dialog.panel.contains(active))
      ) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
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
