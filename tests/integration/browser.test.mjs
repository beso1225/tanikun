import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  assertCreditTotal,
  assertSummaryTotals,
  auditAccessibility,
  runJourney,
  startStaticServer,
} from "./planner-harness.mjs";

const dist = resolve(process.env.TANIKUN_WEB_DIST ?? "apps/web/dist");
const core = process.env.PLAYWRIGHT_CORE;
assert.ok(core, "run this test in `nix develop` so PLAYWRIGHT_CORE is set");
const { chromium } = await import(pathToFileURL(join(core, "index.mjs")).href);

test("half-credit requirement labels match the displayed totals", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(origin);
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
  assert.match(await bar.getAttribute("aria-label"), /履修予定込 6\.5\/2単位/);
  assert.match(
    await page.locator("#summary-requirements").innerText(),
    /6\.5 \/ 2単位/,
  );
  assert.match(
    await page
      .locator("#summary-requirements [data-requirement-bar]")
      .first()
      .getAttribute("aria-label"),
    /2\/2件/,
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
});

test(
  "built page renders the semester planner and resizes",
  { timeout: 60_000 },
  async (t) => {
    const { server, origin } = await startStaticServer(dist);
    t.after(() => new Promise((resolveClose) => server.close(resolveClose)));

    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();

    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    const response = await page.goto(origin, { waitUntil: "load" });
    assert.equal(response?.status(), 200);
    await page.getByRole("heading", { name: "応物単位くん" }).waitFor();
    assert.equal(await page.title(), "応物単位くん");
    assert.deepEqual(await auditAccessibility(page), []);
    assert.notEqual(
      await page
        .locator("header")
        .first()
        .evaluate((element) => getComputedStyle(element).borderTopLeftRadius),
      "0px",
    );
    assert.notEqual(
      await page
        .locator("aside")
        .first()
        .evaluate(
          (element) => getComputedStyle(element).borderBottomLeftRadius,
        ),
      "0px",
    );
    await assertCreditTotal(page, "履修予定込 6単位");
    assert.equal(
      await page.locator("#summary-total-confirmed").innerText(),
      "0単位",
    );
    assert.equal(
      await page.locator("#summary-total-standard").innerText(),
      "0単位",
    );
    assert.equal(
      await page.locator("#summary-total-optimistic").innerText(),
      "6単位",
    );
    assert.match(
      await page.locator("#summary-categories").innerText(),
      /基礎物理/,
    );
    assert.match(
      await page.locator("#summary-requirements").innerText(),
      /計画上充足/,
    );
    assert.match(
      await page.locator("#summary-requirements").innerText(),
      /履修中込/,
    );
    assert.match(
      await page.locator("#summary-requirements").innerText(),
      /履修予定込/,
    );
    assert.equal(
      await page
        .locator("#summary-requirements [data-requirement-bar]")
        .count(),
      3,
    );
    assert.equal(
      await page
        .locator("#summary-requirements [data-requirement-bar]")
        .nth(1)
        .getAttribute("aria-label"),
      "合計単位数: 修得済 0/2単位, 履修中込 0/2単位, 履修予定込 6/2単位",
    );
    assert.match(
      await page.locator("#summary-requirements").innerText(),
      /履修予定 2単位/,
    );
    assert.match(
      await page.locator("#summary-requirements").innerText(),
      /あと 2件/,
    );
    assert.match(
      await page.locator("#summary-requirements").innerText(),
      /あと 2単位/,
    );
    assert.equal(
      await page.getByLabel("プログラム", { exact: true }).count(),
      0,
    );
    assert.equal(await page.getByLabel("進級年度", { exact: true }).count(), 0);
    assert.equal(await page.getByLabel("学年", { exact: true }).count(), 1);
    await page.locator("#open-settings").click();
    await page.locator("#settings").waitFor();
    await page.locator("#close-settings").focus();
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "year-select",
    );
    assert.equal(
      await page.getByLabel("プログラム", { exact: true }).count(),
      1,
    );
    assert.equal(await page.getByLabel("進級年度", { exact: true }).count(), 1);
    assert.equal(await page.locator("#grade-select").inputValue(), "3");
    assert.equal(
      await page.locator("#grade-select option").nth(2).innerText(),
      "3年（2026年度）",
    );
    assert.equal(
      await page.locator("#program-select").inputValue(),
      "applied-physics",
    );
    assert.equal(await page.locator("#year-select").inputValue(), "2026");
    assert.equal(
      await page.locator("#requirement-summary").getAttribute("role"),
      "status",
    );
    assert.equal(
      await page.locator("#requirement-summary").innerText(),
      "要件（履修予定込）: 計画上充足",
    );

    await page.locator("#program-select").selectOption("applied-chemistry");
    await page.waitForFunction(
      () =>
        document.querySelector("#requirement-summary")?.textContent ===
        "要件（履修予定込）: 不足",
    );
    assert.equal(
      await page.locator("#program-select").inputValue(),
      "applied-chemistry",
    );
    assert.equal(await page.locator("#year-select").inputValue(), "2026");
    assert.equal(await page.locator("#year-select option").count(), 1);
    assert.equal(
      await page
        .locator("#timetable")
        .getByText("Physics I", { exact: true })
        .count(),
      1,
    );
    await assertCreditTotal(page, "履修予定込 6単位");

    await page.locator("#program-select").selectOption("applied-physics");
    await page.waitForFunction(
      () =>
        document.querySelector("#year-select")?.value === "2026" &&
        document.querySelector("#requirement-summary")?.textContent ===
          "要件（履修予定込）: 計画上充足",
    );
    assert.equal(await page.locator("#year-select option").count(), 2);
    await page.locator("#year-select").selectOption("2025");
    await page.waitForFunction(
      () =>
        document.querySelector("#year-select")?.value === "2025" &&
        document.querySelector("#requirement-summary")?.textContent ===
          "要件（履修予定込）: 不足",
    );
    await page.locator("#year-select").selectOption("2026");
    await page.waitForFunction(
      () => document.querySelector("#year-select")?.value === "2026",
    );
    await page.locator("#close-settings").click();
    await page.locator("#settings").waitFor({ state: "detached" });

    await page.getByRole("link", { name: "時間割へスキップ" }).focus();
    let tileReached = false;
    for (let index = 0; index < 50; index += 1) {
      await page.keyboard.press("Tab");
      const activeId = await page.evaluate(
        () => document.activeElement?.id ?? "",
      );
      if (activeId.startsWith("open-detail-phy101-s1")) {
        tileReached = true;
        break;
      }
    }
    assert.ok(tileReached);
    await page.keyboard.press("Enter");
    await page.locator("#course-detail-dialog").waitFor();
    assert.match(
      await page.locator("#course-detail-dialog").innerText(),
      /2単位 · 区分 基礎物理 · S1 · 月1/,
    );
    assert.equal(
      await page.locator("#status-planned").getAttribute("aria-pressed"),
      "true",
    );
    await page.keyboard.press("Escape");
    await page.locator("#course-detail-dialog").waitFor({ state: "detached" });
    assert.match(
      await page.evaluate(() => document.activeElement?.id),
      /^open-detail-phy101-s1/,
    );

    const contextBox = await page.locator("#term-context").boundingBox();
    assert.ok(contextBox);
    await page.locator("#term-A1").click();
    await page.locator("#off-grid").getByText("Seminar A").waitFor();
    const aContextBox = await page.locator("#term-context").boundingBox();
    assert.ok(aContextBox);
    assert.equal(aContextBox.x, contextBox.x);
    await page.locator("#term-S1").click();
    await page.locator("#timetable").waitFor();

    assert.equal(await page.locator("nav button").count(), 4);
    assert.equal(await page.locator("#term-S1").count(), 1);
    assert.equal(await page.locator("#term-S2").count(), 1);
    assert.equal(await page.locator("#term-A1").count(), 1);
    assert.equal(await page.locator("#term-A2").count(), 1);
    assert.equal(await page.locator("#term-W").count(), 0);

    assert.equal(await page.locator("#add-day").count(), 0);
    assert.equal(await page.locator("#open-settings").count(), 1);
    const addButtonBox = await page
      .locator("#open-catalogue-picker")
      .boundingBox();
    const settingsButtonBox = await page
      .locator("#open-settings")
      .boundingBox();
    assert.ok(addButtonBox);
    assert.ok(settingsButtonBox);
    assert.ok(settingsButtonBox.x > addButtonBox.x);
    assert.equal(await page.locator("#open-settings").innerText(), "設定");
    await page.locator("#open-settings").click();
    await page.locator("#settings").waitFor();
    assert.equal(
      await page.locator("#settings").getAttribute("role"),
      "dialog",
    );
    assert.deepEqual(await auditAccessibility(page), []);
    assert.equal(await page.locator("#settings-title").innerText(), "設定");
    assert.equal(
      await page.getByRole("heading", { name: "時間割の表示" }).count(),
      1,
    );
    const dayGroup = page.locator(
      '#settings [role="group"][aria-labelledby="days-label"]',
    );
    assert.equal(await dayGroup.getByRole("button").count(), 2);
    const periodGroup = page.locator(
      '#settings [role="group"][aria-labelledby="periods-label"]',
    );
    assert.equal(await periodGroup.getByRole("button").count(), 2);
    assert.equal(
      await page.getByRole("group", { name: "表示する曜日" }).count(),
      1,
    );
    assert.equal(
      await page.getByRole("group", { name: "表示する時限" }).count(),
      1,
    );
    assert.equal(await page.getByText("5日", { exact: true }).count(), 1);
    assert.equal(await page.getByText("6限", { exact: true }).count(), 1);
    await page.keyboard.press("Escape");
    await page.locator("#settings").waitFor({ state: "detached" });
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "open-settings",
    );
    assert.equal(await page.getByText("5日", { exact: true }).count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      (await page.evaluate(() => document.documentElement.scrollWidth)) <= 390,
    );
    assert.equal(await page.locator("#timetable thead th").count(), 6);
    const lastDayHeader = await page
      .locator("#timetable thead th")
      .last()
      .evaluate((element) => element.getBoundingClientRect().right);
    assert.ok(lastDayHeader <= 390);
    await page.setViewportSize({ width: 1280, height: 720 });
    assert.equal(await page.locator("#timetable thead th").count(), 6);
    const headers = await page.locator("#timetable thead th").allTextContents();
    assert.deepEqual(headers, ["時限", "月", "火", "水", "木", "金"]);

    const dayCellWidths = await page
      .locator("#timetable tbody tr")
      .first()
      .locator("td")
      .evaluateAll((cells) =>
        cells.map((cell) => Math.round(cell.getBoundingClientRect().width)),
      );
    assert.equal(dayCellWidths.length, 5);
    assert.equal(new Set(dayCellWidths).size, 1);
    assert.equal(
      await page
        .locator("main#main-content")
        .evaluate((element) => getComputedStyle(element).overflowY),
      "visible",
    );
    assert.equal(
      await page
        .locator("#timetable-scroll")
        .evaluate((element) => getComputedStyle(element).overflowY),
      "visible",
    );
    await page.keyboard.press("Tab");
    await page.locator("#slot-1-1").focus();
    assert.equal(
      await page
        .locator("#slot-1-1")
        .evaluate((element) => getComputedStyle(element).outlineColor),
      "rgb(0, 122, 255)",
    );
    await page
      .locator("#timetable")
      .getByText("Physics I", { exact: true })
      .waitFor();
    await page
      .locator("#timetable")
      .getByText("Physics Lab", { exact: true })
      .waitFor();
    assert.match(
      await page
        .locator("#timetable button")
        .filter({ hasText: "Physics I" })
        .innerText(),
      /予定/,
    );
    assert.match(
      await page
        .locator("#timetable button")
        .filter({ hasText: "Calculus" })
        .innerText(),
      /不合格/,
    );
    await page.locator("#off-grid").getByText("Seminar S").waitFor();
    await page.locator("#open-intensive-picker").click();
    await page.locator("#add-offering-phy302-s").click();
    await page.locator("#picker").waitFor();
    assert.equal(await page.locator("#remove-picker-phy302-s").count(), 0);
    await page.locator("#close-picker").click();
    await page.locator("#picker").waitFor({ state: "detached" });
    await page.locator("#off-grid").getByText("Seminar S2").waitFor();
    await assertCreditTotal(page, "履修予定込 7単位");

    await page.locator("#open-settings").click();
    await page.locator("#settings").waitFor();
    await page.locator("#add-day").click();
    await page.getByText("6日", { exact: true }).waitFor();
    await page.locator("#add-period").click();
    await page.getByText("7限", { exact: true }).waitFor();
    await page.locator("#close-settings").click();
    await page.locator("#settings").waitFor({ state: "detached" });
    assert.equal(await page.locator("#timetable thead th").count(), 7);
    assert.equal(
      await page.locator("#timetable thead th").last().textContent(),
      "土",
    );
    assert.equal(await page.locator("#timetable tbody tr").count(), 7);

    await page.locator("#term-S2").click();
    assert.equal(await page.locator("#picker").count(), 0);
    await page.locator("#open-catalogue-picker").click();
    await page.locator("#picker").waitFor();
    await page.locator("#picker").getByText("Physics II").waitFor();
    const enrolledBadgeXs = await page
      .locator("#picker")
      .getByText("登録済み")
      .evaluateAll((badges) =>
        badges.map((badge) => Math.round(badge.getBoundingClientRect().x)),
      );
    assert.ok(enrolledBadgeXs.length >= 2);
    assert.equal(new Set(enrolledBadgeXs).size, 1);
    await page.locator("#catalogue-search").fill("Physics");
    await page.locator("#close-picker").click();
    await page.locator("#picker").waitFor({ state: "detached" });
    assert.equal(
      await page.locator("#slot-1-2").getByText("+", { exact: true }).count(),
      0,
    );
    await page.locator("#slot-1-2").click();
    await page.locator("#picker").waitFor();
    await page.waitForFunction(
      () => document.activeElement?.id === "catalogue-search",
    );
    assert.deepEqual(await auditAccessibility(page), []);
    assert.equal(await page.locator("#picker-backdrop").count(), 1);
    assert.equal(await page.locator("#picker").getAttribute("role"), "dialog");
    assert.equal(
      await page.locator("#picker").getAttribute("aria-modal"),
      "true",
    );
    assert.equal(
      await page.locator("#picker").getAttribute("aria-labelledby"),
      "picker-title",
    );
    assert.equal(
      await page.getByRole("textbox", { name: "科目名で検索" }).count(),
      1,
    );
    assert.equal(
      await page.getByRole("button", { name: /火2限に科目を追加/ }).count(),
      1,
    );
    assert.equal(
      await page.locator('#timetable thead th[scope="col"]').count(),
      7,
    );
    assert.ok(
      (await page.locator('#timetable tbody th[scope="row"]').count()) >= 6,
    );
    assert.equal(await page.locator("main#main-content").count(), 1);
    assert.equal(
      await page
        .locator("body")
        .evaluate((body) => getComputedStyle(body).overflow),
      "hidden",
    );
    assert.equal(await page.locator("#catalogue-search").inputValue(), "");
    await page.locator("#open-custom-course").focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "close-picker",
    );

    await page.keyboard.press("Escape");
    await page.locator("#picker").waitFor({ state: "detached" });
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "slot-1-2",
    );
    await page.locator("#slot-1-2").click();
    await page.locator("#picker").waitFor();
    await page.locator("#picker-backdrop").click({ position: { x: 5, y: 5 } });
    await page.locator("#picker").waitFor({ state: "detached" });
    await page.locator("#slot-1-2").click();
    await page.locator("#picker").waitFor();

    const pickerText = await page.locator("#picker").innerText();
    assert.ok(pickerText.includes("S2"));
    assert.ok(!pickerText.includes("通常"));
    await page.locator("#catalogue-search").fill("missing");
    await page.getByText("該当する科目がありません").waitFor();
    await page.locator("#catalogue-search").fill("");
    await page.locator("#close-picker").click();
    await page.locator("#picker").waitFor({ state: "detached" });
    await page.locator("#slot-1-2").click();
    await page.locator("#add-offering-phy102-s2").waitFor();
    const addStyle = await page
      .locator("#add-offering-phy102-s2")
      .evaluate((element) => ({
        color: getComputedStyle(element).color,
        height: element.getBoundingClientRect().height,
      }));
    assert.equal(addStyle.color, "rgb(0, 98, 204)");
    assert.ok(addStyle.height >= 40);
    await page.locator("#add-offering-phy102-s2").click();
    await page.locator("#picker").waitFor({ state: "detached" });
    await page
      .locator("#timetable")
      .getByText("Physics II", { exact: true })
      .waitFor();
    await assertCreditTotal(page, "履修予定込 9単位");
    await page
      .locator("#timetable")
      .getByText("Physics II", { exact: true })
      .click();
    await page.locator("#course-detail-dialog").waitFor();
    assert.deepEqual(await auditAccessibility(page), []);
    assert.match(
      await page.locator("#course-detail-dialog").innerText(),
      /2単位 · 区分 基礎物理 · S2 · 火2/,
    );
    assert.equal(
      await page.locator("#status-planned").getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page.locator("#course-detail-dialog").getAttribute("role"),
      "dialog",
    );
    assert.equal(
      await page.locator("#course-detail-dialog").getAttribute("aria-modal"),
      "true",
    );
    assert.equal(
      await page
        .locator("body")
        .evaluate((body) => getComputedStyle(body).overflow),
      "hidden",
    );
    assert.equal(await page.locator("#close-detail").count(), 1);
    await page.locator("#close-detail").focus();
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "remove-detail",
    );
    await page.keyboard.press("Escape");
    await page.locator("#course-detail-dialog").waitFor({ state: "detached" });
    assert.match(
      await page.evaluate(() => document.activeElement?.id),
      /^open-detail-phy102-s2/,
    );
    await page.keyboard.press("Enter");
    await page.locator("#course-detail-dialog").waitFor();
    await page.locator("#remove-detail").click();
    await page.locator("#course-detail-dialog").waitFor({ state: "detached" });
    await assertCreditTotal(page, "履修予定込 7単位");

    await page.locator("#open-catalogue-picker").click();
    await page.locator("#picker").waitFor();
    const addButton = page.locator("#add-offering-phy102-s2");
    const addBox = await addButton.boundingBox();
    assert.ok(addBox);
    await page.mouse.dblclick(
      addBox.x + addBox.width / 2,
      addBox.y + addBox.height / 2,
    );
    await addButton.waitFor({ state: "detached" });
    assert.equal(await addButton.count(), 0);
    await assertCreditTotal(page, "履修予定込 9単位");
    await page.locator("#close-picker").click();
    await page.locator("#picker").waitFor({ state: "detached" });
    assert.equal(
      await page
        .locator("#timetable")
        .getByText("Physics II", { exact: true })
        .count(),
      1,
    );

    await page.locator("#term-A1").click();
    await page.locator("#off-grid").getByText("Seminar A").waitFor();
    await page
      .locator("#timetable")
      .getByText("Physics Lab", { exact: true })
      .waitFor();

    await page.locator("#off-grid").getByText("Winter Workshop").waitFor();
    await page.locator("#off-grid").getByText("Winter Workshop").click();
    await page.locator("#course-detail-dialog").waitFor();
    assert.match(
      await page.locator("#course-detail-dialog").innerText(),
      /1単位 · 区分 演習 · 集中 W · 曜限なし/,
    );
    assert.equal(
      await page.locator("#status-planned").getAttribute("aria-pressed"),
      "true",
    );
    await page.locator("#remove-detail").click();
    await page.locator("#course-detail-dialog").waitFor({ state: "detached" });
    await page.getByText("Wの集中講義はありません").waitFor();
    await page.locator("#open-intensive-picker").click();
    await page.locator("#add-offering-phy501-w").click();
    await page.locator("#picker").waitFor();
    assert.equal(await page.locator("#remove-picker-phy501-w").count(), 0);
    await page.locator("#close-picker").click();
    await page.locator("#picker").waitFor({ state: "detached" });
    await page.locator("#off-grid").getByText("Winter Workshop").waitFor();

    await page.locator("#term-S1").click();
    await page
      .locator("#timetable")
      .getByText("Physics I", { exact: true })
      .click();
    await page.locator("#course-detail-dialog").waitFor();
    assert.match(
      await page.locator("#course-detail-dialog").innerText(),
      /2単位 · 区分 基礎物理 · S1 · 月1/,
    );
    assert.equal(
      await page.locator("#status-planned").getAttribute("aria-pressed"),
      "true",
    );
    await page.locator("#status-passed").click();
    await page.locator("#status-passed[aria-pressed='true']").waitFor();
    await page.locator("#grade-good").click();
    await page.locator("#grade-good[aria-pressed='true']").waitFor();
    assert.equal(
      await page.locator("#status-passed").getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page.locator("#grade-good").getAttribute("aria-pressed"),
      "true",
    );
    await page.locator("#close-detail").click();
    await page.locator("#course-detail-dialog").waitFor({ state: "detached" });
    assert.match(
      await page
        .locator("#timetable button")
        .filter({ hasText: "Physics I" })
        .innerText(),
      /合格/,
    );
    assert.equal(
      await page.locator("#summary-total-confirmed").innerText(),
      "2単位",
    );
    assert.match(
      await page.locator("#summary-categories").innerText(),
      /基礎物理/,
    );

    await page.locator("#term-S2").click();
    await page.locator("#open-catalogue-picker").click();
    await page.locator("#picker").waitFor();
    await page.locator("#add-offering-phy103-s2").click();
    await page.locator("#add-offering-phy103-s2").waitFor({
      state: "detached",
    });
    await page.locator("#close-picker").click();
    await page.locator("#picker").waitFor({ state: "detached" });
    await page
      .locator("#timetable")
      .getByText("Calculus", { exact: true })
      .waitFor();
    await assertCreditTotal(page, "修得済 2 ・ 履修予定込 11単位");

    await page.locator("#open-catalogue-picker").click();
    await page.locator("#picker").waitFor();
    await page.locator("#open-custom-course").click();
    await page.locator("#custom-course").waitFor();
    assert.deepEqual(await auditAccessibility(page), []);
    await page.locator("#close-custom-course").focus();
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "custom-submit",
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "close-custom-course",
    );
    await page.locator("#custom-submit").click();
    await page.locator("#custom-form-error").waitFor();
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "custom-name",
    );
    assert.equal(
      await page.locator("#custom-form-error").getAttribute("role"),
      "alert",
    );
    assert.equal(
      await page.locator("#custom-name").getAttribute("aria-invalid"),
      "true",
    );
    assert.equal(
      await page.locator("#custom-name").getAttribute("aria-describedby"),
      "custom-form-error",
    );
    assert.equal(await page.locator("#custom-course").count(), 1);
    await page.locator("#custom-name").fill("Linear Algebra");
    await page.locator("#custom-term-s1").click();
    await page.locator("#custom-term-s1[aria-pressed='true']").waitFor();
    assert.equal(
      await page.locator("#custom-term-s2").getAttribute("aria-pressed"),
      "true",
    );
    await page.locator("#custom-submit").click();
    await page.locator("#picker").waitFor();
    await page.locator("#add-offering-user-offering-1").waitFor();
    await page.locator("#add-offering-user-offering-1").click();
    await page.locator("#add-offering-user-offering-1").waitFor({
      state: "detached",
    });
    await page.locator("#close-picker").click();
    await page.locator("#picker").waitFor({ state: "detached" });
    await page
      .locator("#timetable")
      .getByText("Linear Algebra", { exact: true })
      .waitFor();
    await assertCreditTotal(page, "修得済 2 ・ 履修予定込 13単位");

    await page.locator("#open-catalogue-picker").click();
    await page.locator("#picker").waitFor();
    await page.locator("#edit-custom-user-offering-1").click();
    await page.locator("#custom-course").waitFor();
    await page.locator("#custom-name").fill("Linear Algebra II");
    await page.locator("#custom-submit").click();
    await page.locator("#picker").waitFor();
    await page.locator("#close-picker").click();
    await page.locator("#picker").waitFor({ state: "detached" });
    await page
      .locator("#timetable")
      .getByText("Linear Algebra II", { exact: true })
      .waitFor();

    await page
      .locator("#timetable")
      .getByText("Linear Algebra II", { exact: true })
      .click();
    await page.locator("#course-detail-dialog").waitFor();
    await page.locator("#remove-detail").click();
    await page.locator("#course-detail-dialog").waitFor({ state: "detached" });
    await assertCreditTotal(page, "修得済 2 ・ 履修予定込 11単位");

    await page.locator("#open-catalogue-picker").click();
    await page.locator("#picker").waitFor();
    await page.locator("#edit-custom-user-offering-1").click();
    await page.locator("#custom-course").waitFor();
    await page.locator("#delete-custom-course").click();
    await page.locator("#picker").waitFor();
    await page.locator("#close-picker").click();
    await page.locator("#picker").waitFor({ state: "detached" });
    assert.equal(
      await page
        .locator("#timetable")
        .getByText("Linear Algebra II", { exact: true })
        .count(),
      0,
    );

    await page.locator("#slot-0-3").click();
    await page.locator("#picker").waitFor();
    await page.locator("#open-custom-course").click();
    await page.locator("#custom-course").waitFor();
    await page.locator("#custom-name").fill("Slot Custom");
    await page.locator("#custom-submit").click();
    await page.locator("#picker").waitFor();
    assert.equal(
      await page.locator("#picker-title").innerText(),
      "月3限に追加",
    );
    await page.locator("#add-offering-user-offering-2").click();
    await page.locator("#add-offering-user-offering-2").waitFor({
      state: "detached",
    });
    await page
      .locator("#timetable")
      .getByText("Slot Custom", { exact: true })
      .waitFor();

    await page.locator("#open-intensive-picker").click();
    await page.locator("#picker").waitFor();
    await page.locator("#open-custom-course").click();
    await page.locator("#custom-course").waitFor();
    await page.locator("#custom-name").fill("Intensive Custom");
    await page.locator("#custom-submit").click();
    await page.locator("#picker").waitFor();
    assert.equal(
      await page.locator("#picker-title").innerText(),
      "集中講義を追加",
    );
    await page.locator("#add-offering-user-offering-3").click();
    await page.locator("#add-offering-user-offering-3").waitFor({
      state: "detached",
    });
    await page.locator("#close-picker").click();
    await page.locator("#picker").waitFor({ state: "detached" });
    await page.locator("#off-grid").getByText("Intensive Custom").waitFor();

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("#term-S2").click();
    await page
      .locator("#timetable")
      .getByText("Physics II", { exact: true })
      .click();
    await page.locator("#course-detail-dialog").waitFor();
    await page.locator("#open-override-editor").click();
    await page.locator("#override-editor").waitFor();
    assert.deepEqual(await auditAccessibility(page), []);
    await page.locator("#override-name").fill("Physics II Advanced");
    await page.locator("#override-submit").click();
    await page.locator("#course-detail-dialog").waitFor();
    assert.match(
      await page.locator("#course-detail-dialog").innerText(),
      /Physics II Advanced/,
    );
    await page.locator("#close-detail").click();
    await page.locator("#course-detail-dialog").waitFor({ state: "detached" });
    await page
      .locator("#timetable")
      .getByText("Physics II Advanced", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .locator("#timetable")
        .getByText("Physics II", { exact: true })
        .count(),
      0,
    );

    await page.locator("#open-catalogue-picker").click();
    await page.locator("#picker").waitFor();
    await page.locator("#catalogue-search").fill("Advanced");
    await page
      .locator("#picker")
      .getByText("Physics II Advanced", { exact: true })
      .waitFor();
    await page.locator("#close-picker").click();
    await page.locator("#picker").waitFor({ state: "detached" });

    await page
      .locator("#timetable")
      .getByText("Physics II Advanced", { exact: true })
      .click();
    await page.locator("#course-detail-dialog").waitFor();
    await page.locator("#open-override-editor").click();
    await page.locator("#override-editor").waitFor();
    await page.locator("#override-slots-enabled").click();
    await page
      .locator("#override-slots-enabled[aria-pressed='true']")
      .waitFor();
    assert.equal(
      await page.locator("#override-slots-enabled").innerText(),
      "曜限を上書きしない",
    );
    assert.equal(
      await page.locator("#remove-overrides").innerText(),
      "すべての上書きを解除",
    );
    assert.deepEqual(await auditAccessibility(page), []);
    assert.equal(await page.getByLabel("曜日").count(), 1);
    assert.equal(await page.getByLabel("時限").count(), 1);
    await page.locator("#override-day").selectOption("3");
    await page.locator("#override-period").selectOption("5");
    await page.locator("#override-submit").click();
    await page.locator("#course-detail-dialog").waitFor();
    await page.locator("#close-detail").click();
    await page.locator("#course-detail-dialog").waitFor({ state: "detached" });
    assert.equal(await page.locator("#slot-1-2").count(), 1);
    assert.equal(await page.locator("#slot-3-5").count(), 0);

    await page.setViewportSize({ width: 390, height: 600 });
    await page.locator("#open-settings").click();
    await page.locator("#settings").waitFor();
    await page.locator("#add-day").click();
    await page.getByText("7日", { exact: true }).waitFor();
    for (let index = 0; index < 3; index += 1) {
      await page.locator("#add-period").click();
    }
    await page.getByText("10限", { exact: true }).waitFor();
    await page.locator("#close-settings").click();
    await page.locator("#settings").waitFor({ state: "detached" });
    assert.equal(await page.locator("#timetable thead th").count(), 8);
    assert.equal(await page.locator("#timetable tbody tr").count(), 10);
    assert.ok(
      (await page.evaluate(() => document.documentElement.scrollWidth)) <= 390,
    );
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(100);
    const stickyHeader = await page
      .locator("#timetable thead th")
      .first()
      .boundingBox();
    assert.ok(stickyHeader);
    assert.ok(stickyHeader.y <= 1);
    await page.locator("#slot-0-10").focus();
    await page.waitForTimeout(100);
    const bottomCell = await page.locator("#slot-0-10").boundingBox();
    assert.ok(bottomCell);
    assert.ok(bottomCell.y >= stickyHeader.y + stickyHeader.height);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("#grade-select").selectOption("4");
    await page.waitForFunction(
      () =>
        document
          .querySelector("#term-context")
          ?.textContent?.includes("2027年度") ?? false,
    );
    assert.equal(await page.locator("#grade-select").inputValue(), "4");
    await page.locator("#grade-select").selectOption("1");
    await page.locator("#timetable").waitFor();
    assert.equal(await page.locator("#timetable").count(), 1);
    await page.locator("#slot-0-3").click();
    await page.locator("#picker").waitFor();
    await page.locator("#open-custom-course").click();
    await page.locator("#custom-course").waitFor();
    assert.equal(await page.locator("#custom-year").inputValue(), "2024");
    await page.locator("#close-custom-course").click();
    await page.locator("#picker").waitFor();
    await page.locator("#close-picker").click();
    await page.locator("#picker").waitFor({ state: "detached" });
    await page.locator("#grade-select").selectOption("4");
    await page.waitForFunction(
      () =>
        document
          .querySelector("#term-context")
          ?.textContent?.includes("2027年度") ?? false,
    );
    await page.locator("#term-S1").click();
    await page.locator("#timetable").waitFor();
    await page.locator("#open-catalogue-picker").click();
    await page.locator("#picker").waitFor();
    await page.locator("#catalogue-search").fill("Advanced Physics");
    await page.locator("#add-offering-phy601-s1").click();
    await page.locator("#close-picker").click();
    await page.locator("#picker").waitFor({ state: "detached" });
    await page
      .locator("#timetable")
      .getByText("Advanced Physics", { exact: true })
      .waitFor();
    await page.locator("#grade-select").selectOption("3");
    await page.waitForFunction(
      () =>
        document
          .querySelector("#term-context")
          ?.textContent?.includes("2026年度") ?? false,
    );
    assert.equal(
      await page
        .locator("#timetable")
        .getByText("Advanced Physics", { exact: true })
        .count(),
      0,
    );

    await page
      .locator("#timetable")
      .getByText("Physics Lab", { exact: true })
      .click();
    await page.locator("#course-detail-dialog").waitFor();
    await page.locator("#remove-detail").click();
    await page.locator("#course-detail-dialog").waitFor({ state: "detached" });
    await page.locator("#undo-removal").waitFor();
    assert.equal(
      await page.locator("#undo-removal").getAttribute("role"),
      "status",
    );
    assert.equal(
      await page
        .locator("#timetable")
        .getByText("Physics Lab", { exact: true })
        .count(),
      0,
    );
    await page.locator("#undo-removal-button").click();
    await page.locator("#undo-removal").waitFor({ state: "detached" });
    await page
      .locator("#timetable")
      .getByText("Physics Lab", { exact: true })
      .waitFor();
    assert.match(
      await page.evaluate(() => document.activeElement?.id ?? ""),
      /^open-detail-phy201-year-/,
    );

    await page
      .locator("#timetable")
      .getByText("Physics I", { exact: true })
      .click();
    await page.locator("#course-detail-dialog").waitFor();
    await page.locator("#open-override-editor").click();
    await page.locator("#override-editor").waitFor();
    await page.locator("#override-passed-note").waitFor();
    await page.locator("#override-name").fill("Physics I Override");
    await page.locator("#override-slots-enabled").click();
    await page.locator("#override-day").selectOption("1");
    await page.locator("#override-period").selectOption("4");
    await page.locator("#override-submit").click();
    await page.locator("#course-detail-dialog").waitFor();
    assert.equal(
      await page.locator("#course-detail-title").innerText(),
      "Physics I",
    );
    assert.match(
      await page.locator("#course-detail-dialog").innerText(),
      /月1/,
    );
    await page.locator("#close-detail").click();
    await page.locator("#course-detail-dialog").waitFor({ state: "detached" });
    assert.equal(
      await page
        .locator("#timetable")
        .getByText("Physics I", { exact: true })
        .count(),
      1,
    );
    assert.equal(
      await page
        .locator("#timetable")
        .getByText("Physics I Override", { exact: true })
        .count(),
      0,
    );

    await page.evaluate(() => {
      const modal = document.createElement("section");
      modal.id = "synthetic-modal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-labelledby", "synthetic-title");
      modal.innerHTML =
        '<h2 id="synthetic-title">Synthetic dialog</h2><button id="synthetic-close" data-dialog-close="true">完了</button>';
      modal
        .querySelector("#synthetic-close")
        .addEventListener("click", () => modal.remove());
      document.querySelector("#app").append(modal);
    });
    await page.waitForFunction(
      () => document.activeElement?.id === "synthetic-close",
    );
    assert.equal(
      await page
        .locator("body")
        .evaluate((body) => getComputedStyle(body).overflow),
      "hidden",
    );
    await page.keyboard.press("Escape");
    await page.locator("#synthetic-modal").waitFor({ state: "detached" });
    assert.notEqual(
      await page
        .locator("body")
        .evaluate((body) => getComputedStyle(body).overflow),
      "hidden",
    );

    assert.deepEqual(errors, []);
  },
);

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
