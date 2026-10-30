import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
]);

export function startStaticServer(root) {
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

export async function auditAccessibility(page) {
  return page.evaluate(() => {
    const issues = [];
    if (document.querySelectorAll("main").length !== 1) {
      issues.push("page must have exactly one main landmark");
    }
    if (!document.querySelector('a[href="#main-content"]')) {
      issues.push("page must have a skip link");
    }
    for (const header of document.querySelectorAll("th")) {
      if (!header.getAttribute("scope")) {
        issues.push(`table header missing scope: ${header.textContent}`);
      }
    }
    for (const control of document.querySelectorAll(
      "input, select, textarea",
    )) {
      const hasLabel = control.labels && control.labels.length > 0;
      if (!hasLabel && !control.getAttribute("aria-label")) {
        issues.push(`form control missing label: ${control.id}`);
      }
    }
    for (const button of document.querySelectorAll("button")) {
      const hasText = button.textContent.trim().length > 0;
      const hasName =
        button.getAttribute("aria-label") || button.getAttribute("title");
      if (!hasText && !hasName) {
        issues.push(`unnamed button: ${button.id}`);
      }
    }
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      if (dialog.getAttribute("aria-modal") !== "true") {
        issues.push(`dialog missing aria-modal: ${dialog.id}`);
      }
      const labelledBy = dialog.getAttribute("aria-labelledby");
      if (!labelledBy || !document.getElementById(labelledBy)) {
        issues.push(`dialog missing labelled heading: ${dialog.id}`);
      }
    }
    return issues;
  });
}

export async function assertCreditTotal(page, expected) {
  await page.waitForFunction(
    (value) =>
      document.querySelector("#credit-total")?.textContent.includes(value),
    expected,
  );
}

export async function assertSummaryTotals(
  page,
  confirmedText,
  standardText,
  optimisticText,
) {
  await page.waitForFunction(
    ([confirmed, standard, optimistic]) =>
      document.querySelector("#summary-total-confirmed")?.textContent ===
        confirmed &&
      document.querySelector("#summary-total-standard")?.textContent ===
        standard &&
      document.querySelector("#summary-total-optimistic")?.textContent ===
        optimistic,
    [confirmedText, standardText, optimisticText],
  );
  assert.equal(
    await page.locator("#summary-total-confirmed").innerText(),
    confirmedText,
  );
  assert.equal(
    await page.locator("#summary-total-standard").innerText(),
    standardText,
  );
  assert.equal(
    await page.locator("#summary-total-optimistic").innerText(),
    optimisticText,
  );
}

export async function runJourney(browser, name, drive) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await drive(page, errors);
    await context.tracing.stop();
  } catch (error) {
    const evidenceDir = ".cache/verify";
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({
      path: `${evidenceDir}/${name}-failure.png`,
      fullPage: true,
    });
    await context.tracing.stop({
      path: `${evidenceDir}/${name}-failure-trace.zip`,
    });
    throw error;
  } finally {
    await context.close();
  }
}

export async function waitForPersistence(page, status = "保存済み") {
  const deadline = Date.now() + 10_000;
  let observed = "absent";
  while (Date.now() < deadline) {
    observed = await page.evaluate(
      () =>
        document.querySelector("#persistence-status")?.textContent ?? "absent",
    );
    if (observed === status) return;
    await page.waitForTimeout(100);
  }
  assert.fail(`expected persistence status ${status}, saw ${observed}`);
}
