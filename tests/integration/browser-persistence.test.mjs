import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  abortNextPut,
  delayNextOpenSuccess,
  delayNextTransactionComplete,
  delaySaves,
  failNextSave,
  failNextSaveResult,
  waitForCommittedSourceAfter,
  readCommittedSource,
  readStored,
  releaseBarrier,
  runBrowserJourney,
  shortenPersistenceTimeout,
  storeInvalidDocument,
  waitForCommittedSource,
  waitForCommittedTerm,
  waitForDelayedCallback,
  waitForPersistence,
  writeStored,
} from "./persistence-helpers.mjs";

const dist = resolve(process.env.TANIKUN_WEB_DIST ?? "apps/web/dist");
const core = process.env.PLAYWRIGHT_CORE;
assert.ok(core, "run this test in `nix develop` so PLAYWRIGHT_CORE is set");
const { chromium } = await import(pathToFileURL(join(core, "index.mjs")).href);

test("local persistence restores edits after reload", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-reload" },
    async ([page], errors, origin) => {
      await page.goto(origin);
      await waitForPersistence(page);
      await page.locator("#open-catalogue-picker").click();
      await page.locator("#add-offering-phy302-s").click();
      await page.locator("#close-picker").click();
      await waitForCommittedSource(
        page,
        'source.offerings.some((row) => row.id === "phy302-s")',
        "added phy302 offering",
      );
      await waitForPersistence(page);
      assert.match(await page.locator("#off-grid").innerText(), /Seminar S2/);
      await page.reload();
      await waitForPersistence(page);
      assert.match(await page.locator("#off-grid").innerText(), /Seminar S2/);
      assert.deepEqual(errors, []);
    },
  );
});

test("corrupt local data is reported without discarding the seed", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-corrupt" },
    async ([page], errors, origin) => {
      await page.goto(origin);
      await waitForPersistence(page);
      await storeInvalidDocument(page);
      await page.reload();
      await waitForPersistence(page, "読み込み失敗");
      assert.match(
        await page.locator("#planner-error").innerText(),
        /保存データを読み込めません/,
      );
      assert.match(await page.locator("#timetable").innerText(), /Physics I/);
      assert.deepEqual(errors, []);
    },
  );
});

test("save failures keep the edit visible and report the failure", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-save-failure" },
    async ([page], errors, origin) => {
      await page.goto(origin);
      await waitForPersistence(page);
      const committed = await readStored(page);
      await failNextSave(page);
      await page.locator("#open-catalogue-picker").click();
      await page.locator("#add-offering-phy302-s").click();
      await page.locator("#close-picker").click();
      await waitForPersistence(page, "保存失敗");
      assert.match(await page.locator("#off-grid").innerText(), /Seminar S2/);
      assert.deepEqual(await readStored(page), committed);
      assert.deepEqual(errors, []);
    },
  );
});

test("unsaved is visible while a source edit is queued", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-unsaved" },
    async ([page], errors, origin) => {
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
      });
      await delaySaves(page);
      await page.locator("#open-catalogue-picker").click();
      await page.locator("#add-offering-phy302-s").click();
      await page.locator("#close-picker").click();
      await waitForPersistence(page, "保存中");
      await releaseBarrier(page);
      await waitForCommittedSource(
        page,
        'source.offerings.some((row) => row.id === "phy302-s")',
        "queued save committed",
      );
      await waitForPersistence(page);
      const labels = await page.evaluate(() => globalThis["persistenceLabels"]);
      assert.ok(labels.includes("未保存"));
      assert.ok(labels.includes("保存中"));
      assert.deepEqual(errors, []);
    },
  );
});

test("UI-only changes do not write the planner document", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-ui-only" },
    async ([page], errors, origin) => {
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
      await page
        .locator("#add-offering-phy302-s")
        .waitFor({ state: "detached" });
      assert.equal(
        await page.evaluate(() => globalThis["persistenceSaves"]),
        0,
      );
      assert.deepEqual(errors, []);
    },
  );
});

test("quick undo wins over a pending removed document", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-quick-undo" },
    async ([page], errors, origin) => {
      await page.goto(origin);
      await waitForPersistence(page);
      const before = await readStored(page);
      await delaySaves(page);
      await page
        .locator("#timetable")
        .getByText("Physics I", { exact: true })
        .click();
      await page.locator("#remove-detail").click();
      await page.locator("#undo-removal-button").click();
      await releaseBarrier(page);
      await waitForCommittedSourceAfter(
        page,
        'source.enrollments.some((row) => row.offering_id === "phy101-s1")',
        before,
        "undo restored a newly committed enrollment",
      );
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
    },
  );
});

