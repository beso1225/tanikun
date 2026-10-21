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
  "built page renders the counter and Tailwind styles",
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

    assert.equal(await page.getByRole("button").count(), 2);
    await page.getByText("カウント: 0", { exact: true }).waitFor();

    const controls = page.locator("div.mt-6");
    assert.deepEqual(
      await controls.evaluate((element) => {
        const style = getComputedStyle(element);
        return { display: style.display, gap: style.gap };
      }),
      { display: "flex", gap: "12px" },
    );
    assert.equal(
      await page
        .locator("body")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      "rgb(246, 248, 244)",
    );

    await page.getByRole("button", { name: "増やす" }).click();
    await page.getByText("カウント: 1", { exact: true }).waitFor();
    await page.getByRole("button", { name: "リセット" }).click();
    await page.getByText("カウント: 0", { exact: true }).waitFor();

    assert.deepEqual(errors, []);
  },
);
