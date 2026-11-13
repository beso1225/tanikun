// Real session-mode browser journeys for #183. Each test starts the production
// Worker bridge and local D1, serves the built page at https://localhost:4300
// through a disposable loopback certificate, and drives Chromium's virtual
// authenticator. The passkey, TLS certificate, and accounts are synthetic.
// This proves the local Worker/D1/browser path, not a physical provider,
// screen reader, public deployment, or the Linux CI matrix owned by #185.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { waitForPersistence } from "./planner-harness.mjs";
import { readTraceArchiveEntries, SyncHarness } from "./sync-harness.mjs";

const AUTH_ORIGIN = "https://localhost:4300";

async function openAccount(page, selector) {
  const width = page.viewportSize()?.width ?? 1280;
  const button = selector
    ? page.locator(selector)
    : width < 768
      ? page.locator("#account-button-mobile")
      : page.locator("#account-button");
  await button.click();
  await page.locator("#auth-dialog").waitFor({ state: "visible" });
}

async function closeAccount(page) {
  if (
    !(await page
      .locator("#auth-dialog")
      .isVisible()
      .catch(() => false))
  )
    return;
  await page.locator("#auth-close").click();
  await page.locator("#auth-dialog").waitFor({ state: "detached" });
}

async function addOffering(page, offeringId = "phy302-s") {
  await page.locator("#open-catalogue-picker").click();
  await page.locator(`#add-offering-${offeringId}`).click();
  await page.locator("#close-picker").click();
  await waitForPersistence(page);
}

