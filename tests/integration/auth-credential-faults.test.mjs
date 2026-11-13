// Static-page fault regressions for passkey management. These use Playwright
// route mocks and a stubbed native credential object; they do not prove the
// real Worker, D1, or verifier path. The real journey is
// session-credential-journey.test.mjs.

import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { startStaticServer, waitForPersistence } from "./planner-harness.mjs";

const core = process.env.PLAYWRIGHT_CORE;
assert.ok(core, "run inside nix develop");
const { chromium } = await import(pathToFileURL(join(core, "index.mjs")).href);
const dist = resolve(process.env.TANIKUN_WEB_DIST ?? "apps/web/dist");
const HANDLE = Buffer.alloc(32, 4).toString("base64url");
const OTHER_HANDLE = Buffer.alloc(32, 5).toString("base64url");
const CSRF = "C".repeat(43);
const NOW = Date.now();
const json = (status, body, headers = {}) => ({
  status,
  contentType: "application/json",
  headers,
  body: JSON.stringify(body),
});
const active = () => ({
  session: {
    account: { handle: HANDLE, display_name: "Alice" },
    expires_at: NOW + 43_200_000,
    idle_expires_at: NOW + 1_800_000,
    recent_auth: false,
    recent_auth_expires_at: NOW - 1,
    csrf_token: CSRF,
  },
});
const credential = {
  id: Buffer.alloc(16, 1).toString("base64url"),
  created_at: NOW - 60_000,
  last_used_at: NOW - 60_000,
  backup_eligible: false,
  backup_state: false,
};
const stepUpOptions = {
  challenge_id: Buffer.alloc(16, 7).toString("base64url"),
  publicKey: {
    challenge: Buffer.alloc(32, 2).toString("base64url"),
    timeout: 120_000,
    rpId: "localhost",
    allowCredentials: [{ type: "public-key", id: credential.id }],
    userVerification: "required",
  },
};

async function openPage(t, { beforeGoto } = {}) {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((finish) => server.close(finish)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    globalThis["__TANIKUN_SYNC_CONFIG__"] = { mode: "session", maxRetry: 0 };
  });
  if (beforeGoto) await beforeGoto(page, origin);
  await page.goto(origin);
  await waitForPersistence(page);
  await page.locator("#account-button-mobile").waitFor({ state: "visible" });
  return { page, errors, origin };
}

