import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  mergeChanges,
  readChanges,
  readCommittedSource,
  readStored,
  runBrowserJourney,
  waitForCommittedSource,
  waitForCommittedTerm,
  waitForPersistence,
  writeStored,
} from "./persistence-helpers.mjs";

const dist = resolve(process.env.TANIKUN_WEB_DIST ?? "apps/web/dist");
const core = process.env.PLAYWRIGHT_CORE;
assert.ok(core, "run this test in `nix develop` so PLAYWRIGHT_CORE is set");
const { chromium } = await import(pathToFileURL(join(core, "index.mjs")).href);

test("isolated replicas retain offline edits across reload and converge", async (t) => {
  await runBrowserJourney(
    t,
    {
      chromium,
      dist,
      name: "persistence-replicas",
      pages: 2,
      isolated: true,
    },
    async ([left, right], errors, origin, contexts) => {
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
      await waitForCommittedSource(
        left,
        "source.custom_course_ids.length === 1",
        "baseline custom course committed",
      );
      await waitForPersistence(left);
      const baseline = await readCommittedSource(left);
      const passed = baseline.enrollments.find(
        (row) => row.status === "passed",
      );
      assert.ok(passed);
      assert.equal(passed.passing_grade, "good");
      assert.equal(passed.snapshot.name, "Physics I");
      const common = await readStored(left);
      // Adopt a common history before branching, as required for an Automerge fork.
      await writeStored(right, common);
      await right.reload();
      await waitForPersistence(right);
      for (const context of contexts) await context.setOffline(true);
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
      await waitForCommittedSource(
        left,
        'source.offerings.some((row) => row.id === "phy302-s") && source.custom_course_ids.length === 2',
        "left offline edits committed",
      );
      await waitForCommittedSource(
        right,
        'source.custom_course_ids.length === 2 && !source.offerings.some((row) => row.id === "phy201-year")',
        "right offline edits committed",
      );
      await waitForPersistence(left);
      await waitForPersistence(right);
      // Only the static application is served on reload; storage and peer exchange
      // never use the network. No peer changes have been delivered yet.
      for (const context of contexts) await context.setOffline(false);
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
      const leftChanges = await readChanges(left);
      const rightChanges = await readChanges(right);
      await mergeChanges(left, rightChanges);
      await mergeChanges(right, leftChanges);
      assert.deepEqual(
        await readCommittedSource(left),
        await readCommittedSource(right),
      );
      const converged = await readCommittedSource(left);
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
      await mergeChanges(left, rightChanges); // Redelivery is idempotent.
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
    },
  );
});

for (const edit of ["name", "allocation"]) {
  test(`custom deletion converges with a concurrent ${edit} edit`, async (t) => {
    await runBrowserJourney(
      t,
      {
        chromium,
        dist,
        name: `persistence-delete-${edit}`,
        pages: 2,
        isolated: true,
      },
      async ([left, right], errors, origin) => {
        await left.goto(origin);
        await waitForPersistence(left);
        await left.locator("#open-catalogue-picker").click();
        await left.locator("#open-custom-course").click();
        await left.locator("#custom-name").fill("Concurrent custom");
        await left.locator("#custom-category").selectOption("lab");
        await left.locator("#custom-submit").click();
        await left.locator("#close-picker").click();
        await waitForCommittedSource(
          left,
          "source.custom_course_ids.length === 1",
          "custom course committed before branching",
        );
        await waitForPersistence(left);
        await right.goto(origin);
        await waitForPersistence(right);
        await writeStored(right, await readStored(left));
        await right.reload();
        await waitForPersistence(right);
        for (const page of [left, right]) {
          await page.locator("#open-catalogue-picker").click();
          await page.locator('[id^="edit-custom-user-offering-"]').click();
        }
        await left.locator("#delete-custom-course").click();
        await left.locator("#close-picker").click();
        if (edit === "name")
          await right.locator("#custom-name").fill("Edited custom");
        else {
          await right.locator("#custom-day").selectOption("4");
          await right.locator("#custom-period").selectOption("5");
        }
        await right.locator("#custom-submit").click();
        await right.locator("#close-picker").click();
        await waitForCommittedSource(
          left,
          "source.custom_course_ids.length === 0",
          "deletion committed",
        );
        await waitForCommittedSource(
          right,
          "source.custom_course_ids.length === 1",
          "concurrent edit committed",
        );
        for (const page of [left, right]) await waitForPersistence(page);
        const leftChanges = await readChanges(left);
        const rightChanges = await readChanges(right);
        await mergeChanges(left, rightChanges);
        await mergeChanges(right, leftChanges);
        assert.deepEqual(
          await readCommittedSource(left),
          await readCommittedSource(right),
        );
        for (const page of [left, right]) {
          await page.reload();
          await waitForPersistence(page);
          const restored = await readCommittedSource(page);
          assert.deepEqual(restored.custom_course_ids, []);
          assert.deepEqual(restored.custom_categories, []);
          assert.equal(
            restored.catalogue.filter((row) => row.id.namespace_part === "user")
              .length,
            0,
          );
          assert.equal(
            restored.offerings.filter(
              (row) => row.course_id.namespace_part === "user",
            ).length,
            0,
          );
          await page.locator("#open-catalogue-picker").click();
          assert.equal(
            await page.locator('[id^="edit-custom-user-offering-"]').count(),
            0,
          );
        }
        await mergeChanges(right, leftChanges);
        assert.deepEqual(errors, []);
      },
    );
  });
}

