import assert from "node:assert/strict";
import test from "node:test";

import * as Automerge from "@automerge/automerge";

async function adapter() {
  globalThis.Automerge = Automerge;
  await import("../../apps/web/public/planner-document.js");
  return globalThis.tanikunDocument;
}

const source = {
  version: 1,
  catalogue: [
    {
      id: { namespace_part: "fixture", local_part: "physics" },
      name: "Physics",
      credits: 4,
    },
  ],
  offerings: [
    {
      id: "physics-s",
      term_slots: [
        { term: "S1", slots: [{ day: "Monday", period: 1 }] },
        { term: "S2", slots: [{ day: "Thursday", period: 3 }] },
      ],
      coordinated_group: "fictional-shared-slot",
      coordinated_source: "Verified fictional handout",
    },
  ],
  enrollments: [
    {
      offering_id: "physics-s",
      status: "passed",
      passing_grade: "excellent",
      snapshot: { name: "Frozen Physics", credits: 4 },
    },
  ],
  overrides: [],
  custom_course_ids: [],
  custom_categories: [],
  program_id: "fictional",
  next_custom_course_number: 1,
};

test("independent edits survive binary reload and converge without replacing collections", async () => {
  const api = await adapter();
  const base = api.update(null, JSON.stringify(source));
  const leftSource = structuredClone(source);
  leftSource.custom_categories.push({
    course: source.catalogue[0].id,
    category: "science",
  });
  const rightSource = structuredClone(source);
  rightSource.overrides.push({
    target_kind: "Course",
    course_namespace: "fixture",
    course_local: "physics",
    value_kind: "Name",
    text: "Display name",
  });
  const left = Automerge.load(
    Automerge.save(
      api.update(Automerge.clone(base), JSON.stringify(leftSource)),
    ),
  );
  const right = Automerge.load(
    Automerge.save(
      api.update(Automerge.clone(base), JSON.stringify(rightSource)),
    ),
  );
  const a = api.text(
    Automerge.applyChanges(left, Automerge.getAllChanges(right))[0],
  );
  const b = api.text(
    Automerge.applyChanges(right, Automerge.getAllChanges(left))[0],
  );
  assert.equal(a, b);
  const result = JSON.parse(a);
  assert.deepEqual(result.enrollments, source.enrollments);
  assert.deepEqual(result.offerings, source.offerings);
  assert.deepEqual(result.custom_categories, leftSource.custom_categories);
  assert.deepEqual(result.overrides, rightSource.overrides);
  assert.deepEqual(
    Object.keys(result).toSorted(),
    Object.keys(source).toSorted(),
  );
});

test("conflicting enrollment edits keep one complete grade and snapshot record", async () => {
  const api = await adapter();
  const base = api.update(null, JSON.stringify(source));
  const leftSource = structuredClone(source);
  leftSource.enrollments[0].passing_grade = "good";
  leftSource.enrollments[0].snapshot.name = "Left snapshot";
  const rightSource = structuredClone(source);
  rightSource.enrollments[0].passing_grade = "fair";
  rightSource.enrollments[0].snapshot.name = "Right snapshot";
  const left = api.update(Automerge.clone(base), JSON.stringify(leftSource));
  const right = api.update(Automerge.clone(base), JSON.stringify(rightSource));
  const result = JSON.parse(api.text(Automerge.merge(left, right)));
  const record = result.enrollments[0];
  const expected = record.passing_grade === "good" ? leftSource : rightSource;
  assert.deepEqual(result.enrollments, expected.enrollments);
  assert.equal(api.text(Automerge.merge(right, left)), JSON.stringify(result));
});

test("derived fields are rejected and source collection order survives reload", async () => {
  const api = await adapter();
  const ordered = structuredClone(source);
  ordered.offerings.push({ id: "a-first-lexically", term_slots: [] });
  const doc = api.update(null, JSON.stringify(ordered));
  assert.deepEqual(
    JSON.parse(api.text(Automerge.load(Automerge.save(doc)))),
    ordered,
  );
  assert.throws(
    () => api.update(doc, JSON.stringify({ ...ordered, total_credits: 99 })),
    /未対応の保存項目/,
  );
});
