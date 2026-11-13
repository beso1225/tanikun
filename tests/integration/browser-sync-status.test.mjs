import assert from "node:assert/strict";
import { join, resolve as resolvePath } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { startStaticServer, waitForPersistence } from "./planner-harness.mjs";

const dist = resolvePath(process.env.TANIKUN_WEB_DIST ?? "apps/web/dist");
const core = process.env.PLAYWRIGHT_CORE;
assert.ok(core, "run this test in `nix develop` so PLAYWRIGHT_CORE is set");
const { chromium } = await import(pathToFileURL(join(core, "index.mjs")).href);

const documentId = "00000000-0000-4000-8000-000000000001";
const token = "local-browser-test-token";

const syncJson = (status, body) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

const SESSION_OPTIONS = () => ({
  challenge_id: "AQEBAQEBAQEBAQEBAQEBAQ",
  publicKey: {
    rp: { id: "localhost", name: "Tanikun" },
    user: {
      id: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
      name: "Pending",
      displayName: "Pending",
    },
    challenge: "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    timeout: 120_000,
    excludeCredentials: [],
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
    attestation: "none",
  },
});

async function writeOtherAuthState(page, accountHandle) {
  await page.evaluate(async (handle) => {
    const other = globalThis.tanikunAuthStateModule.createAuthStateStore({
      indexedDB: globalThis.indexedDB,
      locks: null,
    });
    await other.write({
      accountHandle: handle,
      sessionState: "active",
    });
    other.close();
  }, accountHandle);
}

