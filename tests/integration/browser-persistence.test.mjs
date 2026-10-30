import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  runJourney,
  startStaticServer,
  waitForPersistence,
} from "./planner-harness.mjs";

const dist = resolve(process.env.TANIKUN_WEB_DIST ?? "apps/web/dist");
const core = process.env.PLAYWRIGHT_CORE;
assert.ok(core, "run this test in `nix develop` so PLAYWRIGHT_CORE is set");
const { chromium } = await import(pathToFileURL(join(core, "index.mjs")).href);

async function saveInvalidDocument(page) {
  await page.evaluate(
    () =>
      new Promise((finish, reject) => {
        const request = indexedDB.open("tanikun-planner", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("documents", "readwrite");
          transaction.objectStore("documents").put("{broken", "planner");
          transaction.oncomplete = () => {
            database.close();
            finish();
          };
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        };
      }),
  );
}

test("local persistence restores edits after reload", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((done) => server.close(done)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  await runJourney(browser, "persistence-reload", async (page, errors) => {
    await page.goto(origin);
    await waitForPersistence(page);
    await page.locator("#open-catalogue-picker").click();
    await page.locator("#add-offering-phy302-s").click();
    await page.locator("#close-picker").click();
    await waitForPersistence(page);
    assert.match(await page.locator("#off-grid").innerText(), /Seminar S2/);
    await page.reload();
    await waitForPersistence(page);
    assert.match(await page.locator("#off-grid").innerText(), /Seminar S2/);
    assert.deepEqual(errors, []);
  });
});

test("corrupt local data is reported without discarding the seed", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((done) => server.close(done)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  await runJourney(browser, "persistence-corrupt", async (page, errors) => {
    await page.goto(origin);
    await waitForPersistence(page);
    await saveInvalidDocument(page);
    await page.reload();
    await waitForPersistence(page, "読み込み失敗");
    assert.match(
      await page.locator("#planner-error").innerText(),
      /保存データを読み込めません/,
    );
    assert.match(await page.locator("#timetable").innerText(), /Physics I/);
    assert.deepEqual(errors, []);
  });
});

test("save failures keep the edit visible and report the failure", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((done) => server.close(done)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  await runJourney(
    browser,
    "persistence-save-failure",
    async (page, errors) => {
      await page.goto(origin);
      await waitForPersistence(page);
      await page.evaluate(() => {
        globalThis["tanikunStorage"].save = () =>
          Promise.reject(new Error("quota exceeded"));
      });
      await page.locator("#open-catalogue-picker").click();
      await page.locator("#add-offering-phy302-s").click();
      await page.locator("#close-picker").click();
      await waitForPersistence(page, "保存失敗");
      assert.match(await page.locator("#off-grid").innerText(), /Seminar S2/);
      assert.deepEqual(errors, []);
    },
  );
});

test("unsaved is visible while a source edit is queued", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((done) => server.close(done)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  await runJourney(browser, "persistence-unsaved", async (page, errors) => {
    await page.goto(origin);
    await waitForPersistence(page);
    await page.evaluate(() => {
      const labels = [];
      globalThis["persistenceLabels"] = labels;
      const target = document.querySelector("#persistence-status");
      new MutationObserver(() => labels.push(target.textContent)).observe(
        target,
        { childList: true, characterData: true, subtree: true },
      );
      const save = globalThis["tanikunStorage"].save;
      globalThis["tanikunStorage"].save = (text) =>
        new Promise((finish) => setTimeout(finish, 300)).then(() => save(text));
    });
    await page.locator("#open-catalogue-picker").click();
    await page.locator("#add-offering-phy302-s").click();
    await page.locator("#close-picker").click();
    await waitForPersistence(page);
    const labels = await page.evaluate(() => globalThis["persistenceLabels"]);
    assert.ok(labels.includes("未保存"));
    assert.ok(labels.includes("保存中"));
    assert.deepEqual(errors, []);
  });
});

test("UI-only changes do not write the planner document", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((done) => server.close(done)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  await runJourney(browser, "persistence-ui-only", async (page, errors) => {
    await page.goto(origin);
    await waitForPersistence(page);
    await page.evaluate(() => {
      globalThis["persistenceSaves"] = 0;
      const save = globalThis["tanikunStorage"].save;
      globalThis["tanikunStorage"].save = (text) => {
        globalThis["persistenceSaves"] += 1;
        return save(text);
      };
    });
    await page.locator("#open-catalogue-picker").click();
    await page.locator("#catalogue-search").fill("Physics");
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => globalThis["persistenceSaves"]), 0);
    assert.deepEqual(errors, []);
  });
});
