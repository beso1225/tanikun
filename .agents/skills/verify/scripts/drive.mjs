import assert from "node:assert/strict";
import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertSummaryTotals,
  auditAccessibility,
  startStaticServer,
  waitForPersistence,
} from "../../../../tests/integration/planner-harness.mjs";

const feature = process.argv[2] ?? "all";
const modes = [
  "timetable",
  "enrollment-status",
  "custom-courses",
  "overrides",
  "summary-profile-year",
  "local-persistence",
];
assert.ok(
  feature === "all" || modes.includes(feature),
  `unknown feature: ${feature}`,
);
const mappedModes = (await readdir(new URL("../features/", import.meta.url)))
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .map((name) => name.slice(0, -3));
assert.deepEqual(
  modes.toSorted(),
  mappedModes.toSorted(),
  "verify feature map and drive.mjs modes differ; implement a journey for each feature file",
);
const dist = resolve(process.env.TANIKUN_WEB_DIST ?? "apps/web/dist");
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
  await waitForPersistence(page);
  const clearPersistence = () =>
    page.evaluate(
      () =>
        new Promise((finish, reject) => {
          const request = indexedDB.deleteDatabase("tanikun-planner");
          request.addEventListener("success", () => finish(), { once: true });
          request.addEventListener("error", () => reject(request.error), {
            once: true,
          });
          request.addEventListener(
            "blocked",
            () => reject(new Error("delete blocked")),
            { once: true },
          );
        }),
    );
  const openCourse = async (name) => {
    await page.locator("#timetable").getByText(name, { exact: true }).click();
    await page.locator("#course-detail-dialog").waitFor();
  };
  const closeDetail = async () => {
    await page.locator("#close-detail").click();
    await page.locator("#course-detail-dialog").waitFor({ state: "detached" });
  };
  for (const mode of feature === "all" ? modes : [feature]) {
    // Each mapped journey starts from the seed, not the previous mode's saved
    // document. Clear IndexedDB before the reload that begins the journey.
    await clearPersistence();
    await page.reload();
    await page.getByRole("heading", { name: "応物単位くん" }).waitFor();
    await waitForPersistence(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await assertSummaryTotals(page, "0単位", "0単位", "6単位");
    if (mode === "timetable") {
      assert.equal(await page.locator("nav button").count(), 4);
      await page.locator("#term-S2").click();
      await page.getByRole("heading", { name: "S2", exact: true }).waitFor();
      await page.locator("#term-A1").click();
      await page.locator("#off-grid").getByText("W（冬期）").waitFor();
      await page
        .locator("#off-grid")
        .getByText("Winter Workshop", { exact: true })
        .waitFor();
      await page.locator("#term-A2").click();
      await page.getByRole("heading", { name: "A2", exact: true }).waitFor();
      await page.locator("#off-grid").getByText("W（冬期）").waitFor();
      await page
        .locator("#off-grid")
        .getByText("Winter Workshop", { exact: true })
        .waitFor();
      await page.locator("#term-S1").click();
      assert.match(
        await page.locator('[id^="open-detail-phy101-s1"]').first().innerText(),
        /予定/,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.locator('[id^="mobile-detail-phy101-s1"]').click();
      await page.locator("#course-detail-dialog").waitFor();
      await page.keyboard.press("Escape");
      await page
        .locator("#course-detail-dialog")
        .waitFor({ state: "detached" });
      assert.match(
        await page.evaluate(() => document.activeElement?.id),
        /^mobile-detail-/,
      );
    } else if (mode === "enrollment-status") {
      await openCourse("Physics I");
      await page.locator("#status-passed").click();
      await page.locator("#grade-good").click();
      await page.locator("#grade-good[aria-pressed='true']").waitFor();
      await closeDetail();
      assert.match(
        await page.locator('[id^="open-detail-phy101-s1"]').first().innerText(),
        /合格/,
      );
      await assertSummaryTotals(page, "2単位", "2単位", "6単位");
      await openCourse("Physics Lab");
      await page.locator("#remove-detail").click();
      await assertSummaryTotals(page, "2単位", "2単位", "5単位");
      await page.locator("#undo-removal-button").click();
      await assertSummaryTotals(page, "2単位", "2単位", "6単位");
      assert.equal(
        await page.locator('[id^="open-detail-phy201-year"]').count(),
        1,
      );
      assert.match(
        await page
          .locator('[id^="open-detail-phy201-year"]')
          .first()
          .innerText(),
        /予定/,
      );
      assert.match(
        await page.evaluate(() => document.activeElement?.id),
        /^open-detail-phy201-year-/,
      );
    } else if (mode === "custom-courses") {
      await page.locator("#open-catalogue-picker").click();
      await page.locator("#open-custom-course").click();
      assert.equal(await page.locator("#custom-year").inputValue(), "2026");
      assert.equal(
        await page.locator("#custom-term-s1").getAttribute("aria-pressed"),
        "true",
      );
      await page.locator("#custom-submit").click();
      await page.locator("#custom-form-error[role='alert']").waitFor();
      assert.equal(
        await page.evaluate(() => document.activeElement?.id),
        "custom-name",
      );
      await page.locator("#custom-name").fill("Verification course");
      await page.locator("#custom-submit").click();
      await page.locator('[id^="add-offering-user-offering-"]').click();
      await page.locator("#close-picker").click();
      await page
        .locator("#timetable")
        .getByText("Verification course", { exact: true })
        .waitFor();
      await page.locator("#open-catalogue-picker").click();
      const editId = await page
        .locator('[id^="edit-custom-"]')
        .getAttribute("id");
      await page.locator('[id^="edit-custom-"]').click();
      assert.equal(
        await page.locator("#custom-name").inputValue(),
        "Verification course",
      );
      assert.equal(await page.locator("#custom-year").inputValue(), "2026");
      await page.locator("#custom-name").fill("Verification course edited");
      await page.locator("#custom-submit").click();
      await page.locator("#picker").waitFor();
      assert.equal(
        await page.locator('[id^="edit-custom-"]').getAttribute("id"),
        editId,
      );
      await page.locator("#close-picker").click();
      await page
        .locator("#timetable")
        .getByText("Verification course edited", { exact: true })
        .waitFor();
      await page.locator("#term-A1").click();
      await page.getByRole("heading", { name: "A1", exact: true }).waitFor();
      await page.locator("#open-intensive-picker").click();
      await page.locator("#open-custom-course").click();
      await page.locator("#custom-course").waitFor();
      await page.locator("#custom-name").fill("Winter verification");
      await page.locator("#custom-term").selectOption("W");
      await page.locator("#custom-submit").click();
      await page.locator("#picker").waitFor();
      await page.locator('[id^="add-offering-user-offering-"]').click();
      await page.locator("#close-picker").click();
      await page.locator("#picker").waitFor({ state: "detached" });
      assert.equal(await page.locator("header h2").first().innerText(), "A1");
      await page.locator("#off-grid").getByText("W（冬期）").waitFor();
      await page
        .locator("#off-grid")
        .getByText("Winter verification", { exact: true })
        .waitFor();
      await waitForPersistence(page);
      await page.reload();
      await waitForPersistence(page);
      assert.equal(await page.locator("header h2").first().innerText(), "A1");
      await page
        .locator("#off-grid")
        .getByText("Winter verification", { exact: true })
        .waitFor();
    } else if (mode === "overrides") {
      await openCourse("Physics I");
      await page.locator("#status-passed").click();
      await page.locator("#grade-good").click();
      await page.locator("#grade-good[aria-pressed='true']").waitFor();
      await closeDetail();
      assert.equal(await page.locator("#override-passed-note").count(), 0);
      await openCourse("Physics I");
      await page.locator("#open-override-editor").click();
      await page.locator("#override-passed-note").waitFor();
      await page.locator("#close-override-editor").click();
      await page.locator("#override-editor").waitFor({ state: "detached" });
      await closeDetail();
      await openCourse("Physics Lab");
      await page.locator("#open-override-editor").click();
      await page.locator("#override-name").fill("Verification override");
      await page.locator("#override-submit").click();
      await page
        .locator("#course-detail-title")
        .getByText("Verification override", { exact: true })
        .waitFor();
      await closeDetail();
      await page
        .locator("#timetable")
        .getByText("Verification override", { exact: true })
        .waitFor();
    } else if (mode === "summary-profile-year") {
      assert.match(
        await page.locator("#summary-scope").innerText(),
        /すべての学年・学期/,
      );
      assert.equal(
        await page
          .locator("#summary-requirements [data-requirement-bar]")
          .count(),
        3,
      );
      const requirementText = await page
        .locator("#summary-requirements")
        .innerText();
      assert.match(requirementText, /合格済/);
      assert.match(requirementText, /履修中/);
      assert.match(requirementText, /履修予定/);
      assert.equal(
        await page.locator("#requirement-summary").getAttribute("role"),
        "status",
      );
      assert.equal(
        await page.locator("#requirement-summary").innerText(),
        "要件（履修予定込）: 計画上充足",
      );
      await page.locator("#open-settings").click();
      await page.locator("#program-select").selectOption("applied-chemistry");
      await page.waitForFunction(() =>
        document
          .querySelector("#requirement-summary")
          ?.textContent.includes("不足"),
      );
      await page.locator("#program-select").selectOption("applied-physics");
      await page.locator("#year-select").selectOption("2025");
      await page.locator("#year-select").selectOption("2026");
      await page.locator("#close-settings").click();
      await page.locator("#grade-select").selectOption("4");
      await page.waitForFunction(() =>
        document
          .querySelector("#term-context")
          ?.textContent.includes("2027年度"),
      );
      await assertSummaryTotals(page, "0単位", "0単位", "6単位");
    } else if (mode === "local-persistence") {
      assert.equal(
        await page.locator("#persistence-status").getAttribute("role"),
        "status",
      );
      assert.equal(
        await page.locator("#persistence-status").innerText(),
        "保存済み",
      );
      await page.evaluate(() => {
        globalThis.verifyPersistenceLabels = [];
        const target = document.querySelector("#persistence-status");
        new MutationObserver(() => {
          const label = target?.textContent ?? "";
          if (globalThis.verifyPersistenceLabels.at(-1) !== label)
            globalThis.verifyPersistenceLabels.push(label);
        }).observe(target, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      });
      await page.locator("#open-catalogue-picker").click();
      await page.locator("#add-offering-phy302-s").click();
      await page.locator("#close-picker").click();
      await page
        .locator("#off-grid")
        .getByText("Seminar S2", { exact: true })
        .waitFor();
      await page.waitForFunction(
        () =>
          (globalThis.verifyPersistenceLabels.includes("未保存") ||
            globalThis.verifyPersistenceLabels.includes("保存中")) &&
          globalThis.verifyPersistenceLabels.at(-1) === "保存済み",
      );
      await assertSummaryTotals(page, "0単位", "0単位", "7単位");
      await page.reload();
      await page.getByRole("heading", { name: "応物単位くん" }).waitFor();
      await waitForPersistence(page);
      assert.equal(
        await page.locator("#persistence-status").innerText(),
        "保存済み",
      );
      await page
        .locator("#off-grid")
        .getByText("Seminar S2", { exact: true })
        .waitFor();
      await assertSummaryTotals(page, "0単位", "0単位", "7単位");
      assert.equal(await page.locator("#planner-error").count(), 0);
    }
    assert.deepEqual(await auditAccessibility(page), []);
    await page.screenshot({
      path: resolve(evidenceDir, `${mode}.png`),
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  await context.tracing.stop({
    path: resolve(evidenceDir, `${feature}-trace.zip`),
  });
  console.log(
    JSON.stringify({
      ok: true,
      feature,
      evidence: (feature === "all" ? modes : [feature]).map((mode) =>
        resolve(evidenceDir, `${mode}.png`),
      ),
      trace: resolve(evidenceDir, `${feature}-trace.zip`),
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
