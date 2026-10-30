import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  assertSummaryTotals,
  auditAccessibility,
  runJourney,
  startStaticServer,
  waitForPersistence,
} from "./planner-harness.mjs";

const dist = resolve(process.env.TANIKUN_WEB_DIST ?? "apps/web/dist");
const core = process.env.PLAYWRIGHT_CORE;
assert.ok(core, "run this test in `nix develop` so PLAYWRIGHT_CORE is set");
const { chromium } = await import(pathToFileURL(join(core, "index.mjs")).href);

test(
  "Phase 2 journey covers scheduling, status, custom data, overrides, and summary",
  { timeout: 60_000 },
  async (t) => {
    const { server, origin } = await startStaticServer(dist);
    t.after(() => new Promise((resolveClose) => server.close(resolveClose)));

    const browser = await chromium.launch();
    t.after(() => browser.close());
    await runJourney(browser, "phase2-journey", async (page, errors) => {
      await page.goto(origin, { waitUntil: "load" });
      await waitForPersistence(page);
      await page.getByRole("heading", { name: "応物単位くん" }).waitFor();
      assert.equal(await page.locator("nav button").count(), 4);
      assert.deepEqual(await auditAccessibility(page), []);
      await assertSummaryTotals(page, "0単位", "0単位", "6単位");

      await page.locator("#term-S2").click();
      await page.locator("#open-catalogue-picker").click();
      await page.locator("#picker").waitFor();
      await page.locator("#add-offering-phy102-s2").click();
      await page.locator("#close-picker").click();
      await page.locator("#picker").waitFor({ state: "detached" });
      await assertSummaryTotals(page, "0単位", "0単位", "8単位");

      await page.locator("#open-intensive-picker").click();
      await page.locator("#picker").waitFor();
      await page.locator("#add-offering-phy302-s").click();
      await page.locator("#close-picker").click();
      await page.locator("#picker").waitFor({ state: "detached" });
      await assertSummaryTotals(page, "0単位", "0単位", "9単位");

      await page
        .locator("#timetable")
        .getByText("Physics II", { exact: true })
        .click();
      await page.locator("#course-detail-dialog").waitFor();
      await page.locator("#remove-detail").click();
      await page
        .locator("#course-detail-dialog")
        .waitFor({ state: "detached" });
      await assertSummaryTotals(page, "0単位", "0単位", "7単位");
      await page.locator("#undo-removal").waitFor();

      await page.locator("#term-S1").click();
      await page.locator("#undo-removal").waitFor({ state: "detached" });
      await page
        .locator("#timetable")
        .getByText("Physics I", { exact: true })
        .click();
      await page.locator("#course-detail-dialog").waitFor();
      await page.locator("#status-passed").click();
      await page.locator("#grade-good").click();
      await page.locator("#grade-good[aria-pressed='true']").waitFor();
      await page.locator("#close-detail").click();
      await page
        .locator("#course-detail-dialog")
        .waitFor({ state: "detached" });
      await assertSummaryTotals(page, "2単位", "2単位", "7単位");

      await page.locator("#open-catalogue-picker").click();
      await page.locator("#picker").waitFor();
      await page.locator("#open-custom-course").click();
      await page.locator("#custom-course").waitFor();
      await page.locator("#custom-name").fill("Linearity");
      await page.locator("#custom-category").selectOption("lab");
      await page.locator("#custom-submit").click();
      await page.locator("#picker").waitFor();
      await page.locator("#add-offering-user-offering-1").click();
      await page.locator("#close-picker").click();
      await page.locator("#picker").waitFor({ state: "detached" });
      await page
        .locator("#timetable")
        .getByText("Linearity", { exact: true })
        .waitFor();
      await assertSummaryTotals(page, "2単位", "2単位", "9単位");
      await page
        .locator("#timetable")
        .getByText("Linearity", { exact: true })
        .click();
      await page.locator("#course-detail-dialog").waitFor();
      assert.match(
        await page.locator("#course-detail-dialog").innerText(),
        /区分 実験/,
      );
      await page.locator("#close-detail").click();
      await page
        .locator("#course-detail-dialog")
        .waitFor({ state: "detached" });

      await page
        .locator("#timetable")
        .getByText("Physics Lab", { exact: true })
        .click();
      await page.locator("#course-detail-dialog").waitFor();
      await page.locator("#open-override-editor").click();
      await page.locator("#override-editor").waitFor();
      await page.locator("#override-name").fill("Physics Lab Advanced");
      await page.locator("#override-slots-enabled").click();
      await page.locator("#override-day").selectOption("3");
      await page.locator("#override-period").selectOption("4");
      await page.locator("#override-submit").click();
      await page.locator("#course-detail-dialog").waitFor();
      assert.equal(
        await page.locator("#course-detail-title").innerText(),
        "Physics Lab Advanced",
      );
      await page.locator("#close-detail").click();
      await page
        .locator("#course-detail-dialog")
        .waitFor({ state: "detached" });
      await page
        .locator("#timetable")
        .getByText("Physics Lab Advanced", { exact: true })
        .waitFor();
      await assertSummaryTotals(page, "2単位", "2単位", "9単位");

      assert.match(
        await page.locator("#summary-requirements").innerText(),
        /達成/,
      );
      assert.deepEqual(errors, []);
    });
  },
);