async function openPage(
  t,
  viewport = { width: 1280, height: 900 },
  {
    configure = true,
    beforeGoto,
    waitForReady = true,
    mode = "dev_bearer",
    expectedAccountHandle,
  } = {},
) {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((finish) => server.close(finish)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let api = null;
  if (configure) {
    if (mode === "session") {
      await page.addInitScript(
        ({ expected }) => {
          globalThis["__TANIKUN_SYNC_CONFIG__"] = {
            mode: "session",
            ...(expected === undefined
              ? {}
              : { expectedAccountHandle: expected }),
            maxRetry: 0,
          };
        },
        { expected: expectedAccountHandle },
      );
      api = await installFakeSessionApi(page, origin);
    } else {
      await page.addInitScript(
        ({ apiOrigin, authToken }) => {
          globalThis["__TANIKUN_SYNC_CONFIG__"] = {
            mode: "dev_bearer",
            apiOrigin,
            token: authToken,
            maxRetry: 0,
          };
        },
        { apiOrigin: origin, authToken: token },
      );
      api = await installFakeApi(page, origin);
    }
  }
  if (beforeGoto) await beforeGoto(page, origin);
  await page.goto(origin);
  if (waitForReady) await waitForPersistence(page);
  return { page, api, errors };
}

async function installFakeApi(page, origin) {
  const changes = [];
  const pushBodies = [];
  const bootstrapCalls = [];
  const pullCalls = [];
  let mode = "online";
  let failedPush = false;
  const recordPush = (envelopes) => {
    pushBodies.push(envelopes);
    return envelopes.map((envelope) => {
      let sequence = changes.find(
        (change) => change.change_id === envelope.change_id,
      )?.server_sequence;
      if (sequence === undefined) {
        sequence = changes.length + 1;
        changes.push({ ...envelope, server_sequence: sequence });
      }
      return { change_id: envelope.change_id, server_sequence: sequence };
    });
  };

  await page.route(`${origin}/api/v1/sync/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if ((await request.headerValue("authorization")) !== `Bearer ${token}`) {
      await route.fulfill(syncJson(401, { error: { code: "unauthorized" } }));
      return;
    }
    if (mode === "offline") {
      await route.abort("failed");
      return;
    }
    if (mode === "unauthorized") {
      await route.fulfill(syncJson(401, { error: { code: "unauthorized" } }));
      return;
    }
    if (
      url.pathname === "/api/v1/sync/document" &&
      request.method() === "GET"
    ) {
      bootstrapCalls.push(Date.now());
      await route.fulfill(
        syncJson(200, { document_id: documentId, cursor: changes.length }),
      );
      return;
    }
    if (
      url.pathname === `/api/v1/sync/documents/${documentId}/changes` &&
      request.method() === "POST"
    ) {
      const body = JSON.parse(request.postData() ?? "{}");
      const envelopes = Array.isArray(body.changes) ? body.changes : [];
      if (mode === "rate-limited") {
        await route.fulfill({
          ...syncJson(429, { error: { code: "rate_limited" } }),
          headers: { "Retry-After": "1" },
        });
        return;
      }
      const accepted = recordPush(envelopes);
      if (mode === "fail-push" && !failedPush) {
        failedPush = true;
        await route.fulfill(
          syncJson(503, { error: { code: "temporarily_unavailable" } }),
        );
        return;
      }
      await route.fulfill(
        syncJson(200, {
          document_id: documentId,
          accepted,
          cursor: changes.length,
        }),
      );
      return;
    }
    if (
      url.pathname === `/api/v1/sync/documents/${documentId}/changes` &&
      request.method() === "GET"
    ) {
      const after = Number(url.searchParams.get("after") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "100");
      pullCalls.push({ after, limit });
      const rows = changes
        .filter((change) => change.server_sequence > after)
        .slice(0, limit);
      const cursor = changes.length;
      const nextCursor = rows.length ? rows.at(-1).server_sequence : after;
      await route.fulfill(
        syncJson(200, {
          document_id: documentId,
          changes: rows,
          next_cursor: nextCursor,
          has_more: nextCursor < cursor,
          cursor,
        }),
      );
      return;
    }
    await route.fulfill(syncJson(404, { error: { code: "not_found" } }));
  });

  return {
    bootstrapCalls,
    pushBodies,
    pullCalls,
    get changes() {
      return changes.slice();
    },
    get mode() {
      return mode;
    },
    set mode(value) {
      mode = value;
    },
  };
}

async function installFakeSessionApi(page, origin) {
  const handle = "S".repeat(43);
  const csrf = "C".repeat(43);
  const changes = [];
  const bootstrapCalls = [];
  const pushBodies = [];
  const pushCsrf = [];
  const pullCalls = [];
  let unauthorized = false;
  let authCalls = 0;
  let authorizationSeen = null;
  let bootstrapBody = null;
  let bootstrapUrl = null;

  const recordPush = (envelopes) =>
    envelopes.map((envelope) => {
      let sequence = changes.find(
        (change) => change.change_id === envelope.change_id,
      )?.server_sequence;
      if (sequence === undefined) {
        sequence = changes.length + 1;
        changes.push({ ...envelope, server_sequence: sequence });
      }
      return { change_id: envelope.change_id, server_sequence: sequence };
    });

  await page.route(`${origin}/api/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = request.headers();
    if (headers.authorization !== undefined)
      authorizationSeen = headers.authorization;
    if (url.pathname === "/api/v1/auth/session") {
      authCalls += 1;
      if (unauthorized) {
        await route.fulfill(syncJson(401, { error: { code: "unauthorized" } }));
        return;
      }
      await route.fulfill(
        syncJson(200, {
          session: {
            account: { handle, display_name: "Session Browser" },
            expires_at: Date.now() + 43_200_000,
            idle_expires_at: Date.now() + 1_800_000,
            recent_auth: true,
            recent_auth_expires_at: Date.now() + 300_000,
            csrf_token: csrf,
          },
        }),
      );
      return;
    }
    if (unauthorized) {
      await route.fulfill(syncJson(401, { error: { code: "unauthorized" } }));
      return;
    }
    if (
      url.pathname === "/api/v1/sync/document" &&
      request.method() === "POST"
    ) {
      bootstrapCalls.push({
        csrf: headers["x-csrf-token"] ?? null,
        method: request.method(),
        body: request.postData(),
        url: request.url(),
      });
      bootstrapUrl = request.url();
      bootstrapBody = request.postData();
      if (headers["x-csrf-token"] !== csrf) {
        await route.fulfill(
          syncJson(403, { error: { code: "csrf_forbidden" } }),
        );
        return;
      }
      await route.fulfill(
        syncJson(200, { document_id: documentId, cursor: changes.length }),
      );
      return;
    }
    if (
      url.pathname === `/api/v1/sync/documents/${documentId}/changes` &&
      request.method() === "POST"
    ) {
      pushCsrf.push(headers["x-csrf-token"] ?? null);
      const body = JSON.parse(request.postData() ?? "{}");
      const envelopes = Array.isArray(body.changes) ? body.changes : [];
      pushBodies.push(envelopes);
      if (headers["x-csrf-token"] !== csrf) {
        await route.fulfill(
          syncJson(403, { error: { code: "csrf_forbidden" } }),
        );
        return;
      }
      const accepted = recordPush(envelopes);
      await route.fulfill(
        syncJson(200, {
          document_id: documentId,
          accepted,
          cursor: changes.length,
        }),
      );
      return;
    }
    if (
      url.pathname === `/api/v1/sync/documents/${documentId}/changes` &&
      request.method() === "GET"
    ) {
      const after = Number(url.searchParams.get("after") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "100");
      pullCalls.push({ after, limit });
      const rows = changes
        .filter((change) => change.server_sequence > after)
        .slice(0, limit);
      const cursor = changes.length;
      const nextCursor = rows.length ? rows.at(-1).server_sequence : after;
      await route.fulfill(
        syncJson(200, {
          document_id: documentId,
          changes: rows,
          next_cursor: nextCursor,
          has_more: nextCursor < cursor,
          cursor,
        }),
      );
      return;
    }
    await route.fulfill(syncJson(404, { error: { code: "not_found" } }));
  });

  return {
    handle,
    csrf,
    bootstrapCalls,
    pushBodies,
    pushCsrf,
    pullCalls,
    get authCalls() {
      return authCalls;
    },
    get authorizationSeen() {
      return authorizationSeen;
    },
    get bootstrapBody() {
      return bootstrapBody;
    },
    get bootstrapUrl() {
      return bootstrapUrl;
    },
    get changes() {
      return changes.slice();
    },
    get unauthorized() {
      return unauthorized;
    },
    set unauthorized(value) {
      unauthorized = value;
    },
  };
}

