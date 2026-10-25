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
    await page
      .locator("#timetable")
      .getByText("Physics I", { exact: true })
      .waitFor();
    await page
      .locator("#timetable")
      .getByText("Physics Lab", { exact: true })
      .waitFor();
    await page.locator("#off-grid").getByText("Seminar S").waitFor();

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
    await page.locator("#slot-1-2").click();
    await page.locator("#picker").waitFor();
    await page.locator("#catalogue-search").fill("missing");
    await page.getByText("該当する科目がありません").waitFor();
    await page.locator("#catalogue-search").fill("");
    await page.locator("#close-picker").click();
    await page.locator("#picker").waitFor({ state: "detached" });
    await page.locator("#slot-1-2").click();
    await page.locator("#add-offering-phy102-s2").waitFor();
    await page.locator("#add-offering-phy102-s2").click();
    await page
      .locator("#timetable")
      .getByText("Physics II", { exact: true })
      .waitFor();
    await page.locator("#enrolled-phy102-s2").waitFor();
    await page
      .locator('#timetable button[id^="remove-phy102-s2"]')
      .first()
      .click();
    await page.locator("#slot-1-2").click();
    await page.locator("#add-offering-phy102-s2").waitFor();
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
    await page.locator("#remove-phy501-w").click();
    await page.getByText("集中講義はありません").waitFor();
    await page.locator("#open-intensive-picker").click();
    await page.locator("#add-offering-phy501-w").click();
    await page.locator("#off-grid").getByText("Winter Workshop").waitFor();

    assert.deepEqual(errors, []);
  },
);
