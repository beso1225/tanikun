import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { startStaticServer, waitForPersistence } from "./planner-harness.mjs";

const dist = resolve(process.env.TANIKUN_WEB_DIST ?? "apps/web/dist");
const core = process.env.PLAYWRIGHT_CORE;
assert.ok(core, "run this test in `nix develop` so PLAYWRIGHT_CORE is set");
const { chromium } = await import(pathToFileURL(join(core, "index.mjs")).href);

test("hidden courses name their slots and link to display settings", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(origin);
  await waitForPersistence(page);
  await page.locator("#open-catalogue-picker").click();
  await page.locator("#open-custom-course").click();
  await page.locator("#custom-name").fill("Hidden course");
  await page.locator("#custom-day").selectOption("5");
  await page.locator("#custom-period").selectOption("7");
  await page.locator("#custom-submit").click();
  await page.locator("#add-offering-user-offering-1").click();
  await page.locator("#close-picker").click();
  assert.match(
    await page.locator("#hidden-blocks").innerText(),
    /土7限 · Hidden course/,
  );
  await page.locator("#open-hidden-settings").focus();
  await page.keyboard.press("Enter");
  await page.locator("#add-day").click();
  await page.locator("#close-settings").click();
  await page.locator("#settings").waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "open-hidden-settings",
  );
  assert.match(
    await page.locator("#hidden-blocks").innerText(),
    /土7限 · Hidden course/,
  );
  await page.locator("#open-hidden-settings").click();
  await page.locator("#add-period").click();
  await page.locator("#close-settings").click();
  await page.locator("#settings").waitFor({ state: "detached" });
  assert.equal(await page.locator("#hidden-blocks").count(), 0);
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "open-settings",
  );
  assert.ok(
    await page.locator("#timetable").getByText("Hidden course").isVisible(),
  );
  assert.ok(
    (await page.evaluate(() => document.documentElement.scrollWidth)) <= 390,
  );
});

test("half-credit requirement labels match the displayed totals", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(origin);
  await waitForPersistence(page);
  await page.locator("#open-catalogue-picker").click();
  await page.locator("#open-custom-course").click();
  await page
    .locator("#custom-name")
    .fill("Half credit with a long course name");
  await page.locator("#custom-credits").selectOption("1");
  await page.locator("#custom-day").selectOption("1");
  await page.locator("#custom-submit").click();
  await page.locator("#add-offering-user-offering-1").click();
  await page.locator("#close-picker").click();
  const bar = page
    .locator("#summary-requirements [data-requirement-bar]")
    .nth(1);
  assert.match(
    await bar.getAttribute("aria-label"),
    /履修予定込 6\.5 \/ 2単位/,
  );
  assert.match(
    await page.locator("#summary-requirements").innerText(),
    /6\.5 \/ 2単位/,
  );
  assert.match(
    await page
      .locator("#summary-requirements [data-requirement-bar]")
      .first()
      .getAttribute("aria-label"),
    /2 \/ 2件/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#open-settings").click();
  await page.locator("#add-day").click();
  await page.locator("#add-day").click();
  await page.locator("#close-settings").click();
  assert.ok(
    (await page.evaluate(() => document.documentElement.scrollWidth)) <= 390,
  );
  assert.equal(
    await page
      .getByRole("button", { name: /Half credit with a long course name/ })
      .count(),
    2,
  );
  assert.ok(
    await page.locator('[id^="mobile-detail-user-offering-1"]').isVisible(),
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await page
    .locator("#timetable")
    .getByText("Half credit with a long course name", { exact: true })
    .click();
  await page.locator("#open-override-editor").click();
  await page.locator("#override-slots-enabled").click();
  await page.locator("#override-day").selectOption("0");
  await page.locator("#override-period").selectOption("1");
  await page.locator("#override-submit").click();
  await page.locator("#override-form-error").waitFor();
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "override-day",
  );
  assert.equal(
    await page.locator("#override-day").getAttribute("aria-describedby"),
    "override-form-error",
  );
  await page.locator("#close-override-editor").click();
  await page.locator("#close-detail").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[id^="mobile-detail-user-offering-1"]').click();
  await page.locator("#remove-detail").click();
  await page.locator("#undo-removal").waitFor();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator("#undo-removal-button").click();
  await page.locator("#undo-removal").waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "open-catalogue-picker",
  );
  assert.equal(
    await page
      .locator("#timetable")
      .getByText("Half credit with a long course name", { exact: true })
      .count(),
    1,
  );
});