async function waitForSync(page, text) {
  await page.waitForFunction(
    (expected) =>
      document.querySelector("#sync-status-text")?.textContent === expected,
    text,
    { timeout: 15_000 },
  );
}

async function addOffering(page) {
  await page.locator("#open-catalogue-picker").click();
  await page.locator("#add-offering-phy302-s").click();
  await page.locator("#close-picker").click();
  await waitForPersistence(page);
}

test(
  "offline edit shows offline and retry converges",
  { timeout: 60_000 },
  async (t) => {
    const { page, api, errors } = await openPage(t);
    await waitForSync(page, "同期済み");
    assert.equal(
      await page.locator("#persistence-status").innerText(),
      "保存済み",
    );
    assert.equal(await page.locator("#sync-retry").isVisible(), false);

    api.mode = "offline";
    await addOffering(page);
    await waitForSync(page, "オフライン");
    assert.equal(await page.locator("#sync-retry").isVisible(), true);

    api.mode = "online";
    await page.locator("#sync-retry").click();
    await waitForSync(page, "同期済み");
    const states = await page.evaluate(() =>
      globalThis.tanikunSyncShell.history.map((entry) => entry.state),
    );
    assert.ok(states.includes("starting"));
    assert.ok(states.includes("syncing"));
    assert.ok(api.pushBodies.length >= 2);
    assert.equal(
      api.changes.length,
      new Set(api.changes.map((change) => change.change_id)).size,
    );
    assert.deepEqual(errors, []);
  },
);

test(
  "lost push response retries without duplicate server changes",
  { timeout: 60_000 },
  async (t) => {
    const { page, api, errors } = await openPage(t);
    await waitForSync(page, "同期済み");
    api.mode = "fail-push";
    await addOffering(page);
    await waitForSync(page, "同期エラー");
    assert.equal(await page.locator("#sync-retry").isVisible(), true);

    api.mode = "online";
    await page.locator("#sync-retry").click();
    await waitForSync(page, "同期済み");
    const posted = api.pushBodies.flat().map((change) => change.change_id);
    assert.ok(posted.length > new Set(posted).size);
    assert.equal(
      api.changes.length,
      new Set(api.changes.map((change) => change.change_id)).size,
    );
    assert.deepEqual(errors, []);
  },
);

test("sync status remains usable at 390px", { timeout: 60_000 }, async (t) => {
  const { page, api, errors } = await openPage(t, {
    width: 390,
    height: 844,
  });
  await waitForSync(page, "同期済み");
  assert.equal(await page.locator("#persistence-status").isVisible(), true);
  assert.equal(await page.locator("#sync-status").isVisible(), true);
  assert.equal(
    await page.locator("#sync-status").getAttribute("role"),
    "status",
  );
  assert.equal(
    await page.locator("#sync-status").getAttribute("aria-live"),
    "polite",
  );
  assert.equal(
    await page.locator("#sync-status").getAttribute("aria-atomic"),
    "true",
  );
  assert.match(
    await page.locator("#sync-status").innerText(),
    /同期状態:\s*同期済み/,
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );

  api.mode = "offline";
  await addOffering(page);
  await waitForSync(page, "オフライン");
  assert.equal(await page.locator("#sync-retry").isVisible(), true);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  api.mode = "online";
  await page.locator("#sync-retry").focus();
  await page.keyboard.press("Enter");
  await waitForSync(page, "同期済み");
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "sync-status",
  );
  await page.keyboard.press("Tab");
  assert.notEqual(
    await page.evaluate(() => document.activeElement?.id),
    "sync-status",
  );
  assert.notEqual(
    await page.evaluate(() => document.activeElement?.id),
    "sync-retry",
  );
  assert.deepEqual(errors, []);
});

