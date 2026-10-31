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
    await page.reload();
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

test("quick undo wins over a pending removed document", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((done) => server.close(done)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  await runJourney(browser, "persistence-quick-undo", async (page, errors) => {
    await page.goto(origin);
    await waitForPersistence(page);
    await page.evaluate(() => {
      const save = globalThis["tanikunStorage"].save;
      globalThis["tanikunStorage"].save = (text) =>
        new Promise((finish) => setTimeout(finish, 800)).then(() => save(text));
    });
    await page
      .locator("#timetable")
      .getByText("Physics I", { exact: true })
      .click();
    await page.locator("#remove-detail").click();
    await page.locator("#undo-removal-button").click();
    await waitForPersistence(page);
    await page.reload();
    await waitForPersistence(page);
    assert.equal(
      await page
        .locator("#timetable")
        .getByText("Physics I", { exact: true })
        .count(),
      1,
    );
    assert.deepEqual(errors, []);
  });
});

test("a load failure does not overwrite the stored document", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((done) => server.close(done)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  await runJourney(
    browser,
    "persistence-load-failure",
    async (page, errors) => {
      await page.goto(origin);
      await waitForPersistence(page);
      await saveInvalidDocument(page);
      await page.reload();
      await waitForPersistence(page, "読み込み失敗");
      await page.locator("#open-catalogue-picker").click();
      await page.locator("#add-offering-phy302-s").click();
      await page.locator("#close-picker").click();
      const stored = await page.evaluate(
        () =>
          new Promise((finish, reject) => {
            const request = indexedDB.open("tanikun-planner", 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const database = request.result;
              const transaction = database.transaction("documents", "readonly");
              const get = transaction.objectStore("documents").get("planner");
              transaction.oncomplete = () => {
                database.close();
                finish(get.result);
              };
              transaction.onerror = () => reject(transaction.error);
              transaction.onabort = () => reject(transaction.error);
            };
          }),
      );
      assert.equal(stored, "{broken");
      const warning = page.locator("#storage-readonly-warning");
      await warning.waitFor();
      const desktopBox = await warning.boundingBox();
      assert.ok(desktopBox);
      assert.ok(
        desktopBox.y < (await page.evaluate(() => innerHeight)),
        "load warning must be above the fold",
      );
      await page.setViewportSize({ width: 390, height: 844 });
      const phoneBox = await warning.boundingBox();
      assert.ok(phoneBox);
      assert.ok(
        phoneBox.y < (await page.evaluate(() => innerHeight)),
        "load warning must be above the fold on phone",
      );
      await page.locator("#discard-storage-button").click();
      await waitForPersistence(page);
      const recovered = await page.evaluate(
        () =>
          new Promise((finish, reject) => {
            const request = indexedDB.open("tanikun-planner", 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const database = request.result;
              const transaction = database.transaction("documents", "readonly");
              const get = transaction.objectStore("documents").get("planner");
              transaction.oncomplete = () => {
                database.close();
                finish(get.result);
              };
              transaction.onerror = () => reject(transaction.error);
              transaction.onabort = () => reject(transaction.error);
            };
          }),
      );
      assert.notEqual(recovered, "{broken");
      assert.equal(recovered.storageVersion, 2);
      assert.ok(recovered.bytes instanceof Uint8Array);
      await page.reload();
      await waitForPersistence(page);
      assert.match(await page.locator("#off-grid").innerText(), /Seminar S2/);
      assert.deepEqual(errors, []);
    },
  );
});

