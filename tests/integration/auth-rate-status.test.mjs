import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { startStaticServer, waitForPersistence } from "./planner-harness.mjs";

const core = process.env.PLAYWRIGHT_CORE;
assert.ok(core, "run inside nix develop");
const { chromium } = await import(pathToFileURL(join(core, "index.mjs")).href);
const dist = resolve("apps/web/dist");
const json = (status, body, headers = {}) => ({
  status,
  contentType: "application/json",
  headers,
  body: JSON.stringify(body),
});

test("an authentication 429 keeps the account dialog in cooldown", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript(() => {
    globalThis["__TANIKUN_SYNC_CONFIG__"] = { mode: "session", maxRetry: 0 };
  });
  await page.route(`${origin}/api/v1/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/auth/session") {
      await route.fulfill(json(200, { session: null }));
      return;
    }
    if (url.pathname === "/api/v1/auth/sign-in/options") {
      await route.fulfill(
        json(429, { error: { code: "rate_limited" } }, { "Retry-After": "30" }),
      );
      return;
    }
    await route.fulfill(json(404, { error: { code: "not_found" } }));
  });
  await page.goto(origin);
  await waitForPersistence(page);
  await page.locator("#account-button").waitFor({ state: "visible" });
  await page.locator("#account-button").click();
  await page.locator('[data-action="sign-in"]').click();
  await page.waitForFunction(() =>
    document
      .querySelector("#auth-dialog-status")
      ?.textContent?.includes("しばらく"),
  );
  const disabled = await page.locator('[data-action="sign-in"]').isDisabled();

  assert.equal(disabled, true);
});