test(
  "unconfigured sync is visible without a retry control",
  { timeout: 60_000 },
  async (t) => {
    const { page, api, errors } = await openPage(t, undefined, {
      configure: false,
    });
    await waitForSync(page, "同期未設定");
    assert.equal(api, null);
    assert.equal(await page.locator("#sync-retry").isVisible(), false);
    assert.equal(
      await page.locator("#sync-status").getAttribute("role"),
      "status",
    );
    assert.deepEqual(errors, []);
  },
);

test(
  "unauthorized sync errors do not offer an unsafe retry",
  { timeout: 60_000 },
  async (t) => {
    const { page, api, errors } = await openPage(t);
    await waitForSync(page, "同期済み");
    api.mode = "unauthorized";
    await addOffering(page);
    await waitForSync(page, "同期エラー");
    assert.equal(await page.locator("#sync-retry").isVisible(), false);
    assert.deepEqual(errors, []);
  },
);

test(
  "sync starts after local persistence recovers",
  { timeout: 60_000 },
  async (t) => {
    const { page, api, errors } = await openPage(t, undefined, {
      waitForReady: false,
      beforeGoto: (target) =>
        target.addInitScript(() => {
          const put = IDBObjectStore.prototype.put;
          let failed = false;
          IDBObjectStore.prototype.put = function (...args) {
            if (!failed && this.name === "documents" && args[1] === "planner") {
              failed = true;
              throw new Error("quota exceeded");
            }
            return put.apply(this, args);
          };
        }),
    });
    await waitForPersistence(page, "保存失敗");
    await waitForSync(page, "同期エラー");
    assert.equal(await page.locator("#sync-retry").isVisible(), false);

    await addOffering(page);
    await waitForSync(page, "同期済み");
    assert.ok(api.bootstrapCalls.length > 0);
    assert.deepEqual(errors, []);
  },
);

test(
  "session sync adopts the account planner without a dev fallback",
  { timeout: 60_000 },
  async (t) => {
    const { page, api, errors } = await openPage(t, undefined, {
      mode: "session",
    });
    await waitForSync(page, "同期済み");
    assert.ok(api.authCalls >= 1);
    assert.equal(api.authorizationSeen, null);
    assert.equal(api.bootstrapCalls.length, 1);
    assert.equal(api.bootstrapCalls[0].method, "POST");
    assert.equal(api.bootstrapCalls[0].csrf, api.csrf);
    assert.equal(api.bootstrapCalls[0].body, null);
    assert.equal(api.bootstrapCalls[0].url.includes("?"), false);
    assert.equal(api.pushBodies.length >= 1, true);
    assert.equal(
      api.pushBodies.flat().every((entry) => entry.document_id === documentId),
      true,
    );
    const scope = await page.evaluate(() => globalThis.tanikunStorage.scope());
    assert.equal(scope.plannerKey, `account:${api.handle}:planner`);
    const keys = await page.evaluate(async () => {
      const open = indexedDB.open("tanikun-planner", 1);
      const database = await new Promise((resolvePromise, reject) => {
        open.onsuccess = () => resolvePromise(open.result);
        open.onerror = () => reject(open.error);
      });
      const transaction = database.transaction("documents", "readonly");
      const request = transaction.objectStore("documents").getAllKeys();
      return new Promise((resolvePromise, reject) => {
        request.onsuccess = () => resolvePromise(request.result);
        request.onerror = () => reject(request.error);
      });
    });
    assert.equal(keys.includes(`account:${api.handle}:planner`), true);
    assert.equal(keys.includes("planner"), false);
    await addOffering(page);
    await waitForPersistence(page);
    await page.reload();
    await waitForPersistence(page);
    await waitForSync(page, "同期済み");
    assert.equal(
      await page.evaluate(() => globalThis.tanikunStorage.scope().plannerKey),
      `account:${api.handle}:planner`,
    );
    const session = await page.evaluate(
      () => globalThis.tanikunSyncShell.session,
    );
    assert.equal(session.account.handle, api.handle);
    assert.equal(JSON.stringify(session).includes(api.csrf), false);
    assert.deepEqual(errors, []);
  },
);

