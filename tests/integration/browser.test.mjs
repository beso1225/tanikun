import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const dist = resolve(process.env.TANIKUN_WEB_DIST ?? "apps/web/dist");
const core = process.env.PLAYWRIGHT_CORE;
assert.ok(core, "run this test in `nix develop` so PLAYWRIGHT_CORE is set");
const { chromium } = await import(pathToFileURL(join(core, "index.mjs")).href);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
]);

function startStaticServer(root) {
  const server = createServer(async (request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url, "http://127.0.0.1").pathname,
      );
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (pathname === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    const relative =
      pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = resolve(root, relative);
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, {
        "Content-Type":
          contentTypes.get(extname(file)) ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolvePromise({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

test(
  "built page renders the five-term planner and resizes",
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

    assert.equal(await page.locator("nav button").count(), 5);
    assert.equal(await page.locator("#term-S1").count(), 1);
    assert.equal(await page.locator("#term-S2").count(), 1);
    assert.equal(await page.locator("#term-A1").count(), 1);
    assert.equal(await page.locator("#term-A2").count(), 1);
    assert.equal(await page.locator("#term-W").count(), 1);

    assert.equal(await page.getByText("5日", { exact: true }).count(), 1);
    assert.equal(await page.getByText("6限", { exact: true }).count(), 1);
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
    await page.locator("#off-grid").getByText("Seminar S").waitFor();
    await page.locator("#open-intensive-picker").click();
    await page.locator("#add-offering-phy302-s").click();
    await page.locator("#picker").waitFor();
    await page.locator("#remove-picker-phy302-s").waitFor();
    await page.locator("#close-picker").click();
    await page.locator("#picker").waitFor({ state: "detached" });
    await page.locator("#off-grid").getByText("Seminar S2").waitFor();

    await page.locator("#add-day").click();
    await page.getByText("6日", { exact: true }).waitFor();
    assert.equal(await page.locator("#timetable thead th").count(), 7);
    assert.equal(
      await page.locator("#timetable thead th").last().textContent(),
      "土",
    );

    await page.locator("#add-period").click();
    await page.getByText("7限", { exact: true }).waitFor();
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
    await page.locator("#add-offering-phy102-s2").focus();
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
    assert.equal(addStyle.color, "rgb(0, 122, 255)");
    assert.ok(addStyle.height >= 40);
    await page.locator("#add-offering-phy102-s2").click();
    await page.locator("#picker").waitFor({ state: "detached" });
    await page
      .locator("#timetable")
      .getByText("Physics II", { exact: true })
      .waitFor();
    await page
      .locator("#timetable")
      .getByText("Physics II", { exact: true })
      .click();
    await page.locator("#course-detail-dialog").waitFor();
    assert.equal(
      await page.locator("#course-detail-dialog").getAttribute("role"),
      "dialog",
    );
    assert.equal(
      await page.locator("#course-detail-dialog").getAttribute("aria-modal"),
      "true",
    );
    await page.locator("#remove-detail").click();
    await page.locator("#course-detail-dialog").waitFor({ state: "detached" });

    await page.locator("#open-catalogue-picker").click();
    await page.locator("#picker").waitFor();
    await page.locator("#add-offering-phy102-s2").click();
    await page.locator("#picker").waitFor();
    await page.locator("#remove-picker-phy102-s2").waitFor();
    await page.locator("#remove-picker-phy102-s2").click();
    await page.locator("#add-offering-phy102-s2").waitFor();
    await page.locator("#close-picker").click();
    await page.locator("#picker").waitFor({ state: "detached" });
    assert.equal(
      await page
        .locator("#timetable")
        .getByText("Physics II", { exact: true })
        .count(),
      0,
    );

    await page.locator("#term-A1").click();
    await page.locator("#off-grid").getByText("Seminar A").waitFor();
    await page
      .locator("#timetable")
      .getByText("Physics Lab", { exact: true })
      .waitFor();

    await page.locator("#term-W").click();
    await page
      .getByText("Wでは時間割のグリッドを使いません", { exact: true })
      .waitFor();
    assert.equal(await page.locator("#timetable").count(), 0);
    await page.locator("#off-grid").getByText("Winter Workshop").waitFor();
    await page.locator("#off-grid").getByText("Winter Workshop").click();
    await page.locator("#course-detail-dialog").waitFor();
    await page.locator("#remove-detail").click();
    await page.locator("#course-detail-dialog").waitFor({ state: "detached" });
    await page.getByText("集中講義はありません").waitFor();
    await page.locator("#open-intensive-picker").click();
    await page.locator("#add-offering-phy501-w").click();
    await page.locator("#picker").waitFor();
    await page.locator("#remove-picker-phy501-w").waitFor();
    await page.locator("#remove-picker-phy501-w").click();
    await page.locator("#add-offering-phy501-w").waitFor();
    await page.locator("#close-picker").click();
    await page.locator("#picker").waitFor({ state: "detached" });
    await page.getByText("集中講義はありません").waitFor();

    assert.deepEqual(errors, []);
  },
);
