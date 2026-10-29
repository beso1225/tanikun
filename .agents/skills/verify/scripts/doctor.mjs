import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { startStaticServer } from "../../../../tests/integration/planner-harness.mjs";

const dist = resolve(process.env.TANIKUN_WEB_DIST ?? "apps/web/dist");
for (const file of ["index.html", "index.js", "styles.css"]) {
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
  await page.goto(`http://127.0.0.1:${server.address().port}`, {
    waitUntil: "load",
  });
  await page.getByRole("heading", { name: "応物単位くん" }).waitFor();
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
