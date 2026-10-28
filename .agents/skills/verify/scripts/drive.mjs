import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertSummaryTotals,
  auditAccessibility,
  startStaticServer,
} from "../../../../tests/integration/planner-harness.mjs";

const feature = process.argv[2] ?? "timetable";
assert.equal(feature, "timetable", `unknown feature: ${feature}`);
const dist = resolve("apps/web/dist");
const core = process.env.PLAYWRIGHT_CORE;
assert.ok(core, "PLAYWRIGHT_CORE is not set; run inside `nix develop`");
const { chromium } = await import(pathToFileURL(join(core, "index.mjs")).href);
const evidenceDir = resolve(".cache/verify");
await mkdir(evidenceDir, { recursive: true });

let server;
let browser;
let context;
try {
  ({ server } = await startStaticServer(dist));
  browser = await chromium.launch();
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(`http://127.0.0.1:${server.address().port}`, {
    waitUntil: "load",
  });
  await page.getByRole("heading", { name: "応物単位くん" }).waitFor();
  assert.equal(await page.locator("nav button").count(), 4);
  assert.deepEqual(await auditAccessibility(page), []);
  await assertSummaryTotals(page, "0単位", "0単位", "6単位");
  await page.locator("#term-S2").click();
  await page.getByRole("heading", { name: "S2" }).waitFor();
  await page.locator("#term-S1").click();
  await page.getByRole("heading", { name: "S1" }).waitFor();
  await page.locator("#term-A1").click();
  await page.locator("#off-grid").getByText("W（冬期）").waitFor();
  await page.locator("#term-S1").click();
  await page.getByRole("heading", { name: "S1" }).waitFor();
  await page.screenshot({
    path: resolve(evidenceDir, `${feature}.png`),
    fullPage: false,
  });
  assert.deepEqual(errors, []);
  await context.tracing.stop();
  console.log(
    JSON.stringify({
      ok: true,
      feature,
      evidence: resolve(evidenceDir, `${feature}.png`),
    }),
  );
} catch (error) {
  if (context) {
    await context.tracing.stop({
      path: resolve(evidenceDir, `${feature}-failure-trace.zip`),
    });
    const page = context.pages()[0];
    if (page) {
      await page.screenshot({
        path: resolve(evidenceDir, `${feature}-failure.png`),
        fullPage: true,
      });
    }
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
}