test("a load failure does not overwrite the stored document", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-load-failure" },
    async ([page], errors, origin) => {
      await page.goto(origin);
      await waitForPersistence(page);
      await storeInvalidDocument(page);
      await page.reload();
      await waitForPersistence(page, "読み込み失敗");
      await page.locator("#open-catalogue-picker").click();
      await page.locator("#add-offering-phy302-s").click();
      await page.locator("#close-picker").click();
      const stored = await readStored(page);
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
      const recovered = await readStored(page);
      assert.notEqual(recovered, "{broken");
      assert.equal(recovered.storageVersion, 2);
      assert.ok(recovered.bytes.length > 0);
      await page.reload();
      await waitForPersistence(page);
      assert.match(await page.locator("#off-grid").innerText(), /Seminar S2/);
      assert.deepEqual(errors, []);
    },
  );
});

test("legacy JSON migrates on the next edit without changing source state", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-migration" },
    async ([page], errors, origin) => {
      await page.goto(origin);
      await waitForPersistence(page);
      const original = await readCommittedSource(page);
      await writeStored(page, JSON.stringify(original));
      await page.reload();
      await waitForPersistence(page);
      assert.deepEqual(await readCommittedSource(page), original);
      await page.locator("#term-S2").click();
      await waitForCommittedTerm(page, "S2");
      await waitForPersistence(page);
      assert.equal((await readStored(page)).storageVersion, 2);
      await page.reload();
      await waitForPersistence(page);
      assert.deepEqual(await readCommittedSource(page), {
        ...original,
        selected_term: "S2",
      });
      assert.deepEqual(errors, []);
    },
  );
});

test("unsupported storage and aborted writes preserve the last committed plan", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-abort" },
    async ([page], errors, origin) => {
      await page.goto(origin);
      await waitForPersistence(page);
      const original = await readCommittedSource(page);
      const committed = await readStored(page);
      await abortNextPut(page);
      await page.locator("#term-S2").click();
      await waitForPersistence(page, "保存失敗");
      assert.deepEqual(await readStored(page), committed);
      await page.reload();
      await waitForPersistence(page);
      assert.deepEqual(await readCommittedSource(page), original);
      const future = { storageVersion: 999, bytes: [1, 2, 3] };
      await writeStored(page, future);
      await page.reload();
      await waitForPersistence(page, "読み込み失敗");
      assert.deepEqual(await readStored(page), future);
      assert.deepEqual(errors, []);
    },
  );
});

test("invalid peer changes never replace the committed document", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-invalid-merge" },
    async ([page], errors, origin) => {
      await page.goto(origin);
      await waitForPersistence(page);
      const original = await readStored(page);
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
          JSON.stringify(await globalThis.tanikunPersistenceProbe.readSource()),
        );
        const missingReference = A.change(A.clone(base), (draft) => {
          for (const key of Object.keys(draft.collections.offerings)) {
            delete draft.collections.offerings[key];
          }
        });
        const failures = [];
        for (const batch of [
          A.getAllChanges(invalid),
          [A.getLastLocalChange(incomplete)],
          [new Uint8Array([1, 2, 3])],
          A.getAllChanges(missingReference),
        ]) {
          try {
            await storage.merge(batch);
            failures.push(false);
          } catch (error) {
            failures.push(error.message);
          }
        }
        return failures;
      });
      assert.ok(result.every((message) => typeof message === "string"));
      assert.match(result[1], /履歴が不足/);
      assert.match(result[3], /統合した保存データが正しくありません/);
      assert.deepEqual(await readStored(page), original);
      await page.reload();
      await waitForPersistence(page);
      assert.deepEqual(errors, []);
    },
  );
});

test("unavailable IndexedDB has a visible read-only outcome", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-unavailable" },
    async ([page], errors, origin) => {
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
    },
  );
});

test("a rejected load result falls back to the load failure guidance", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-load-rejection" },
    async ([page], errors, origin) => {
      await page.addInitScript(() => {
        let storage;
        Object.defineProperty(globalThis, "tanikunStorage", {
          configurable: true,
          get: () => storage,
          set: (value) => {
            value.loadResult = () => Promise.reject("unexpected");
            storage = value;
          },
        });
      });
      await page.goto(origin);
      await waitForPersistence(page, "読み込み失敗");
      assert.match(
        await page.locator("#planner-error").innerText(),
        /保存データを読み込めません/,
      );
      assert.deepEqual(errors, []);
    },
  );
});

test("a malformed load wire fails closed", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-load-malformed" },
    async ([page], errors, origin) => {
      await page.addInitScript(() => {
        let storage;
        Object.defineProperty(globalThis, "tanikunStorage", {
          configurable: true,
          get: () => storage,
          set: (value) => {
            value.loadResult = () => Promise.resolve(["loaded", 42]);
            storage = value;
          },
        });
      });
      await page.goto(origin);
      await waitForPersistence(page, "読み込み失敗");
      assert.match(
        await page.locator("#planner-error").innerText(),
        /保存データを読み込めません/,
      );
      assert.deepEqual(errors, []);
    },
  );
});