async function storedValue(page, value) {
  return page.evaluate(
    (replacement) =>
      new Promise((finish, reject) => {
        if (replacement?.storageVersion === 2)
          replacement.bytes = new Uint8Array(replacement.bytes);
        const opening = indexedDB.open("tanikun-planner", 1);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const tx = db.transaction(
            "documents",
            replacement === null ? "readonly" : "readwrite",
          );
          const store = tx.objectStore("documents");
          const request =
            replacement === null
              ? store.get("planner")
              : store.put(replacement, "planner");
          tx.oncomplete = () => {
            db.close();
            const result = request.result;
            finish(
              result?.storageVersion === 2
                ? { ...result, bytes: Array.from(result.bytes) }
                : result,
            );
          };
          tx.onabort = tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    value ?? null,
  );
}

async function sourceText(page) {
  return page.evaluate(() => globalThis.tanikunStorage.load());
}

async function changes(page) {
  return page.evaluate(() =>
    globalThis.tanikunStorage.changes().map((bytes) => Array.from(bytes)),
  );
}

async function merge(page, batch) {
  return page.evaluate(
    (incoming) =>
      globalThis.tanikunStorage.merge(
        incoming.map((bytes) => new Uint8Array(bytes)),
      ),
    batch,
  );
}

test("isolated replicas retain offline edits across reload and converge", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((done) => server.close(done)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const leftContext = await browser.newContext();
  const rightContext = await browser.newContext();
  const left = await leftContext.newPage();
  const right = await rightContext.newPage();
  const errors = [];
  for (const page of [left, right])
    page.on("pageerror", (error) => errors.push(error.message));
  await left.goto(origin);
  await right.goto(origin);
  await waitForPersistence(left);
  await waitForPersistence(right);
  await left
    .locator("#timetable")
    .getByText("Physics I", { exact: true })
    .click();
  await left.locator("#status-passed").click();
  await left.locator("#grade-good").click();
  await left.locator("#open-override-editor").click();
  await left.locator("#override-name").fill("Fictional revision");
  await left.locator("#override-submit").click();
  await left.locator("#close-detail").click();
  await left.locator("#open-catalogue-picker").click();
  await left.locator("#open-custom-course").click();
  await left.locator("#custom-name").fill("Fictional custom course");
  await left.locator("#custom-category").selectOption("lab");
  await left.locator("#custom-submit").click();
  await left.locator("#close-picker").click();
  await waitForPersistence(left);
  const baseline = JSON.parse(await sourceText(left));
  const passed = baseline.enrollments.find((row) => row.status === "passed");
  assert.ok(passed);
  assert.equal(passed.passing_grade, "good");
  assert.equal(passed.snapshot.name, "Physics I");
  const common = await storedValue(left);
  // Adopt a common history before branching, as required for an Automerge fork.
  await storedValue(right, common);
  await right.reload();
  await waitForPersistence(right);
  for (const context of [leftContext, rightContext])
    await context.setOffline(true);
  await left.locator("#open-catalogue-picker").click();
  await left.locator("#add-offering-phy302-s").click();
  await left.locator("#close-picker").click();
  await right
    .locator("#timetable")
    .getByText("Physics Lab", { exact: true })
    .click();
  await right.locator("#remove-detail").click();
  for (const [page, name] of [
    [left, "Left custom"],
    [right, "Right custom"],
  ]) {
    await page.locator("#open-catalogue-picker").click();
    await page.locator("#open-custom-course").click();
    await page.locator("#custom-name").fill(name);
    await page.locator("#custom-category").selectOption("lab");
    await page.locator("#custom-submit").click();
    await page.locator("#close-picker").click();
  }
  await waitForPersistence(left);
  await waitForPersistence(right);
  // Only the static application is served on reload; storage and peer exchange
  // never use the network. No peer changes have been delivered yet.
  for (const context of [leftContext, rightContext])
    await context.setOffline(false);
  await left.reload();
  await right.reload();
  await waitForPersistence(left);
  await waitForPersistence(right);
  assert.match(await left.locator("#off-grid").innerText(), /Seminar S2/);
  assert.equal(
    await right
      .locator("#timetable")
      .getByText("Physics Lab", { exact: true })
      .count(),
    0,
  );
  const leftChanges = await changes(left);
  const rightChanges = await changes(right);
  await merge(left, rightChanges);
  await merge(right, leftChanges);
  assert.deepEqual(
    JSON.parse(await sourceText(left)),
    JSON.parse(await sourceText(right)),
  );
  const converged = JSON.parse(await sourceText(left));
  assert.deepEqual(
    converged.enrollments.find((row) => row.status === "passed"),
    passed,
  );
  assert.deepEqual(converged.overrides, baseline.overrides);
  assert.equal(
    converged.custom_course_ids.length,
    baseline.custom_course_ids.length + 2,
  );
  for (const field of [
    "custom_categories",
    "custom_course_ids",
    "catalogue",
    "offerings",
  ]) {
    for (const record of baseline[field])
      assert.ok(
        converged[field].some(
          (row) => JSON.stringify(row) === JSON.stringify(record),
        ),
      );
  }
  assert.ok(converged.catalogue.some((row) => row.name === "Left custom"));
  assert.ok(converged.catalogue.some((row) => row.name === "Right custom"));
  await merge(left, rightChanges); // Redelivery is idempotent.
  for (const page of [left, right]) {
    await page.reload();
    await waitForPersistence(page);
    assert.match(await page.locator("#off-grid").innerText(), /Seminar S2/);
    assert.equal(
      await page
        .locator("#timetable")
        .getByText("Physics Lab", { exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .locator("#timetable")
        .getByText("Physics I", { exact: true })
        .count(),
      1,
    );
  }
  assert.deepEqual(errors, []);
});

test("legacy JSON migrates on the next edit without changing source state", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((done) => server.close(done)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  await runJourney(browser, "persistence-migration", async (page, errors) => {
    await page.goto(origin);
    await waitForPersistence(page);
    const original = JSON.parse(await sourceText(page));
    await storedValue(page, JSON.stringify(original));
    await page.reload();
    await waitForPersistence(page);
    assert.deepEqual(JSON.parse(await sourceText(page)), original);
    await page.locator("#term-S2").click();
    await waitForPersistence(page);
    assert.equal((await storedValue(page)).storageVersion, 2);
    await page.reload();
    await waitForPersistence(page);
    assert.deepEqual(JSON.parse(await sourceText(page)), {
      ...original,
      selected_term: "S2",
    });
    assert.deepEqual(errors, []);
  });
});

test("unsupported storage and aborted writes preserve the last committed plan", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((done) => server.close(done)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  await runJourney(browser, "persistence-abort", async (page, errors) => {
    await page.goto(origin);
    await waitForPersistence(page);
    const original = JSON.parse(await sourceText(page));
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        const request = put.apply(this, args);
        this.transaction.abort();
        IDBObjectStore.prototype.put = put;
        return request;
      };
    });
    await page.locator("#term-S2").click();
    await waitForPersistence(page, "保存失敗");
    await page.reload();
    await waitForPersistence(page);
    assert.deepEqual(JSON.parse(await sourceText(page)), original);
    const future = { storageVersion: 999, bytes: [1, 2, 3] };
    await storedValue(page, future);
    await page.reload();
    await waitForPersistence(page, "読み込み失敗");
    assert.deepEqual(await storedValue(page), future);
    assert.deepEqual(errors, []);
  });
});

test("invalid peer changes never replace the committed document", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((done) => server.close(done)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  await runJourney(
    browser,
    "persistence-invalid-merge",
    async (page, errors) => {
      await page.goto(origin);
      await waitForPersistence(page);
      const original = await storedValue(page);
      const result = await page.evaluate(async () => {
        const storage = globalThis.tanikunStorage;
        const A = globalThis.Automerge;
        const base = A.applyChanges(A.init(), storage.changes())[0];
        const invalid = A.change(A.clone(base), (draft) => {
          draft.fields.program_id = new A.ImmutableString(
            JSON.stringify("missing-program"),
          );
        });
        const incomplete = globalThis.tanikunDocument.update(
          null,
          await storage.load(),
        );
        const failures = [];
        for (const batch of [
          A.getAllChanges(invalid),
          [A.getLastLocalChange(incomplete)],
          [new Uint8Array([1, 2, 3])],
        ]) {
          try {
            await storage.merge(batch);
            failures.push(false);
          } catch {
            failures.push(true);
          }
        }
        return failures;
      });
      assert.deepEqual(result, [true, true, true]);
      assert.deepEqual(await storedValue(page), original);
      await page.reload();
      await waitForPersistence(page);
      assert.deepEqual(errors, []);
    },
  );
});

test("unavailable IndexedDB has a visible read-only outcome", async (t) => {
  const { server, origin } = await startStaticServer(dist);
  t.after(() => new Promise((done) => server.close(done)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  await runJourney(browser, "persistence-unavailable", async (page, errors) => {
    await page.addInitScript(() =>
      Object.defineProperty(globalThis, "indexedDB", { value: undefined }),
    );
    await page.goto(origin);
    await waitForPersistence(page, "読み込み失敗");
    assert.match(
      await page.locator("#planner-error").innerText(),
      /保存領域を利用できません/,
    );
    await page.locator("#storage-readonly-warning").waitFor();
    assert.deepEqual(errors, []);
  });
});
