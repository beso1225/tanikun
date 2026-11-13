// Real session-mode credential management journey. Starts the production
// Worker bridge with local D1, serves the built page at https://localhost:4300
// through the harness loopback certificate, and uses Chromium virtual
// authenticators. The credentials, account, and planner data are synthetic.
// This proves the local Worker/D1/browser path, not a physical provider, public
// deployment, Linux CI matrix (#185), or cryptographic key recovery.

import assert from "node:assert/strict";
import test from "node:test";

import { waitForPersistence } from "./planner-harness.mjs";
import { SyncHarness } from "./sync-harness.mjs";

async function openAccount(page) {
  const width = page.viewportSize()?.width ?? 1280;
  const button =
    width < 768
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

async function waitForAuthState(page, sessionState, timeout = 30_000) {
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

async function addVirtualAuthenticator(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  return { cdp, authenticatorId };
}

async function removeVirtualAuthenticator(authenticator) {
  await authenticator.cdp.send("WebAuthn.removeVirtualAuthenticator", {
    authenticatorId: authenticator.authenticatorId,
  });
}

async function ageRecentAuth(harness) {
  await harness.d1Query("UPDATE sessions SET recent_auth_at = 0");
}

function normalizeCredentialId(value) {
  return Buffer.from(
    String(value).replaceAll("-", "+").replaceAll("_", "/"),
    "base64",
  ).toString("base64url");
}

test(
  "adds a second passkey, removes an owned passkey, invalidates sessions, and signs in with the survivor",
  { timeout: 240_000 },
  async (t) => {
    const harness = new SyncHarness({ mode: "session" });
    t.after(() => harness.close());
    await harness.start();
    const { page, context, authenticator, errors } =
      await harness.openSessionPage({
        viewport: { width: 390, height: 844 },
      });
    const second = await harness.openSessionPage({
      viewport: { width: 390, height: 844 },
    });
    await waitForPersistence(page);
    await waitForPersistence(second.page);
    await addOffering(page);

    await openAccount(page);
    await page.locator('[data-action="register-start"]').click();
    await page.locator("#auth-display-name").fill("Credential Owner");
    await page.locator('[data-action="register-submit"]').click();
    await page.locator('[data-action="copy-plan"]').waitFor({
      state: "visible",
      timeout: 60_000,
    });
    const copyNavigation = page.waitForNavigation({
      waitUntil: "load",
      timeout: 60_000,
    });
    await page.locator('[data-action="copy-plan"]').click();
    await copyNavigation;
    await waitForPersistence(page);
    const registered = await waitForAuthState(page, "active");
    const handle = registered.accountHandle;
    assert.match(handle, /^[A-Za-z0-9_-]{43}$/u);
    const plannerKey = `account:${handle}:planner`;
    assert.match(await readPlannerText(page, plannerKey), /phy302-s/u);

    await openAccount(page);
    await page.locator('[data-action="add-passkey"]').waitFor({
      state: "visible",
      timeout: 30_000,
    });
    assert.equal(
      await page.locator('[data-action="remove-passkey"]').count(),
      1,
    );
    assert.equal(
      await page.locator('[data-action="remove-passkey"]').isDisabled(),
      true,
    );

    const firstCredentials = await harness.exportCredentials(authenticator);
    assert.equal(firstCredentials.length, 1);
    const firstCredentialId = firstCredentials[0].credentialId;

    // Force the recent-auth window closed, then use the UI's approved
    // step-up path before creating the second passkey. The old authenticator
    // is exported and removed only after the step-up, so the fresh
    // authenticator can create the second resident credential without
    // satisfying the exclude list.
    await ageRecentAuth(harness);
    await page.locator('[data-action="add-passkey"]').click();
    await page.locator('[data-action="add-passkey-confirm"]').click();
    await page.locator('[data-action="add-passkey-create"]').waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await removeVirtualAuthenticator(authenticator);
    const secondAuthenticator = await addVirtualAuthenticator(context, page);
    await page.locator('[data-action="add-passkey-create"]').click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-action="remove-passkey"]').length ===
        2,
      undefined,
      { timeout: 30_000 },
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );

    const rows = await harness.d1Query(
      "SELECT credential_id, created_at FROM credentials ORDER BY created_at, credential_id",
    );
    assert.equal(rows.length, 2);
    const expectedId = normalizeCredentialId(firstCredentialId);
    const firstIndex = rows.findIndex(
      (row) => normalizeCredentialId(row.credential_id) === expectedId,
    );
    assert.notEqual(firstIndex, -1);

    await ageRecentAuth(harness);
    await page
      .locator('[data-action="remove-passkey"]')
      .nth(firstIndex)
      .click();
    await page
      .locator('[data-action="remove-passkey-confirm"]')
      .waitFor({ state: "visible" });
    const confirmation = await page.locator("#auth-dialog").innerText();
    assert.match(confirmation, /すべてのサインイン中のセッションが終了/u);
    assert.match(confirmation, /最後のパスキーは削除できません/u);
    await page.locator('[data-action="remove-passkey-confirm"]').click();
    await page.locator('[data-action="sign-in"]').waitFor({
      state: "visible",
      timeout: 30_000,
    });
    const afterRemoval = await waitForAuthState(page, "reauth_required");
    assert.equal(afterRemoval.accountHandle, handle);
    assert.equal(afterRemoval.generation, registered.generation);
    assert.equal(
      await page.locator("#account-button-mobile").innerText(),
      "再認証",
    );
    assert.match(
      await page.locator("#auth-dialog-status").innerText(),
      /すべてのセッションを終了/u,
    );
    assert.match(await readPlannerText(page, plannerKey), /phy302-s/u);

    const activeSessions = await harness.d1Query(
      "SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL",
    );
    assert.equal(Number(activeSessions[0].count), 0);

    const signInNavigation = page.waitForNavigation({
      waitUntil: "load",
      timeout: 60_000,
    });
    await page.locator('[data-action="sign-in"]').click();
    await signInNavigation;
    await waitForPersistence(page);
    await page.locator("#account-button-mobile").waitFor({ state: "visible" });
    const signedIn = await waitForAuthState(page, "active");
    assert.equal(signedIn.accountHandle, handle);
    assert.match(await readPlannerText(page, plannerKey), /phy302-s/u);
    await openAccount(page);
    await page.locator('[data-action="add-passkey"]').waitFor({
      state: "visible",
      timeout: 30_000,
    });
    assert.equal(
      await page.locator('[data-action="remove-passkey"]').count(),
      1,
    );
    await closeAccount(page);

    await harness.importCredentials(second.authenticator, firstCredentials);
    await openAccount(second.page);
    await second.page.locator('[data-action="sign-in"]').click();
    await second.page.waitForFunction(
      () =>
        document
          .querySelector("#auth-dialog-status")
          ?.textContent?.includes("認証の有効期限"),
      undefined,
      { timeout: 30_000 },
    );
    const secondState = await second.page.evaluate(() =>
      globalThis.tanikunAuthState.read(),
    );
    assert.equal(secondState.sessionState, "signed_out");
    const sessionsAfterRemovedAttempt = await harness.d1Query(
      "SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL",
    );
    assert.equal(Number(sessionsAfterRemovedAttempt[0].count), 1);

    const unexpected = errors.filter(
      (message) =>
        !/Failed to load resource: the server responded with a status of 401/u.test(
          message,
        ),
    );
    assert.deepEqual(unexpected, []);
    const secondUnexpected = second.errors.filter(
      (message) =>
        !/Failed to load resource: the server responded with a status of 401/u.test(
          message,
        ),
    );
    assert.deepEqual(secondUnexpected, []);
    await closeAccount(second.page);
    assert.ok(secondAuthenticator.authenticatorId);
  },
);