test(
  "session account mismatch stops before bootstrap",
  { timeout: 60_000 },
  async (t) => {
    const { page, api, errors } = await openPage(t, undefined, {
      mode: "session",
      expectedAccountHandle: "X".repeat(43),
    });
    await waitForSync(page, "アカウントを確認してください");
    assert.equal(api.bootstrapCalls.length, 0);
    assert.equal(await page.locator("#sync-retry").isVisible(), false);
    assert.deepEqual(errors, []);
  },
);

test(
  "session status network and 503 failures offer a retry that recovers",
  { timeout: 60_000 },
  async (t) => {
    for (const failure of ["network", "503"]) {
      let attempts = 0;
      const { page, api, errors } = await openPage(t, undefined, {
        mode: "session",
        beforeGoto: async (targetPage, origin) => {
          await targetPage.route(
            `${origin}/api/v1/auth/session`,
            async (route) => {
              attempts += 1;
              if (attempts > 1) return route.fallback();
              if (failure === "network") return route.abort("connectionreset");
              return route.fulfill(
                syncJson(503, { error: { code: "temporarily_unavailable" } }),
              );
            },
          );
        },
      });
      await waitForSync(
        page,
        failure === "network" ? "オフライン" : "同期エラー",
      );
      assert.equal(await page.locator("#sync-retry").isVisible(), true);
      await addOffering(page);
      await page.locator("#sync-retry").click();
      await waitForSync(page, "アカウントが切り替わりました");
      assert.equal(attempts >= 2, true);
      assert.equal(api.bootstrapCalls.length, 0);
      assert.equal(api.pushBodies.length, 0);
      const unboundBeforeReload = await page.evaluate(async () => {
        const opening = indexedDB.open("tanikun-planner", 1);
        const database = await new Promise((resolve, reject) => {
          opening.onsuccess = () => resolve(opening.result);
          opening.onerror = () => reject(opening.error);
        });
        const transaction = database.transaction("documents", "readonly");
        const record = await new Promise((resolve, reject) => {
          const request = transaction.objectStore("documents").get("planner");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return globalThis.tanikunDocument.text(
          globalThis.Automerge.load(record.bytes),
        );
      });
      assert.match(unboundBeforeReload, /phy302-s/u);
      await page.reload();
      await waitForPersistence(page);
      await waitForSync(page, "同期済み");
      assert.equal(api.bootstrapCalls.length, 1);
      assert.equal(api.pushBodies.length >= 1, true);
      const unboundAfterReload = await page.evaluate(async () => {
        const opening = indexedDB.open("tanikun-planner", 1);
        const database = await new Promise((resolve, reject) => {
          opening.onsuccess = () => resolve(opening.result);
          opening.onerror = () => reject(opening.error);
        });
        const transaction = database.transaction("documents", "readonly");
        const record = await new Promise((resolve, reject) => {
          const request = transaction.objectStore("documents").get("planner");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return globalThis.tanikunDocument.text(
          globalThis.Automerge.load(record.bytes),
        );
      });
      assert.match(unboundAfterReload, /phy302-s/u);
      assert.deepEqual(errors, []);
    }
  },
);

test(
  "session status 429 disables retry until Retry-After and then recovers",
  { timeout: 60_000 },
  async (t) => {
    let attempts = 0;
    const { page, api, errors } = await openPage(t, undefined, {
      mode: "session",
      beforeGoto: async (targetPage, origin) => {
        await targetPage.route(
          `${origin}/api/v1/auth/session`,
          async (route) => {
            attempts += 1;
            if (attempts > 1) return route.fallback();
            return route.fulfill({
              ...syncJson(429, { error: { code: "rate_limited" } }),
              headers: { "Retry-After": "1" },
            });
          },
        );
      },
    });
    await waitForSync(page, "同期エラー");
    assert.equal(await page.locator("#sync-retry").isVisible(), true);
    assert.equal(await page.locator("#sync-retry").isDisabled(), true);
    await page.evaluate(() => globalThis.tanikunSyncShell.sync());
    assert.equal(attempts, 1);
    await addOffering(page);
    await page.locator("#sync-retry").click();
    await waitForSync(page, "アカウントが切り替わりました");
    assert.equal(attempts >= 2, true);
    assert.equal(api.bootstrapCalls.length, 0);
    await page.reload();
    await waitForPersistence(page);
    await waitForSync(page, "同期済み");
    assert.equal(api.bootstrapCalls.length, 1);
    assert.equal(api.pushBodies.length >= 1, true);
    assert.deepEqual(errors, []);
  },
);

test(
  "sync quota exhaustion disables immediate retry and then converges",
  { timeout: 60_000 },
  async (t) => {
    const { page, api, errors } = await openPage(t);
    await waitForSync(page, "同期済み");
    api.mode = "rate-limited";
    await addOffering(page);
    await waitForSync(page, "同期エラー");
    assert.equal(await page.locator("#sync-retry").isVisible(), true);
    assert.equal(await page.locator("#sync-retry").isDisabled(), true);
    const pulls = api.pullCalls.length;
    await page.evaluate(() => globalThis.tanikunSyncShell.sync());
    assert.equal(api.pullCalls.length, pulls);
    api.mode = "online";
    await page.locator("#sync-retry").click();
    await waitForSync(page, "同期済み");
    assert.deepEqual(errors, []);
  },
);

test(
  "malformed and signed-out session status never offer retry",
  { timeout: 60_000 },
  async (t) => {
    for (const body of [{ session: null }, { session: { account: {} } }]) {
      const { page, api, errors } = await openPage(t, undefined, {
        mode: "session",
        beforeGoto: async (targetPage, origin) => {
          await targetPage.route(`${origin}/api/v1/auth/session`, (route) =>
            route.fulfill(syncJson(200, body)),
          );
        },
      });
      await waitForSync(
        page,
        body.session === null ? "サインインしてください" : "同期エラー",
      );
      assert.equal(await page.locator("#sync-retry").isVisible(), false);
      assert.equal(api.bootstrapCalls.length, 0);
      assert.deepEqual(errors, []);
    }
  },
);

test(
  "a session status rate limit after account bootstrap retains retry cooldown",
  { timeout: 60_000 },
  async (t) => {
    let attempts = 0;
    const { page, errors } = await openPage(t, undefined, {
      mode: "session",
      beforeGoto: async (targetPage, origin) => {
        await targetPage.route(
          `${origin}/api/v1/auth/session`,
          async (route) => {
            attempts += 1;
            if (attempts !== 2) return route.fallback();
            return route.fulfill({
              ...syncJson(429, { error: { code: "rate_limited" } }),
              headers: { "Retry-After": "1" },
            });
          },
        );
      },
    });
    await waitForSync(page, "同期エラー");
    const status = await page.evaluate(
      () => globalThis.tanikunSyncShell.status,
    );
    assert.equal(status.state, "error");
    assert.equal(status.code, "rate_limited");
    assert.equal(await page.locator("#sync-retry").isVisible(), true);
    assert.equal(await page.locator("#sync-retry").isDisabled(), true);
    await page.evaluate(() => globalThis.tanikunSyncShell.sync());
    assert.equal(attempts, 2);
    await page.locator("#sync-retry").click();
    await waitForSync(page, "同期済み");
    assert.deepEqual(errors, []);
  },
);
test(
  "a delayed session status cannot adopt or expire a newer local lifecycle",
  { timeout: 60_000 },
  async (t) => {
    const bobHandle = "B".repeat(43);
    for (const response of [
      {
        label: "200-active",
        body: {
          session: {
            account: { handle: "S".repeat(43), display_name: "Old Alice" },
            expires_at: Date.now() + 43_200_000,
            idle_expires_at: Date.now() + 1_800_000,
            recent_auth: true,
            recent_auth_expires_at: Date.now() + 300_000,
            csrf_token: "C".repeat(43),
          },
        },
        status: 200,
      },
      {
        label: "401-expired",
        body: { error: { code: "unauthorized" } },
        status: 401,
      },
    ]) {
      let hitResolve;
      const hit = new Promise((resolve) => {
        hitResolve = resolve;
      });
      let releaseResolve;
      const release = new Promise((resolve) => {
        releaseResolve = resolve;
      });
      let calls = 0;
      const { page, errors } = await openPage(t, undefined, {
        mode: "session",
        // This case intentionally holds the initial status read. Planner load
        // now waits for it, so exercise the account switch before persistence.
        waitForReady: false,
        beforeGoto: async (targetPage, origin) => {
          await targetPage.route(
            `${origin}/api/v1/auth/session`,
            async (route) => {
              calls += 1;
              if (calls !== 1) return route.fallback();
              hitResolve();
              await release;
              return route.fulfill(syncJson(response.status, response.body));
            },
          );
        },
      });
      await hit;
      await page.evaluate(() => globalThis.tanikunAuthReady);
      await writeOtherAuthState(page, bobHandle);
      await page.waitForFunction(
        async (handle) =>
          (await globalThis.tanikunAuthState.read()).accountHandle === handle,
        bobHandle,
      );
      releaseResolve();
      await page.evaluate(() => globalThis.tanikunAuthController.ready);
      const observed = await page.evaluate(async () => ({
        auth: await globalThis.tanikunAuthState.read(),
        controller: globalThis.tanikunAuthController?.state,
      }));
      assert.equal(observed.auth.accountHandle, bobHandle);
      assert.equal(observed.auth.sessionState, "active");
      assert.equal(observed.controller.auth.accountHandle, bobHandle);
      assert.equal(observed.controller.stale, true);
      assert.equal(
        observed.controller.sessionState === "reauth_required",
        false,
      );
      assert.notEqual(observed.controller.displayName, "Old Alice");
      assert.deepEqual(errors, []);
      void response.label;
    }
  },
);

test(
  "a pending native ceremony is canceled before verify on an account switch",
  { timeout: 60_000 },
  async (t) => {
    let verifyCalls = 0;
    const { page, errors } = await openPage(t, undefined, {
      mode: "session",
      beforeGoto: async (targetPage, origin) => {
        await targetPage.route(`${origin}/api/v1/auth/session`, (route) =>
          route.fulfill(syncJson(200, { session: null })),
        );
        await targetPage.route(
          `${origin}/api/v1/auth/register/options`,
          (route) => route.fulfill(syncJson(200, SESSION_OPTIONS())),
        );
        await targetPage.route(
          `${origin}/api/v1/auth/register/verify`,
          (route) => {
            verifyCalls += 1;
            return route.fulfill(
              syncJson(200, {
                session: {
                  account: {
                    handle: "S".repeat(43),
                    display_name: "Pending",
                  },
                  expires_at: Date.now() + 43_200_000,
                  idle_expires_at: Date.now() + 1_800_000,
                  recent_auth: true,
                  recent_auth_expires_at: Date.now() + 300_000,
                  csrf_token: "C".repeat(43),
                },
              }),
            );
          },
        );
      },
    });
    await page.evaluate(() => {
      Object.defineProperty(navigator.credentials, "create", {
        configurable: true,
        value: (options) =>
          new Promise((_resolve, reject) => {
            globalThis["__nativeCeremonyPending"] = true;
            globalThis["__nativeCeremonyAborted"] = false;
            options.signal?.addEventListener(
              "abort",
              () => {
                globalThis["__nativeCeremonyAborted"] = true;
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true },
            );
          }),
      });
    });
    await page.locator("#account-button").click();
    await page.locator('[data-action="register-start"]').click();
    await page.locator("#auth-display-name").fill("Pending Alice");
    await page.locator('[data-action="register-submit"]').click();
    await page.waitForFunction(
      () => globalThis["__nativeCeremonyPending"] === true,
    );
    await writeOtherAuthState(page, "B".repeat(43));
    await page.waitForFunction(
      () => globalThis["__nativeCeremonyAborted"] === true,
    );
    await page.waitForTimeout(300);
    assert.equal(verifyCalls, 0);
    const observed = await page.evaluate(async () => ({
      auth: await globalThis.tanikunAuthState.read(),
      controller: globalThis.tanikunAuthController?.state,
    }));
    assert.equal(observed.auth.accountHandle, "B".repeat(43));
    assert.equal(observed.auth.sessionState, "active");
    assert.equal(observed.controller.auth.accountHandle, "B".repeat(43));
    assert.equal(observed.controller.stale, true);
    assert.match(
      await page.locator("#auth-dialog-status").innerText(),
      /切り替わり/u,
    );
    assert.deepEqual(errors, []);
  },
);

test(
  "opening the account dialog from settings closes settings and keeps focus",
  { timeout: 60_000 },
  async (t) => {
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const { page, errors } = await openPage(t, viewport, {
        mode: "session",
        beforeGoto: async (targetPage, origin) => {
          await targetPage.route(`${origin}/api/v1/auth/session`, (route) =>
            route.fulfill(syncJson(200, { session: null })),
          );
        },
      });
      await page.locator("#open-settings").click();
      await page.locator("#settings").waitFor({ state: "visible" });
      await page.locator("#open-account-settings").click();
      await page.locator("#auth-dialog").waitFor({ state: "visible" });
      await page.locator("#settings").waitFor({ state: "detached" });
      assert.equal(
        await page.locator('[role="dialog"][aria-modal="true"]').count(),
        1,
      );
      assert.equal(
        await page.evaluate(
          () => document.activeElement?.closest("#auth-dialog") !== null,
        ),
        true,
      );
      for (let index = 0; index < 4; index += 1) {
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(
            () => document.activeElement?.closest("#auth-dialog") !== null,
          ),
          true,
        );
      }
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await page.evaluate(
          () => document.activeElement?.closest("#auth-dialog") !== null,
        ),
        true,
      );
      await page.keyboard.press("Escape");
      await page.locator("#auth-dialog").waitFor({ state: "detached" });
      const expectedFocus =
        viewport.width < 768 ? "account-button-mobile" : "account-button";
      assert.equal(
        await page.evaluate(() => document.activeElement?.id),
        expectedFocus,
      );
      assert.deepEqual(errors, []);
    }
  },
);

test(
  "the account dialog respects a session status Retry-After before retrying",
  { timeout: 60_000 },
  async (t) => {
    const { page, errors } = await openPage(t, undefined, {
      mode: "session",
      beforeGoto: async (targetPage, origin) => {
        let calls = 0;
        await targetPage.route(
          `${origin}/api/v1/auth/session`,
          async (route) => {
            calls += 1;
            if (calls !== 1) return route.fallback();
            return route.fulfill({
              ...syncJson(429, { error: { code: "rate_limited" } }),
              headers: { "Retry-After": "1" },
            });
          },
        );
      },
    });
    await waitForSync(page, "同期エラー");
    await page.locator("#account-button").click();
    await page.locator('[data-action="retry"]').waitFor({ state: "visible" });
    assert.equal(
      await page.locator('[data-action="retry"]').isDisabled(),
      true,
    );
    assert.equal(
      await page.locator('[data-action="sign-in"]').isDisabled(),
      true,
    );
    await page.waitForTimeout(1_200);
    assert.equal(
      await page.locator('[data-action="retry"]').isDisabled(),
      false,
    );
    assert.equal(
      await page.locator('[data-action="sign-in"]').isDisabled(),
      false,
    );
    await page.locator("#auth-close").click();
    assert.deepEqual(errors, []);
  },
);
test(
  "closing the account dialog cancels a pending native ceremony before verify",
  { timeout: 60_000 },
  async (t) => {
    let verifyCalls = 0;
    const { page, errors } = await openPage(t, undefined, {
      mode: "session",
      beforeGoto: async (targetPage, origin) => {
        await targetPage.route(`${origin}/api/v1/auth/session`, (route) =>
          route.fulfill(syncJson(200, { session: null })),
        );
        await targetPage.route(
          `${origin}/api/v1/auth/register/options`,
          (route) => route.fulfill(syncJson(200, SESSION_OPTIONS())),
        );
        await targetPage.route(
          `${origin}/api/v1/auth/register/verify`,
          (route) => {
            verifyCalls += 1;
            return route.fulfill(syncJson(200, { session: null }));
          },
        );
      },
    });
    await page.evaluate(() => {
      Object.defineProperty(navigator.credentials, "create", {
        configurable: true,
        value: (options) =>
          new Promise((_resolve, reject) => {
            globalThis["__dialogCeremonyAborted"] = false;
            options.signal?.addEventListener(
              "abort",
              () => {
                globalThis["__dialogCeremonyAborted"] = true;
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true },
            );
          }),
      });
    });
    await page.locator("#account-button").click();
    await page.locator('[data-action="register-start"]').click();
    await page.locator("#auth-display-name").fill("Cancel Alice");
    await page.locator('[data-action="register-submit"]').click();
    await page.waitForFunction(
      () => typeof globalThis["__dialogCeremonyAborted"] === "boolean",
    );
    await page.locator("#auth-close").click();
    await page.waitForFunction(
      () => globalThis["__dialogCeremonyAborted"] === true,
    );
    await page.waitForTimeout(200);
    assert.equal(verifyCalls, 0);
    const auth = await page.evaluate(() => globalThis.tanikunAuthState.read());
    assert.equal(auth.sessionState, "signed_out");
    assert.equal(auth.accountHandle, null);
    assert.deepEqual(errors, []);
  },
);
