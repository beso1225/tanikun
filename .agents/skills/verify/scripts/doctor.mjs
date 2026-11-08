import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  startStaticServer,
  waitForPersistence,
} from "../../../../tests/integration/planner-harness.mjs";

const dist = resolve(process.env.TANIKUN_WEB_DIST ?? "apps/web/dist");
for (const file of [
  "index.html",
  "index.js",
  "automerge.js",
  "planner-document.js",
  "persistence-transactions.js",
  "persistence.js",
  "sync-store.js",
  "sync-metadata.js",
  "sync-coordinator.js",
  "sync-shell.js",
  "sync-transport.js",
  "sync-contract.mjs",
  "styles.css",
]) {
  await access(join(dist, file));
}
const core = process.env.PLAYWRIGHT_CORE;
assert.ok(core, "PLAYWRIGHT_CORE is not set; run inside `nix develop`");
const { chromium } = await import(pathToFileURL(join(core, "index.mjs")).href);

let server;
let browser;
try {
  ({ server } = await startStaticServer(dist));
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`, {
    waitUntil: "load",
  });
  await page.getByRole("heading", { name: "応物単位くん" }).waitFor();
  await waitForPersistence(page);
  await page.waitForFunction(
    () =>
      document.querySelector("#sync-status-text")?.textContent === "同期未設定",
  );
  assert.deepEqual(errors, [], "static page must load without browser errors");
  console.log(
    JSON.stringify({
      ok: true,
      dist,
      playwright: core,
      url: `http://127.0.0.1:${server.address().port}`,
    }),
  );
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
}
