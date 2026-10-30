import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { auditAccessibility, startStaticServer } from "./planner-harness.mjs";

const core = process.env.PLAYWRIGHT_CORE;
assert.ok(core, "run inside nix develop");
const { chromium } = await import(pathToFileURL(join(core, "index.mjs")).href);

test("phased schedules, coordinated cells, and mandatory planning", async (t) => {
  const { server, origin } = await startStaticServer(
    resolve(".cache/allocation-fixture/apps/web/dist"),
  );
  t.after(() => new Promise((done) => server.close(done)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  assert.match(
    await page.locator("#summary-requirements").innerText(),
    /予定に含まれていない必修/,
  );
  await page.locator("#open-catalogue-picker").click();
  for (const id of ["demo-design", "demo-lab", "demo-exercise"]) {
    await page.locator(`#add-offering-${id}`).click();
  }
  await page.locator("#close-picker").click();
  const design = page.locator(
    '#timetable button[id^="open-detail-demo-design-"]',
  );
  async function expectDesignCount(count) {
    await page.waitForFunction(
      (expected) =>
        document.querySelectorAll(
          '#timetable button[id^="open-detail-demo-design-"]',
        ).length === expected,
      count,
    );
    assert.equal(await design.count(), count);
  }
  await expectDesignCount(4);
  const shared = page
    .locator("#timetable td")
    .filter({ has: page.locator('button[id^="open-detail-demo-lab-"]') });
  assert.equal(await shared.locator("button").count(), 2);
  await page.locator("#term-S2").click();
  await expectDesignCount(6);
  await design.first().click();
  await page.locator("#status-passed").click();
  await page.locator("#close-detail").press("Escape");
  await page.locator("#course-detail-dialog").waitFor({ state: "hidden" });
  assert.match(await page.locator("#summary-total-confirmed").innerText(), /3/);
  await page.locator("#term-S1").click();
  await expectDesignCount(4);
  await page.locator('button[id^="open-detail-demo-lab-"]').first().click();
  assert.match(
    await page.locator("#course-detail-dialog").innerText(),
    /共用枠.*Verified fictional handout/,
  );
  await page.locator("#status-in-progress").click();
  await page.locator("#close-detail").click();
  const bar = page.getByRole("img", {
    name: "必修: 修得済 1 / 3科目, 履修中込 2 / 3科目, 履修予定込 3 / 3科目",
    exact: true,
  });
  await bar.waitFor();
  assert.match(
    await page.locator("#requirement-summary").innerText(),
    /計画上充足/,
  );
  await design.first().click();
  await page.locator("#remove-detail").click();
  await expectDesignCount(0);
  await page.locator("#undo-removal-button").click();
  await expectDesignCount(4);
  assert.match(
    await page.evaluate(() => document.activeElement?.id),
    /^open-detail-demo-design-/,
  );
  await bar.waitFor();
  assert.deepEqual(await auditAccessibility(page), []);
  await mkdir(".cache/verify", { recursive: true });
  await page.screenshot({
    path: ".cache/verify/allocations-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  assert.equal(await shared.locator("button").count(), 2);
  assert.deepEqual(await auditAccessibility(page), []);
  await page.screenshot({
    path: ".cache/verify/allocations-phone.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
});