async function installRoutes(
  page,
  origin,
  { stepUpStatus = 200, onSession } = {},
) {
  const counts = { stepUpOptions: 0, stepUpVerify: 0, nativeGet: 0 };
  await page.route(`${origin}/api/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/auth/session") {
      const status = await onSession?.();
      await route.fulfill(json(200, status ?? active()));
      return;
    }
    if (
      url.pathname === "/api/v1/auth/credentials" &&
      request.method() === "GET"
    ) {
      await route.fulfill(json(200, { credentials: [credential] }));
      return;
    }
    if (url.pathname === "/api/v1/auth/step-up/options") {
      counts.stepUpOptions += 1;
      if (stepUpStatus === 429) {
        await route.fulfill(
          json(
            429,
            { error: { code: "rate_limited" } },
            {
              "Retry-After": "2",
            },
          ),
        );
      } else {
        await route.fulfill(json(200, stepUpOptions));
      }
      return;
    }
    if (url.pathname === "/api/v1/auth/step-up/verify") {
      counts.stepUpVerify += 1;
      await route.fulfill(
        json(200, {
          recent_auth: true,
          recent_auth_expires_at: NOW + 300_000,
        }),
      );
      return;
    }
    if (
      url.pathname === "/api/v1/sync/document" &&
      request.method() === "POST"
    ) {
      await route.fulfill(
        json(200, {
          document_id: "00000000-0000-4000-8000-000000000001",
          cursor: 0,
        }),
      );
      return;
    }
    if (url.pathname.endsWith("/changes")) {
      await route.fulfill(
        json(200, {
          document_id: "00000000-0000-4000-8000-000000000001",
          changes: [],
          accepted: [],
          next_cursor: 0,
          has_more: false,
          cursor: 0,
        }),
      );
      return;
    }
    await route.fulfill(json(404, { error: { code: "not_found" } }));
  });
  return counts;
}

async function openAddConfirmation(page) {
  await page.locator("#account-button-mobile").click();
  await page.locator("#auth-dialog").waitFor({ state: "visible" });
  await page.locator('[data-action="add-passkey"]').waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await page.locator('[data-action="add-passkey"]').click();
  await page.locator('[data-action="add-passkey-confirm"]').waitFor({
    state: "visible",
  });
}

test("closing the dialog cancels a pending step-up before verification", async (t) => {
  let counts;
  const { page, errors } = await openPage(t, {
    async beforeGoto(targetPage, targetOrigin) {
      await targetPage.addInitScript(() => {
        Object.defineProperty(navigator, "credentials", {
          configurable: true,
          value: {
            get({ signal }) {
              return new Promise((_, reject) => {
                const abort = () => {
                  const error = new Error("aborted");
                  error.name = "AbortError";
                  reject(error);
                };
                if (signal.aborted) abort();
                else signal.addEventListener("abort", abort, { once: true });
              });
            },
          },
        });
      });
      counts = await installRoutes(targetPage, targetOrigin);
    },
  });
  await openAddConfirmation(page);
  await page.locator('[data-action="add-passkey-confirm"]').click();
  await page.waitForFunction(
    () => globalThis.tanikunAuthController?.state?.busy === true,
  );
  await page.locator("#auth-close").click();
  await page.locator("#auth-dialog").waitFor({ state: "detached" });
  await page.waitForTimeout(150);
  assert.equal(counts.stepUpOptions, 1);
  assert.equal(counts.stepUpVerify, 0);
  assert.equal(errors.length, 0, errors.join("; "));
});

test("a rate-limited step-up keeps the add action in cooldown", async (t) => {
  let counts;
  const { page, errors } = await openPage(t, {
    async beforeGoto(targetPage, targetOrigin) {
      counts = await installRoutes(targetPage, targetOrigin, {
        stepUpStatus: 429,
      });
    },
  });
  await openAddConfirmation(page);
  await page.locator('[data-action="add-passkey-confirm"]').click();
  await page.waitForFunction(() =>
    document
      .querySelector("#auth-dialog-status")
      ?.textContent?.includes("しばらく待って"),
  );
  const confirm = page.locator('[data-action="add-passkey-confirm"]');
  assert.equal(await confirm.isDisabled(), true);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-action="add-passkey-confirm"]')
        ?.disabled === false,
    undefined,
    { timeout: 5_000 },
  );
  assert.equal(counts.stepUpOptions, 1);
  assert.equal(counts.stepUpVerify, 0);
  assert.deepEqual(
    errors.filter(
      (message) =>
        !/Failed to load resource: the server responded with a status of 429/u.test(
          message,
        ),
    ),
    [],
  );
});

test("a stale tab fences the add confirmation before any step-up request", async (t) => {
  let counts;
  const { page, errors } = await openPage(t, {
    async beforeGoto(targetPage, targetOrigin) {
      counts = await installRoutes(targetPage, targetOrigin);
    },
  });
  await openAddConfirmation(page);
  await page.evaluate(async (accountHandle) => {
    const other = globalThis.tanikunAuthStateModule.createAuthStateStore({
      indexedDB: globalThis.indexedDB,
      locks: null,
    });
    await other.write({ accountHandle, sessionState: "active" });
    other.close();
  }, OTHER_HANDLE);
  await page.waitForFunction(() =>
    document
      .querySelector("#auth-dialog")
      ?.textContent?.includes("アカウントが切り替わりました"),
  );
  assert.equal(counts.stepUpOptions, 0);
  assert.equal(counts.stepUpVerify, 0);
  assert.equal(errors.length, 0, errors.join("; "));
});

test("a delayed CSRF status cannot verify step-up after a silent account switch", async (t) => {
  let counts;
  let heldResolve;
  const held = new Promise((resolveHeld) => {
    heldResolve = resolveHeld;
  });
  let releaseStatus;
  const released = new Promise((release) => {
    releaseStatus = release;
  });
  let didHold = false;
  const { page, errors } = await openPage(t, {
    async beforeGoto(targetPage, origin) {
      await targetPage.route(`${origin}/sync-shell.js`, (route) =>
        route.fulfill({ contentType: "text/javascript", body: "export {};" }),
      );
      await targetPage.addInitScript(() => {
        Object.defineProperty(navigator, "credentials", {
          configurable: true,
          value: {
            async get() {
              const rawId = new Uint8Array(16).fill(1);
              return {
                id: btoa(String.fromCharCode(...rawId))
                  .replaceAll("=", "")
                  .replaceAll("+", "-")
                  .replaceAll("/", "_"),
                rawId: rawId.buffer,
                type: "public-key",
                response: {
                  clientDataJSON: new Uint8Array([1]).buffer,
                  authenticatorData: new Uint8Array(37).buffer,
                  signature: new Uint8Array([1]).buffer,
                },
              };
            },
          },
        });
      });
      counts = await installRoutes(targetPage, origin, {
        onSession: async () => {
          if (counts?.stepUpOptions === 1 && !didHold) {
            didHold = true;
            heldResolve();
            await released;
          }
        },
      });
    },
  });
  await openAddConfirmation(page);
  await page.locator('[data-action="add-passkey-confirm"]').click();
  await held;
  await page.evaluate(async (accountHandle) => {
    const other = globalThis.tanikunAuthStateModule.createAuthStateStore({
      indexedDB: globalThis.indexedDB,
      locks: null,
      channelFactory: null,
    });
    await other.write({ accountHandle, sessionState: "active" });
    other.close();
  }, OTHER_HANDLE);
  releaseStatus();
  await page.waitForFunction(
    () => globalThis.tanikunAuthController.state.busy === false,
  );
  assert.equal(counts.stepUpVerify, 0);
  assert.equal(
    (await page.evaluate(() => globalThis.tanikunAuthState.read()))
      .accountHandle,
    OTHER_HANDLE,
  );
  assert.equal(
    await page.evaluate(() => globalThis.tanikunAuthController.state.stale),
    true,
  );
  assert.deepEqual(errors, []);
});

test("credential lists are not adopted after a server-only account switch", async (t) => {
  let switchOnList = false;
  let serverChanged = false;
  const { page, errors } = await openPage(t, {
    async beforeGoto(targetPage, origin) {
      await targetPage.route(`${origin}/sync-shell.js`, (route) =>
        route.fulfill({ contentType: "text/javascript", body: "export {};" }),
      );
      await installRoutes(targetPage, origin, {
        onSession: async () => {
          const status = active();
          if (serverChanged) status.session.account.handle = OTHER_HANDLE;
          return status;
        },
      });
      await targetPage.route(
        `${origin}/api/v1/auth/credentials`,
        async (route) => {
          if (switchOnList) serverChanged = true;
          await route.fulfill(
            json(200, {
              credentials: [
                {
                  ...credential,
                  id: serverChanged
                    ? Buffer.alloc(16, 2).toString("base64url")
                    : credential.id,
                },
              ],
            }),
          );
        },
      );
    },
  });
  await page.locator("#account-button-mobile").click();
  await page.waitForFunction(
    () =>
      globalThis.tanikunAuthController.state.credentials !== null &&
      !globalThis.tanikunAuthController.state.credentialsLoading,
  );
  await page.locator("#auth-close").click();
  switchOnList = true;
  await page.locator("#account-button-mobile").click();
  await page.waitForFunction(
    () => !globalThis.tanikunAuthController.state.credentialsLoading,
  );
  assert.equal(
    await page.evaluate(() => globalThis.tanikunAuthController.state.stale),
    true,
  );
  assert.equal(
    await page.evaluate(
      () => globalThis.tanikunAuthController.state.credentials,
    ),
    null,
  );
  assert.equal(
    (await page.evaluate(() => globalThis.tanikunAuthState.read()))
      .accountHandle,
    HANDLE,
  );
  assert.deepEqual(errors, []);
});