test("a stale tab cannot overwrite a newer committed plan", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-stale-tab", pages: 2 },
    async ([left, right], errors, origin) => {
      await left.goto(origin);
      await waitForPersistence(left);
      await right.goto(origin);
      await waitForPersistence(right);
      await left.locator("#open-catalogue-picker").click();
      await left.locator("#add-offering-phy302-s").click();
      await left.locator("#close-picker").click();
      await waitForCommittedSource(
        left,
        'source.offerings.some((row) => row.id === "phy302-s")',
        "left tab edit committed",
      );
      await waitForPersistence(left);
      const committed = await readStored(left);
      await right.locator("#term-S2").click();
      await waitForPersistence(right, "保存失敗");
      assert.equal(await right.locator("#planner-error").count(), 1);
      assert.match(
        await right.locator("#planner-error").innerText(),
        /別のタブ.*再読み込み/,
      );
      assert.deepEqual(await readStored(left), committed);
      assert.equal(await right.locator("#storage-readonly-warning").count(), 0);
      await right.reload();
      await waitForPersistence(right);
      assert.match(await right.locator("#off-grid").innerText(), /Seminar S2/);
      assert.equal((await readCommittedSource(right)).selected_term, "S1");
      assert.deepEqual(errors, []);
    },
  );
});

test("simultaneous first-open tabs hydrate the winning seed and can edit", async (t) => {
  await runBrowserJourney(
    t,
    { chromium, dist, name: "persistence-simultaneous-seed", pages: 2 },
    async ([left, right], errors, origin, contexts) => {
      const [context] = contexts;
      const pending = [];
      await context.exposeBinding(
        "seedRead",
        () =>
          new Promise((resolveRead) => {
            pending.push(resolveRead);
            if (pending.length >= 2) for (const finish of pending) finish();
          }),
      );
      await context.addInitScript(() => {
        const create = IDBDatabase.prototype.transaction;
        const abort = IDBTransaction.prototype.abort;
        let firstRead = true;
        globalThis.seedAborts = 0;
        IDBTransaction.prototype.abort = function (...args) {
          globalThis.seedAborts += 1;
          return abort.apply(this, args);
        };
        IDBDatabase.prototype.transaction = function (...args) {
          const tx = create.apply(this, args);
          if (tx.mode === "readonly" && firstRead) {
            firstRead = false;
            const listen = tx.addEventListener.bind(tx);
            tx.addEventListener = (type, callback, options) =>
              listen(
                type,
                type === "complete"
                  ? async () => {
                      await globalThis.seedRead();
                      callback();
                    }
                  : callback,
                options,
              );
          }
          return tx;
        };
      });
      await Promise.all([left.goto(origin), right.goto(origin)]);
      await Promise.all([waitForPersistence(left), waitForPersistence(right)]);
      const tabs = [left, right];
      const aborts = await Promise.all(
        tabs.map((page) => page.evaluate(() => globalThis.seedAborts)),
      );
      assert.equal(
        aborts.reduce((sum, value) => sum + value, 0),
        1,
      );
      const loser = tabs[aborts.findIndex((count) => count === 1)];
      await loser.locator("#term-S2").click();
      await waitForCommittedTerm(loser, "S2");
      await loser.reload();
      // The startup read barrier is only for the initial navigation.
      await waitForPersistence(loser);
      assert.equal((await readCommittedSource(loser)).selected_term, "S2");
      assert.deepEqual(errors, []);
    },
  );
});
