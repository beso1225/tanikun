import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { startStaticServer, waitForPersistence } from "./planner-harness.mjs";

const core = process.env.PLAYWRIGHT_CORE;
assert.ok(core, "run inside nix develop");
const { chromium } = await import(pathToFileURL(join(core, "index.mjs")).href);
const dist = resolve(process.env.TANIKUN_WEB_DIST ?? "apps/web/dist");
const handle = "S".repeat(43);
const csrf = "C".repeat(43);
const json = (status, body) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});
const active = () => ({
  session: {
    account: { handle, display_name: "Alice" },
    expires_at: Date.now() + 43_200_000,
    idle_expires_at: Date.now() + 1_800_000,
    recent_auth: true,
    recent_auth_expires_at: Date.now() + 300_000,
    csrf_token: csrf,
  },
});

for (const ordering of ["committed", "refresh-first", "expiry-first"]) {
  const queued = ordering !== "committed";
  test(`a delayed active status preserves reauthentication (${ordering})`, async (t) => {
    const { server, origin } = await startStaticServer(dist);
    t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.addInitScript(() => {
      globalThis["__TANIKUN_SYNC_CONFIG__"] = { mode: "session", maxRetry: 0 };
    });
    let holdNextStatus = false;
    let releaseStatus;
    const released = new Promise((resolveRelease) => {
      releaseStatus = resolveRelease;
    });
    let statusCalls = 0;
    await page.route(`${origin}/api/v1/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/v1/auth/session") {
        statusCalls += 1;
        if (holdNextStatus) {
          holdNextStatus = false;
          await released;
        }
        await route.fulfill(json(200, active()));
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
    await page.locator("#account-button").waitFor({ state: "visible" });
    await page.waitForFunction(
      () => globalThis.tanikunAuthController?.state?.sessionState === "active",
    );
    assert.equal(
      await page.evaluate(
        async () => (await globalThis.tanikunAuthState.read()).sessionState,
      ),
      "active",
    );

    if (queued)
      await page.evaluate(
        () =>
          new Promise((ready) => {
            navigator.locks.request("tanikun-auth-v1", async () => {
              ready();
              await new Promise((release) => {
                globalThis.releaseAuthLock = release;
              });
            });
          }),
      );
    // Hold a status response while injecting the state transition made by a 401.
    holdNextStatus = true;
    if (ordering === "expiry-first")
      await page.evaluate(() =>
        globalThis.tanikunAuthController.onSyncStatus({ code: "unauthorized" }),
      );
    const refresh = page.evaluate(() =>
      globalThis.tanikunAuthController.refresh(),
    );
    await page.waitForFunction(
      () => globalThis.tanikunAuthController?.state?.sessionState === "loading",
    );
    if (ordering === "refresh-first") {
      await page.evaluate(() =>
        globalThis.tanikunAuthController.onSyncStatus({ code: "unauthorized" }),
      );
    } else if (!queued) {
      await page.evaluate(async () => {
        const expected = await globalThis.tanikunAuthState.read();
        await globalThis.tanikunAuthState.setSessionState(
          "reauth_required",
          expected,
        );
      });
    }
    const before = await page.evaluate(async () => ({
      auth: await globalThis.tanikunAuthState.read(),
      state: globalThis.tanikunAuthController?.state,
    }));
    releaseStatus();
    if (ordering === "expiry-first")
      await page.evaluate(() => globalThis.releaseAuthLock());
    if (ordering === "refresh-first") {
      await refresh;
      assert.equal(
        await page.evaluate(
          () => globalThis.tanikunAuthController.state.sessionState,
        ),
        "reauth_required",
      );
      await page.evaluate(() => globalThis.releaseAuthLock());
    }
    await refresh;
    await page.waitForFunction(
      async () =>
        (await globalThis.tanikunAuthState.read()).sessionState ===
        "reauth_required",
    );
    const after = await page.evaluate(async () => ({
      auth: await globalThis.tanikunAuthState.read(),
      state: globalThis.tanikunAuthController?.state,
    }));
    assert.equal(after.auth.sessionState, "reauth_required");
    assert.equal(after.auth.generation, before.auth.generation);
    assert.equal(after.state.sessionState, "reauth_required");
    assert.equal(after.state.stale, false);
    await page.locator("#account-button").click();
    assert.match(await page.locator("#auth-dialog").innerText(), /再認証する/u);
    await page.evaluate(() => globalThis.tanikunAuthController.refresh());
    assert.deepEqual(
      await page.evaluate(() => globalThis.tanikunAuthState.read()),
      after.auth,
    );
  });
}

test("initial session refresh waits for the first auth-state commit", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((close) => server.close(close)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript(() => {
    globalThis["__TANIKUN_SYNC_CONFIG__"] = { mode: "session", maxRetry: 0 };
    const request = navigator.locks.request.bind(navigator.locks);
    let first = true;
    navigator.locks.request = (name, options, operation) =>
      request(name, options, async (lock) => {
        if (name === "tanikun-auth-v1" && first) {
          first = false;
          await new Promise((release) => {
            globalThis.releaseInitialAuthLock = release;
          });
        }
        return operation(lock);
      });
  });
  await page.route(`${origin}/sync-shell.js`, (route) =>
    route.fulfill({ contentType: "text/javascript", body: "export {};" }),
  );
  await page.route(`${origin}/api/v1/auth/session`, (route) =>
    route.fulfill(json(200, active())),
  );
  await page.goto(origin);
  await page.waitForFunction(
    () => globalThis.tanikunAuthController && globalThis.releaseInitialAuthLock,
  );
  assert.equal(
    await page.evaluate(
      () => globalThis.tanikunAuthController.state.sessionState,
    ),
    "loading",
  );
  await page.evaluate(() => globalThis.releaseInitialAuthLock());
  await page.evaluate(() => globalThis.tanikunAuthController.ready);
  assert.equal(
    await page.evaluate(
      () => globalThis.tanikunAuthController.state.sessionState,
    ),
    "active",
  );
  assert.equal(
    await page.evaluate(
      async () => (await globalThis.tanikunAuthState.read()).accountHandle,
    ),
    handle,
  );
});

test("a slow initial session status selects the account planner before loading", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((close) => server.close(close)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript(() => {
    globalThis["__TANIKUN_SYNC_CONFIG__"] = { mode: "session", maxRetry: 0 };
  });
  let first = true;
  await page.route(`${origin}/api/v1/**`, async (route) => {
    if (new URL(route.request().url()).pathname === "/api/v1/auth/session") {
      if (first) {
        first = false;
        await new Promise((release) => setTimeout(release, 2_500));
      }
      await route.fulfill(json(200, active()));
      return;
    }
    await route.fulfill(json(404, { error: { code: "not_found" } }));
  });
  await page.goto(origin);
  await page.evaluate(() => globalThis.tanikunAuthController.ready);
  await page.waitForFunction(() => globalThis.tanikunStorage.scope() !== null);
  assert.equal(
    await page.evaluate(() => globalThis.tanikunStorage.scope().plannerKey),
    `account:${handle}:planner`,
  );
  await waitForPersistence(page);
  assert.equal(
    await page.evaluate(() => globalThis.tanikunAuthController.state.stale),
    false,
  );
  await page.evaluate(() => globalThis.tanikunStorage.load());
  assert.equal(await page.locator("#planner-error").count(), 0);
});

test("a stalled initial status times out and permits local planning", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((close) => server.close(close)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript(() => {
    globalThis["__TANIKUN_SYNC_CONFIG__"] = { mode: "session", maxRetry: 0 };
  });
  // Leave the status request pending until the production client aborts it.
  await page.route(`${origin}/api/v1/auth/session`, () => {});
  await page.goto(origin);
  await page.waitForFunction(
    () => globalThis.tanikunAuthController !== undefined,
  );
  assert.equal(
    await page.evaluate(
      () => globalThis.tanikunAuthController.state.sessionState,
    ),
    "loading",
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#persistence-status")?.textContent === "保存済み",
    undefined,
    { timeout: 25_000 },
  );
  await page.evaluate(() => globalThis.tanikunAuthController.ready);
  assert.equal(
    await page.evaluate(() => globalThis.tanikunStorage.scope().plannerKey),
    "planner",
  );
  assert.equal(
    await page.evaluate(() => globalThis.tanikunAuthController.state.stale),
    false,
  );
  assert.equal(
    await page.evaluate(
      () => globalThis.tanikunAuthController.state.sessionState,
    ),
    "offline",
  );
  await page.locator('[id="open-detail-phy101-s1-月-1"]').click();
  await page.locator("#status-in-progress").click();
  await page.locator("#close-detail").click();
  assert.equal(
    await page.locator("#summary-total-standard").innerText(),
    "2単位",
  );
  await waitForPersistence(page);
  assert.equal(await page.locator("#planner-error").count(), 0);
});