async function readDocuments(page) {
  return page.evaluate(async () => {
    const opening = indexedDB.open("tanikun-planner", 1);
    const database = await new Promise((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const transaction = database.transaction("documents", "readonly");
    const store = transaction.objectStore("documents");
    const keys = await new Promise((resolve, reject) => {
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const authState = await new Promise((resolve, reject) => {
      const request = store.get("auth:state");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return { keys, authState };
  });
}

async function waitSynced(page) {
  await page.waitForFunction(
    () =>
      document.querySelector("#sync-status-text")?.textContent === "同期済み",
    undefined,
    { timeout: 60_000 },
  );
}

async function waitForSyncText(page, text) {
  await page.waitForFunction(
    (expected) =>
      document.querySelector("#sync-status-text")?.textContent === expected,
    text,
    { timeout: 60_000 },
  );
}

async function waitForAuthState(page, sessionState, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await page.evaluate(async () => {
      try {
        return await globalThis.tanikunAuthState.read();
      } catch {
        return null;
      }
    });
    if (state?.sessionState === sessionState) return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`auth state did not become ${sessionState}`);
}

async function registerForCopy(page, name) {
  await openAccount(page);
  await page.locator('[data-action="register-start"]').click();
  await page.locator("#auth-display-name").fill(name);
  await page.locator('[data-action="register-submit"]').click();
  await page
    .locator('[data-action="copy-plan"]')
    .waitFor({ state: "visible", timeout: 30_000 });
}

async function clickAndReload(page, selector) {
  const navigation = page.waitForNavigation({
    waitUntil: "load",
    timeout: 60_000,
  });
  await page.locator(selector).click();
  await navigation;
  await waitForPersistence(page);
}

async function copyAndConsent(page) {
  await clickAndReload(page, '[data-action="copy-plan"]');
  await openAccount(page);
  await page
    .locator('[data-action="consent-upload"]')
    .waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('[data-action="consent-upload"]').click();
  await waitSynced(page);
}

async function registerAndSync(page, name) {
  await registerForCopy(page, name);
  await copyAndConsent(page);
}

async function signOut(page) {
  await openAccount(page);
  await clickAndReload(page, '[data-action="logout"]');
}

async function signIn(page) {
  await openAccount(page);
  await clickAndReload(page, '[data-action="sign-in"]');
}

function hasEnrollment(text, offeringId) {
  try {
    return JSON.stringify(JSON.parse(text).enrollments).includes(offeringId);
  } catch {
    return false;
  }
}

async function switchLocalAccount(page, accountHandle) {
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

async function readPlannerText(page, key) {
  return page.evaluate(async (plannerKey) => {
    const opening = indexedDB.open("tanikun-planner", 1);
    const database = await new Promise((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const transaction = database.transaction("documents", "readonly");
    const record = await new Promise((resolve, reject) => {
      const request = transaction.objectStore("documents").get(plannerKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!record) return null;
    return globalThis.tanikunDocument.text(
      globalThis.Automerge.load(record.bytes),
    );
  }, key);
}

async function waitForD1Count(harness, table, minimum, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const rows = await harness.d1Query(
      `SELECT COUNT(*) AS count FROM ${table}`,
    );
    if (Number(rows[0].count) >= minimum) return Number(rows[0].count);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`D1 table ${table} did not reach ${minimum} rows`);
}

async function readRecord(page, key) {
  return page.evaluate(async (recordKey) => {
    const opening = indexedDB.open("tanikun-planner", 1);
    const database = await new Promise((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const transaction = database.transaction("documents", "readonly");
    const record = await new Promise((resolve, reject) => {
      const request = transaction.objectStore("documents").get(recordKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!record) return null;
    return {
      storageVersion: record.storageVersion,
      bytes: Array.from(record.bytes ?? []),
    };
  }, key);
}

async function writeIndependentPlan(page, key, text) {
  await page.evaluate(
    async ({ plannerKey, sourceText }) => {
      const document = globalThis.tanikunDocument.update(null, sourceText);
      const record = {
        storageVersion: 2,
        bytes: globalThis.Automerge.save(document),
      };
      const opening = indexedDB.open("tanikun-planner", 1);
      const database = await new Promise((resolve, reject) => {
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
      });
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("documents", "readwrite");
        transaction.objectStore("documents").put(record, plannerKey);
        transaction.addEventListener("complete", resolve, { once: true });
        transaction.addEventListener("abort", () => reject(transaction.error), {
          once: true,
        });
      });
    },
    { plannerKey: key, sourceText: text },
  );
}

test(
  "registers a passkey, copies the unbound plan, consents, and converges in D1",
  { timeout: 180_000 },
  async (t) => {
    const harness = new SyncHarness({ mode: "session" });
    t.after(() => harness.close());
    await harness.start();
    const { page, context, authenticator, errors } =
      await harness.openSessionPage({
        viewport: { width: 390, height: 844 },
      });
    assert.ok(authenticator);
    await waitForPersistence(page);
    await page.locator("#account-button-mobile").waitFor({ state: "visible" });
    assert.equal(
      await page.locator("#account-button-mobile").innerText(),
      "サインイン",
    );
    await addOffering(page);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );

    await page.locator("#account-button-mobile").focus();
    await page.keyboard.press("Enter");
    await page.locator("#auth-dialog").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator("#auth-dialog").waitFor({ state: "detached" });
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "account-button-mobile",
    );
    await openAccount(page);
    await page.locator('[data-action="register-start"]').click();
    const disclosure = await page.locator('[role="dialog"]').innerText();
    assert.match(disclosure, /パスキーをすべて失うと/);
    assert.match(disclosure, /失われた暗号化鍵を復旧することもできません/);
    await page.locator("#auth-display-name").fill("Alice Fictional");
    await page.locator('[data-action="register-submit"]').click();
    await page
      .locator('[data-action="copy-plan"]')
      .waitFor({ state: "visible", timeout: 30_000 });
    const afterRegister = await readDocuments(page);
    assert.equal(afterRegister.authState.authVersion, 1);
    assert.equal(afterRegister.authState.sessionState, "active");
    assert.match(afterRegister.authState.accountHandle, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(
      JSON.stringify(afterRegister.authState).includes("csrf"),
      false,
    );
    assert.equal(
      JSON.stringify(afterRegister.authState).includes("token"),
      false,
    );
    assert.equal(afterRegister.keys.includes("planner"), true);

    await clickAndReload(page, '[data-action="copy-plan"]');
    await page.locator("#account-button-mobile").waitFor({ state: "visible" });
    await openAccount(page);
    await page
      .locator('[data-action="consent-upload"]')
      .waitFor({ state: "visible", timeout: 30_000 });
    await page.locator('[data-action="decline-upload"]').click();
    await waitForSyncText(page, "初回アップロード未許可");
    const changesBeforeConsent = await harness.d1Query(
      "SELECT COUNT(*) AS count FROM changes",
    );
    assert.equal(Number(changesBeforeConsent[0].count), 0);
    await page.reload();
    await waitForPersistence(page);
    await waitForSyncText(page, "初回アップロード未許可");
    await openAccount(page);
    await page
      .locator('[data-action="consent-upload"]')
      .waitFor({ state: "visible", timeout: 30_000 });
    await page.locator('[data-action="consent-upload"]').click();
    await waitSynced(page);

    const handle = afterRegister.authState.accountHandle;
    const documents = await readDocuments(page);
    assert.equal(documents.keys.includes(`account:${handle}:planner`), true);
    assert.equal(documents.keys.includes("planner"), true);
    assert.equal(documents.keys.includes(`auth:upload:${handle}`), false);
    const storedAuth = documents.authState;
    assert.equal(storedAuth.sessionState, "active");

    const cookies = await context.cookies();
    const sessionCookie = cookies.find(
      (cookie) => cookie.name === "__Host-tanikun_session",
    );
    assert.ok(sessionCookie);
    assert.equal(sessionCookie.httpOnly, true);
    assert.equal(sessionCookie.secure, true);
    assert.equal(sessionCookie.sameSite, "Lax");
    assert.equal(await page.evaluate(() => document.cookie), "");
    const browserStorage = await page.evaluate(() => ({
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage),
    }));
    const csrf = await page.evaluate(
      () => globalThis.tanikunAuthController.sessionClient.csrfToken,
    );
    assert.match(csrf, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(browserStorage.local.includes(csrf), false);
    assert.equal(browserStorage.session.includes(csrf), false);
    assert.equal(
      browserStorage.local.includes("__Host-tanikun_session"),
      false,
    );

    const owners = await harness.d1Query(
      "SELECT id, handle, display_name FROM users WHERE handle IS NOT NULL",
    );
    assert.equal(owners.length, 1);
    assert.equal(owners[0].handle, handle);
    assert.equal(owners[0].display_name, "Alice Fictional");
    const changes = await harness.d1Query(
      "SELECT COUNT(*) AS count FROM changes",
    );
    assert.equal(Number(changes[0].count) >= 1, true);
    const documentRows = await harness.d1Query("SELECT id FROM documents");
    assert.equal(documentRows.length, 1);

    const evidence = await harness.readEvidence();
    assert.equal(evidence.includes(csrf), false);
    assert.equal(evidence.includes("Alice Fictional"), false);

    if (
      await page
        .locator("#auth-dialog")
        .isVisible()
        .catch(() => false)
    )
      await closeAccount(page);
    await page.locator("#open-settings").click();
    await page
      .locator("#account-settings-section")
      .waitFor({ state: "visible" });
    assert.match(
      await page.locator("#account-settings-section").innerText(),
      /パスキーをすべて失うと/u,
    );
    await page.locator("#close-settings").click();
    assert.deepEqual(errors, []);
  },
);
test(
  "account switch keeps Alice and Bob histories separate and restores Alice",
  { timeout: 180_000 },
  async (t) => {
    const harness = new SyncHarness({ mode: "session" });
    t.after(() => harness.close());
    await harness.start();
    const { page, authenticator, errors } = await harness.openSessionPage();
    await waitForPersistence(page);
    const initialUnbound = await readPlannerText(page, "planner");
    await registerAndSync(page, "Alice Switch");
    await addOffering(page);
    const aliceChanges = await waitForD1Count(harness, "changes", 2);
    const aliceAuth = (await readDocuments(page)).authState;
    const aliceKey = `account:${aliceAuth.accountHandle}:planner`;
    const alicePlan = await readPlannerText(page, aliceKey);
    assert.equal(hasEnrollment(alicePlan, "phy302-s"), true);
    const aliceCredentials = await harness.exportCredentials(authenticator);

    await signOut(page);
    const signedOut = await readDocuments(page);
    assert.equal(signedOut.authState.sessionState, "signed_out");
    assert.equal(signedOut.authState.accountHandle, null);
    assert.equal(signedOut.keys.includes(aliceKey), true);
    assert.equal(signedOut.keys.includes("planner"), true);
    const unboundAfterLogout = await readPlannerText(page, "planner");
    assert.equal(unboundAfterLogout, initialUnbound);
    assert.equal(hasEnrollment(unboundAfterLogout, "phy302-s"), false);
    assert.equal(
      await page.locator("#account-button").innerText(),
      "サインイン",
    );

    await authenticator.cdp.send("WebAuthn.clearCredentials", {
      authenticatorId: authenticator.authenticatorId,
    });
    await openAccount(page);
    await page.locator('[data-action="register-start"]').click();
    await page.locator("#auth-display-name").fill("Bob Switch");
    await page.locator('[data-action="register-submit"]').click();
    await page
      .locator('[data-action="copy-plan"]')
      .waitFor({ state: "visible", timeout: 30_000 });
    await clickAndReload(page, '[data-action="decline-copy"]');
    await waitSynced(page);
    const bobChanges = await waitForD1Count(
      harness,
      "changes",
      aliceChanges + 1,
    );
    assert.equal(bobChanges > aliceChanges, true);
    const bobAuth = (await readDocuments(page)).authState;
    assert.notEqual(bobAuth.accountHandle, aliceAuth.accountHandle);
    const bobKey = `account:${bobAuth.accountHandle}:planner`;
    const bobPlan = await readPlannerText(page, bobKey);
    assert.equal(hasEnrollment(bobPlan, "phy302-s"), false);
    const afterBob = await readDocuments(page);
    assert.equal(afterBob.keys.includes(aliceKey), true);
    assert.equal(afterBob.keys.includes(bobKey), true);
    assert.equal(
      afterBob.keys.some(
        (key) =>
          typeof key === "string" &&
          key.startsWith("sync:") &&
          key.includes(aliceAuth.accountHandle),
      ),
      true,
    );
    assert.equal(
      afterBob.keys.some(
        (key) =>
          typeof key === "string" &&
          key.startsWith("sync:") &&
          key.includes(bobAuth.accountHandle),
      ),
      true,
    );

    await signOut(page);
    await authenticator.cdp.send("WebAuthn.clearCredentials", {
      authenticatorId: authenticator.authenticatorId,
    });
    await harness.importCredentials(authenticator, aliceCredentials);
    await signIn(page);
    await waitSynced(page);
    const aliceAgain = await readDocuments(page);
    assert.equal(aliceAgain.authState.accountHandle, aliceAuth.accountHandle);
    assert.equal(
      hasEnrollment(await readPlannerText(page, aliceKey), "phy302-s"),
      true,
    );
    assert.equal(await readPlannerText(page, bobKey), bobPlan);

    const owners = await harness.d1Query(
      "SELECT handle FROM users WHERE handle IS NOT NULL ORDER BY handle",
    );
    assert.equal(owners.length, 2);
    const documents = await harness.d1Query("SELECT id FROM documents");
    assert.equal(documents.length, 2);
    assert.deepEqual(errors, []);
  },
);
test(
  "a second tab fences its editor after another tab signs out",
  { timeout: 180_000 },
  async (t) => {
    const harness = new SyncHarness({ mode: "session" });
    t.after(() => harness.close());
    await harness.start();
    const { page, context, errors } = await harness.openSessionPage();
    await waitForPersistence(page);
    await registerAndSync(page, "Multi Tab Alice");
    const aliceAuth = (await readDocuments(page)).authState;
    const aliceKey = `account:${aliceAuth.accountHandle}:planner`;
    const tabB = await harness.openSessionTab(context);
    await waitForPersistence(tabB.page);
    await waitForSyncText(tabB.page, "同期済み");

    await signOut(page);
    await tabB.page
      .locator("#auth-notice")
      .waitFor({ state: "visible", timeout: 15_000 });
    assert.match(
      await tabB.page.locator("#auth-notice").innerText(),
      /アカウントが切り替わりました/u,
    );
    assert.equal(
      await tabB.page.evaluate(
        () => globalThis.tanikunAuthController?.state?.stale,
      ),
      true,
    );
    const before = await readPlannerText(tabB.page, aliceKey);
    await tabB.page.locator("#open-catalogue-picker").click();
    await tabB.page.locator("#add-offering-phy302-s").click();
    await tabB.page.locator("#close-picker").click();
    await waitForPersistence(tabB.page, "保存失敗");
    const rejected = await tabB.page.evaluate(() =>
      globalThis.tanikunStorage.lastRejectedText(),
    );
    assert.equal(hasEnrollment(rejected, "phy302-s"), true);
    assert.equal(await readPlannerText(tabB.page, aliceKey), before);
    await openAccount(tabB.page);
    const [download] = await Promise.all([
      tabB.page.waitForEvent("download", { timeout: 5_000 }),
      tabB.page.locator('[data-action="download-edited"]').click(),
    ]);
    const path = await download.path();
    const exported = await readFile(path, "utf8");
    assert.equal(hasEnrollment(exported, "phy302-s"), true);
    await closeAccount(tabB.page);
    await tabB.page.reload();
    await waitForPersistence(tabB.page);
    assert.equal(
      hasEnrollment(await readPlannerText(tabB.page, "planner"), "phy302-s"),
      false,
    );
    assert.equal(await readPlannerText(tabB.page, aliceKey), before);
    assert.deepEqual(errors, []);
    assert.deepEqual(tabB.errors, []);
  },
);

test(
  "a 401 keeps the generation, edits locally, and reauth resumes sync",
  { timeout: 180_000 },
  async (t) => {
    const harness = new SyncHarness({ mode: "session" });
    t.after(() => harness.close());
    await harness.start();
    const { page, context, errors } = await harness.openSessionPage();
    await waitForPersistence(page);
    await registerAndSync(page, "Expiry Alice");
    const before = (await readDocuments(page)).authState;
    const beforeChanges = await waitForD1Count(harness, "changes", 1);
    const syncRequests = [];
    await page.route("**/api/v1/sync/**", (route) => {
      syncRequests.push(Date.now());
      return route.continue();
    });

    await context.clearCookies();
    await addOffering(page, "phy302-s");
    await waitForPersistence(page);
    await waitForSyncText(page, "再認証が必要");
    const reauth = await waitForAuthState(page, "reauth_required");
    assert.equal(reauth.generation, before.generation);
    assert.equal(reauth.accountHandle, before.accountHandle);
    const requests = syncRequests.length;
    await page.waitForTimeout(1_200);
    assert.equal(syncRequests.length, requests);
    const local = await readPlannerText(
      page,
      `account:${before.accountHandle}:planner`,
    );
    assert.equal(hasEnrollment(local, "phy302-s"), true);

    await page.unroute("**/api/v1/sync/**");
    await signIn(page);
    const active = await waitForAuthState(page, "active");
    assert.notEqual(active.generation, before.generation);
    await waitSynced(page);
    await waitForD1Count(harness, "changes", beforeChanges + 1);
    assert.deepEqual(errors, []);
  },
);

test(
  "offline reload keeps the account plan editable and reconnects",
  { timeout: 180_000 },
  async (t) => {
    const harness = new SyncHarness({ mode: "session" });
    t.after(() => harness.close());
    await harness.start();
    await harness.runSessionJourney(
      "offline-reload",
      async (page) => {
        await waitForPersistence(page);
        await registerAndSync(page, "Offline Alice");
        const auth = (await readDocuments(page)).authState;
        const accountKey = `account:${auth.accountHandle}:planner`;

        await page.route("**/api/v1/**", (route) => route.abort("failed"));
        await addOffering(page, "phy302-s");
        await waitForPersistence(page);
        await waitForSyncText(page, "オフライン");
        await page.reload();
        await waitForPersistence(page);
        assert.equal(
          hasEnrollment(await readPlannerText(page, accountKey), "phy302-s"),
          true,
        );
        assert.equal(
          hasEnrollment(await readPlannerText(page, "planner"), "phy302-s"),
          false,
        );
        await page.unroute("**/api/v1/**");
        await page.locator("#sync-retry").click();
        await waitSynced(page);
        await waitForD1Count(harness, "changes", 1);
      },
      {
        expectedFaults: [
          {
            kind: "console",
            text: /Failed to load resource: net::ERR_FAILED/u,
            count: 3,
            reason: "The API is intentionally unavailable for offline reload.",
          },
        ],
      },
    );
  },
);

test(
  "a synthetic PRF canary is rejected and never retained in evidence",
  { timeout: 120_000 },
  async (t) => {
    const harness = new SyncHarness({ mode: "session" });
    t.after(() => harness.close());
    await harness.start();
    const canary = "prf-canary-183-browser-evidence";
    let responseStatus = null;
    let responseText = "";
    await harness.runSessionJourney(
      "prf-canary",
      async (page) => {
        await waitForPersistence(page);
        const result = await page.evaluate(async (marker) => {
          const response = await fetch("/api/v1/auth/sign-in/verify", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              challenge_id: "A".repeat(22),
              credential: {
                id: "AQ",
                rawId: "AQ",
                type: "public-key",
                response: {
                  clientDataJSON: "AQ",
                  authenticatorData: "AQ",
                  signature: "AQ",
                  userHandle: "AQ",
                  clientExtensionResults: {
                    prf: { results: { first: marker } },
                  },
                },
              },
            }),
          });
          return { status: response.status, text: await response.text() };
        }, canary);
        responseStatus = result.status;
        responseText = result.text;
      },
      {
        expectedFaults: [
          {
            kind: "console",
            text: /Failed to load resource: the server responded with a status of 400/u,
            count: 1,
            reason: "The synthetic PRF superset is intentionally rejected.",
          },
        ],
      },
    );
    assert.equal(responseStatus, 400);
    assert.equal(responseText.includes(canary), false);
    assert.equal(responseText.includes("clientExtensionResults"), false);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const evidence = await harness.readEvidence();
    assert.equal(evidence.includes(canary), false);
    const trace = await readTraceArchiveEntries(
      join(harness.evidenceDir, "prf-canary-trace.zip"),
    );
    for (const [, buffer] of trace) {
      assert.equal(buffer.includes(canary), false);
    }
  },
);
test(
  "an unrelated local root stops with history_mismatch and preserves recovery data",
  { timeout: 180_000 },
  async (t) => {
    const harness = new SyncHarness({ mode: "session" });
    t.after(() => harness.close());
    await harness.start();
    const { page, errors } = await harness.openSessionPage();
    await waitForPersistence(page);
    await registerAndSync(page, "History Alice");
    const auth = (await readDocuments(page)).authState;
    const accountKey = `account:${auth.accountHandle}:planner`;
    const document = (await harness.d1Query("SELECT id FROM documents"))[0].id;
    const metadataKey =
      "sync:" + JSON.stringify([auth.accountHandle, AUTH_ORIGIN, document]);
    const beforeMetadata = await readRecord(page, metadataKey);
    const beforeUnbound = await readRecord(page, "planner");
    const beforeChanges = await harness.d1Query(
      "SELECT COUNT(*) AS count FROM changes",
    );
    const independent = await readPlannerText(page, "planner");
    await writeIndependentPlan(page, accountKey, independent);
    const injected = await readRecord(page, accountKey);

    await page.evaluate(() => globalThis.tanikunSyncShell.sync());
    await waitForSyncText(page, "履歴が一致しません");
    assert.deepEqual(await readRecord(page, accountKey), injected);
    assert.deepEqual(await readRecord(page, metadataKey), beforeMetadata);
    assert.deepEqual(await readRecord(page, "planner"), beforeUnbound);
    const afterChanges = await harness.d1Query(
      "SELECT COUNT(*) AS count FROM changes",
    );
    assert.equal(Number(afterChanges[0].count), Number(beforeChanges[0].count));
    await openAccount(page);
    assert.match(
      await page.locator("#auth-dialog").innerText(),
      /両方のプランとカーソルは保持しています/u,
    );
    const downloadPromise = page.waitForEvent("download", { timeout: 5_000 });
    await page.locator('[data-action="download-local"]').click();
    const download = await downloadPromise;
    const path = await download.path();
    assert.equal(
      hasEnrollment(await readFile(path, "utf8"), "phy302-s"),
      false,
    );
    await closeAccount(page);
    assert.deepEqual(errors, []);
  },
);

test(
  "the account dialog renders canceled and unsupported passkey outcomes",
  { timeout: 120_000 },
  async (t) => {
    const harness = new SyncHarness({ mode: "session" });
    t.after(() => harness.close());
    await harness.start();
    const { page, errors } = await harness.openSessionPage();
    await waitForPersistence(page);
    await page.locator("#account-button").waitFor({ state: "visible" });
    await page.evaluate(() => {
      Object.defineProperty(navigator.credentials, "create", {
        configurable: true,
        value: async () => {
          throw new DOMException("canceled", "NotAllowedError");
        },
      });
    });
    await openAccount(page);
    await page.locator('[data-action="register-start"]').click();
    await page.locator("#auth-display-name").fill("Canceled Alice");
    await page.locator('[data-action="register-submit"]').click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("#auth-dialog-status")
          ?.textContent?.includes("キャンセル"),
      undefined,
      { timeout: 10_000 },
    );
    assert.equal(await page.locator("#auth-dialog").isVisible(), true);
    assert.equal(
      (await readDocuments(page)).authState.sessionState,
      "signed_out",
    );
    await closeAccount(page);

    await page.evaluate(() => {
      Object.defineProperty(navigator.credentials, "get", {
        configurable: true,
        value: async () => {
          throw new DOMException("unsupported", "SecurityError");
        },
      });
    });
    await openAccount(page);
    await page.locator('[data-action="sign-in"]').click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("#auth-dialog-status")
          ?.textContent?.includes("パスキーを利用できません"),
      undefined,
      { timeout: 10_000 },
    );
    assert.deepEqual(errors, []);
  },
);
test(
  "a copy prompt is withdrawn and creates no plan after another tab switches",
  { timeout: 180_000 },
  async (t) => {
    const harness = new SyncHarness({ mode: "session" });
    t.after(() => harness.close());
    await harness.start();
    const { page, errors } = await harness.openSessionPage();
    await waitForPersistence(page);
    await addOffering(page, "phy302-s");
    await openAccount(page);
    await page.locator('[data-action="register-start"]').click();
    await page.locator("#auth-display-name").fill("Copy Race Alice");
    await page.locator('[data-action="register-submit"]').click();
    await page
      .locator('[data-action="copy-plan"]')
      .waitFor({ state: "visible", timeout: 30_000 });
    const alice = (await readDocuments(page)).authState;
    const bobHandle = "B".repeat(43);
    await switchLocalAccount(page, bobHandle);
    await page.waitForFunction(
      () => globalThis.tanikunAuthController?.state?.stale === true,
    );
    assert.equal(await page.locator('[data-action="copy-plan"]').count(), 0);
    const after = await readDocuments(page);
    assert.equal(after.authState.accountHandle, bobHandle);
    assert.equal(after.authState.sessionState, "active");
    assert.equal(
      after.keys.includes(`account:${alice.accountHandle}:planner`),
      false,
    );
    assert.equal(
      after.keys.includes(`auth:upload:${alice.accountHandle}`),
      false,
    );
    assert.equal(
      hasEnrollment(await readPlannerText(page, "planner"), "phy302-s"),
      true,
    );
    await closeAccount(page);
    assert.deepEqual(errors, []);
  },
);
