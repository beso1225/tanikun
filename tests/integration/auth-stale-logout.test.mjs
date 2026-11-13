import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { startStaticServer, waitForPersistence } from "./planner-harness.mjs";

const core = process.env.PLAYWRIGHT_CORE;
assert.ok(core, "run inside nix develop");
const { chromium } = await import(pathToFileURL(join(core, "index.mjs")).href);
const dist = resolve(process.env.TANIKUN_WEB_DIST ?? "apps/web/dist");
const alice = "A".repeat(43);
const bob = "B".repeat(43);
const aliceCsrf = "C".repeat(43);
const bobCsrf = "D".repeat(43);
const sessionBody = (handle, csrf, name) => ({
  session: {
    account: { handle, display_name: name },
    expires_at: Date.now() + 43_200_000,
    idle_expires_at: Date.now() + 1_800_000,
    recent_auth: true,
    recent_auth_expires_at: Date.now() + 300_000,
    csrf_token: csrf,
  },
});
const json = (status, body) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

for (const scenario of [
  "shared-state",
  "server-only",
  "csrf-switch",
  "csrf-expiry",
]) {
  const sharedStateChanges = scenario === "shared-state";
  const csrfRetry = scenario.startsWith("csrf-");
  test(`logout preserves account isolation and recovery (${scenario})`, async (t) => {
    const { server, origin } = await startStaticServer(dist);
    t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      globalThis["__TANIKUN_SYNC_CONFIG__"] = { mode: "session", maxRetry: 0 };
    });
    // Isolate the logout decision from background sync session polling. The
    // real account journeys separately exercise auth and sync together.
    await page.route(`${origin}/sync-shell.js`, (route) =>
      route.fulfill({ contentType: "text/javascript", body: "export {};" }),
    );
    let serverSession = "alice";
    const logoutCalls = [];
    await page.route(`${origin}/api/v1/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/v1/auth/session") {
        if (serverSession === "expired") {
          await route.fulfill(json(401, { error: { code: "unauthorized" } }));
          return;
        }
        if (serverSession === "signed_out") {
          await route.fulfill(json(200, { session: null }));
          return;
        }
        const body =
          serverSession === "alice"
            ? sessionBody(alice, aliceCsrf, "Alice")
            : sessionBody(bob, bobCsrf, "Bob");
        await route.fulfill(json(200, body));
        return;
      }
      if (url.pathname === "/api/v1/auth/logout") {
        const csrf = request.headers()["x-csrf-token"];
        logoutCalls.push({ csrf, session: serverSession });
        if (csrfRetry && logoutCalls.length === 1) {
          serverSession = scenario === "csrf-switch" ? "bob" : "expired";
          await route.fulfill(json(403, { error: { code: "csrf_forbidden" } }));
          return;
        }
        if (csrf === (serverSession === "alice" ? aliceCsrf : bobCsrf)) {
          serverSession = "signed_out";
          await route.fulfill({ status: 204, body: "" });
        } else {
          await route.fulfill(json(403, { error: { code: "csrf_forbidden" } }));
        }
        return;
      }
      if (url.pathname.startsWith("/api/v1/sync/")) {
        await route.fulfill(json(404, { error: { code: "not_found" } }));
        return;
      }
      await route.fulfill(json(404, { error: { code: "not_found" } }));
    });
    await page.goto(origin);
    await waitForPersistence(page);
    await page.evaluate(() => globalThis.tanikunAuthController.ready);
    assert.equal(
      await page.evaluate(() => globalThis.tanikunSyncShell),
      undefined,
    );
    await page.locator("#account-button").waitFor({ state: "visible" });
    await page.waitForFunction(
      () => document.querySelector("#account-button")?.textContent === "Alice",
    );

    await page.locator("#account-button").click();
    assert.match(
      await page.locator("#auth-dialog").innerText(),
      /サインイン中: Alice/u,
    );
    // Let the account's credential-list read settle before the external switch.
    await page.waitForFunction(
      () => !globalThis.tanikunAuthController.state.credentialsLoading,
    );

    // Another tab signs in Bob: server cookie and shared IndexedDB auth state move.
    if (!csrfRetry) serverSession = "bob";
    if (sharedStateChanges)
      await page.evaluate(
        async ({ handle }) => {
          const other = globalThis.tanikunAuthStateModule.createAuthStateStore({
            indexedDB: globalThis.indexedDB,
            channelFactory: null,
            locks: null,
          });
          await other.write({ accountHandle: handle, sessionState: "active" });
          other.close();
        },
        { handle: bob },
      );
    assert.equal(await page.locator("#account-button").innerText(), "Alice");

    const reloaded =
      scenario === "csrf-expiry" ? page.waitForEvent("load") : null;
    await page.locator('[data-action="logout"]').click();
    if (reloaded) await reloaded;
    if (scenario === "csrf-expiry") {
      await page.waitForFunction(
        async () =>
          (await globalThis.tanikunAuthState.read()).sessionState ===
          "signed_out",
      );
      assert.deepEqual(logoutCalls, [{ csrf: aliceCsrf, session: "alice" }]);
      assert.equal(
        (await page.evaluate(() => globalThis.tanikunAuthState.read()))
          .accountHandle,
        null,
      );
      return;
    }
    await page.waitForFunction(
      () => globalThis.tanikunAuthController.state.stale === true,
    );
    assert.deepEqual(
      logoutCalls,
      csrfRetry ? [{ csrf: aliceCsrf, session: "alice" }] : [],
    );
    const auth = await page.evaluate(() => globalThis.tanikunAuthState.read());
    assert.equal(auth.sessionState, "active");
    assert.equal(auth.accountHandle, sharedStateChanges ? bob : alice);
    assert.equal(
      await page.evaluate(() => globalThis.tanikunAuthController.state.stale),
      true,
    );
    assert.ok(await page.locator('[data-action="reload"]').count());
  });
}