test("a rejected save result reports save failure", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-save-rejection" },
    async ([page], errors, origin) => {
      await page.goto(origin);
      await waitForPersistence(page);
      await failNextSaveResult(page);
      await page.locator("#term-S2").click();
      await waitForPersistence(page, "保存失敗");
      assert.match(
        await page.locator("#planner-error").innerText(),
        /保存できません。再読み込みしてください/,
      );
      assert.deepEqual(errors, []);
    },
  );
});

test("a failed initial seed write reports save failure and a later edit retries", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-seed-failure" },
    async ([page], errors, origin) => {
      await page.addInitScript(() => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          IDBObjectStore.prototype.put = put;
          const request = put.apply(this, args);
          this.transaction.abort();
          return request;
        };
      });
      await page.goto(origin);
      await waitForPersistence(page, "保存失敗");
      assert.equal(await page.locator("#storage-readonly-warning").count(), 0);
      await page.locator("#term-S2").click();
      await waitForCommittedTerm(page, "S2");
      await waitForPersistence(page);
      await page.reload();
      await waitForPersistence(page);
      assert.equal((await readCommittedSource(page)).selected_term, "S2");
      assert.deepEqual(errors, []);
    },
  );
});

test("a timed-out database open cannot write after a later save", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-late-open" },
    async ([page], errors, origin) => {
      await page.goto(origin);
      await waitForPersistence(page);
      const committed = await readStored(page);
      await shortenPersistenceTimeout(page);
      await delayNextOpenSuccess(page);
      await page.locator("#term-S2").click();
      await waitForPersistence(page, "保存失敗");
      assert.deepEqual(await readStored(page), committed);
      await page.locator("#term-A1").click();
      await waitForCommittedTerm(page, "A1");
      const later = await readStored(page);
      await releaseBarrier(page);
      await waitForDelayedCallback(page);
      assert.deepEqual(await readStored(page), later);
      await page.reload();
      await waitForPersistence(page);
      assert.equal((await readCommittedSource(page)).selected_term, "A1");
      assert.deepEqual(errors, []);
    },
  );
});

test("deleting a custom course with existing overrides survives reload", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-delete-overrides" },
    async ([page], errors, origin) => {
      await page.goto(origin);
      await waitForPersistence(page);
      await page.locator("#open-catalogue-picker").click();
      await page.locator("#open-custom-course").click();
      await page.locator("#custom-name").fill("Override deletion");
      await page.locator("#custom-submit").click();
      await page.locator('[id^="add-offering-user-offering-"]').click();
      await page.locator("#close-picker").click();
      await page
        .locator("#timetable")
        .getByText("Override deletion", { exact: true })
        .click();
      await page.locator("#open-override-editor").click();
      await page.locator("#override-name").fill("Renamed custom");
      await page.locator("#override-credits").selectOption("6");
      await page.locator("#override-slots-enabled").click();
      await page.locator("#override-submit").click();
      const beforeOverrides = await readStored(page);
      await page.locator("#remove-detail").click();
      await waitForCommittedSourceAfter(
        page,
        "source.overrides.length === 3",
        beforeOverrides,
        "custom overrides committed",
      );
      await waitForPersistence(page);
      await page.locator("#open-catalogue-picker").click();
      await page.locator('[id^="edit-custom-user-offering-"]').click();
      await page.locator("#delete-custom-course").click();
      await page.locator("#close-picker").click();
      await waitForCommittedSource(
        page,
        "source.custom_course_ids.length === 0",
        "custom deletion committed",
      );
      await waitForPersistence(page);
      await page.reload();
      await waitForPersistence(page);
      const restored = await readCommittedSource(page);
      assert.deepEqual(restored.custom_course_ids, []);
      assert.deepEqual(restored.overrides, []);
      await page.locator("#open-catalogue-picker").click();
      assert.equal(
        await page.locator('[id^="edit-custom-user-offering-"]').count(),
        0,
      );
      assert.deepEqual(errors, []);
    },
  );
});

test("a late commit is reconciled before retry and cannot regress a newer save", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-late-commit" },
    async ([page], errors, origin) => {
      await page.goto(origin);
      await waitForPersistence(page);
      const before = await readStored(page);
      await shortenPersistenceTimeout(page);
      await delayNextTransactionComplete(page);
      await page.locator("#term-S2").click();
      await waitForPersistence(page, "保存失敗");
      assert.notDeepEqual(await readStored(page), before);
      // Returning to the last acknowledged content still needs a write: the
      // timed-out S2 save may already have committed.
      await page.locator("#term-S1").click();
      await waitForCommittedTerm(page, "S1");
      await releaseBarrier(page);
      await waitForDelayedCallback(page);
      await page.locator("#term-A2").click();
      await waitForCommittedTerm(page, "A2");
      await page.reload();
      await waitForPersistence(page);
      assert.equal((await readCommittedSource(page)).selected_term, "A2");
      assert.deepEqual(errors, []);
    },
  );
});
