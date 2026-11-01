import assert from "node:assert/strict";
import test from "node:test";

import * as Automerge from "@automerge/automerge";

const bridge =
  await import("../../_build/js/release/build/beso1225/tanikun-web/fixtures/fixtures.js");
const api = await (async () => {
  // Preserve the replica actor across the adapter's internal clone. Automerge
  // assigns a fresh random actor to a plain clone, which would make delivery
  // outcomes non-deterministic even with fixed test actors.
  globalThis.Automerge = {
    ...Automerge,
    clone(document, options = {}) {
      return Automerge.clone(document, {
        actor: Automerge.getActorId(document),
        ...options,
      });
    },
  };
  await import("../../apps/web/public/planner-document.js");
  return globalThis.tanikunDocument;
})();

const ACTOR_LEFT = "11".repeat(16);
const ACTOR_RIGHT = "22".repeat(16);
const ORDER_ACTOR = "ff".repeat(16);
const emptyId = { namespace_part: "", local_part: "" };
const emptySnapshot = { course_id: emptyId, name: "", credits: 0 };
const physics = { namespace_part: "fixture", local_part: "physics" };
const physics2 = { namespace_part: "fixture", local_part: "physics-2" };
const retired = { namespace_part: "fixture", local_part: "retired" };
const custom = { namespace_part: "user", local_part: "course-fixture-1" };
const fixtureCategory = "fixture-category";

const source = {
  version: 1,
  catalogue: [
    { id: physics, name: "Physics", credits: 8, status: "active" },
    { id: physics2, name: "Physics II", credits: 6, status: "active" },
    { id: retired, name: "Retired", credits: 4, status: "retired" },
    { id: custom, name: "Custom fixture", credits: 4, status: "active" },
  ],
  offerings: [
    {
      id: "fixture-offering-1",
      course_id: physics,
      academic_year: 2026,
      schedule: "regular",
      terms: ["S1", "S2"],
      semester: "",
      status: "offered",
      slots: [
        { day: "Monday", period: 1 },
        { day: "Thursday", period: 2 },
      ],
      term_slots: [
        { term: "S1", slots: [{ day: "Monday", period: 1 }] },
        { term: "S2", slots: [{ day: "Thursday", period: 2 }] },
      ],
      coordinated_group: "fixture-group",
      coordinated_source: "Verified fixture handout",
    },
    {
      id: "fixture-offering-2",
      course_id: physics2,
      academic_year: 2026,
      schedule: "year-long",
      terms: [],
      semester: "",
      status: "offered",
      slots: [{ day: "Tuesday", period: 2 }],
      term_slots: [],
      coordinated_group: "",
      coordinated_source: "",
    },
    {
      id: "fixture-offering-3",
      course_id: physics2,
      academic_year: 2026,
      schedule: "intensive",
      terms: [],
      semester: "W",
      status: "offered",
      slots: [],
      term_slots: [],
      coordinated_group: "",
      coordinated_source: "",
    },
    {
      id: "user-offering-fixture-1",
      course_id: custom,
      academic_year: 2026,
      schedule: "regular",
      terms: ["S1"],
      semester: "",
      status: "offered",
      slots: [{ day: "Friday", period: 2 }],
      term_slots: [{ term: "S1", slots: [{ day: "Friday", period: 2 }] }],
      coordinated_group: "",
      coordinated_source: "",
    },
  ],
  enrollments: [
    {
      offering_id: "fixture-offering-1",
      status: "passed",
      passing_grade: "good",
      failing_grade: "",
      snapshot: { course_id: physics, name: "Frozen Physics", credits: 8 },
    },
    {
      offering_id: "fixture-offering-2",
      status: "planned",
      passing_grade: "",
      failing_grade: "",
      snapshot: emptySnapshot,
    },
    {
      offering_id: "fixture-offering-3",
      status: "failed",
      passing_grade: "",
      failing_grade: "not-passed",
      snapshot: emptySnapshot,
    },
    {
      offering_id: "user-offering-fixture-1",
      status: "not-taken",
      passing_grade: "",
      failing_grade: "",
      snapshot: emptySnapshot,
    },
  ],
  overrides: [
    {
      target_kind: "course",
      course_namespace: "fixture",
      course_local: "physics",
      offering_id: "",
      value_kind: "text",
      text: "Renamed Physics",
      credits: 0,
      slots: [],
    },
    {
      target_kind: "course",
      course_namespace: "fixture",
      course_local: "physics-2",
      offering_id: "",
      value_kind: "credits",
      text: "",
      credits: 7,
      slots: [],
    },
    {
      target_kind: "offering",
      course_namespace: "",
      course_local: "",
      offering_id: "fixture-offering-1",
      value_kind: "slots",
      text: "",
      credits: 0,
      slots: [{ day: "Tuesday", period: 4 }],
    },
    {
      target_kind: "offering",
      course_namespace: "",
      course_local: "",
      offering_id: "user-offering-fixture-1",
      value_kind: "slots",
      text: "",
      credits: 0,
      slots: [{ day: "Thursday", period: 5 }],
    },
  ],
  program_id: "fixture-program",
  advancement_year: 2026,
  timetable_grade: 3,
  selected_term: "S1",
  visible_days: 5,
  visible_periods: 6,
  custom_course_ids: [custom],
  custom_categories: [{ course: custom, category: fixtureCategory }],
  next_custom_course_number: 3,
};

function validateSource(value, label) {
  const result = bridge.validate_persisted_source(JSON.stringify(value));
  assert.equal(result, "ok", `${label}: ${result}`);
}

function openDocument(value, label = "base") {
  validateSource(value, label);
  return api.update(null, JSON.stringify(value));
}

function edit(base, value, actor, label) {
  validateSource(value, label);
  return api.update(Automerge.clone(base, { actor }), JSON.stringify(value));
}

function changes(from, to) {
  return Automerge.getChanges(from, to);
}

function applyChanges(base, batch) {
  return Automerge.applyChanges(Automerge.clone(base), batch)[0];
}

function text(document) {
  return api.text(document);
}

function heads(document) {
  return Automerge.getHeads(document).toSorted();
}

function reload(document) {
  return Automerge.load(Automerge.save(document));
}

function* interleavings(left, right, prefix = []) {
  if (left.length === 0 && right.length === 0) {
    yield prefix;
    return;
  }
  if (left.length > 0) {
    yield* interleavings(left.slice(1), right, [...prefix, left[0]]);
  }
  if (right.length > 0) {
    yield* interleavings(left, right.slice(1), [...prefix, right[0]]);
  }
}

function assertConverged(base, left, right, label) {
  const leftChanges = changes(base, left);
  const rightChanges = changes(base, right);
  assert.ok(leftChanges.length > 0, `${label}: left produced changes`);
  assert.ok(rightChanges.length > 0, `${label}: right produced changes`);
  const batches = [...interleavings(leftChanges, rightChanges)];
  const documents = batches.map((batch) => applyChanges(base, batch));
  const expected = text(documents[0]);
  const expectedHeads = heads(documents[0]);
  for (const [index, document] of documents.entries()) {
    assert.equal(text(document), expected, `${label}: delivery ${index}`);
    assert.deepEqual(
      heads(document),
      expectedHeads,
      `${label}: heads for delivery ${index}`,
    );
    const loaded = reload(document);
    assert.equal(text(loaded), expected, `${label}: reload ${index}`);
    assert.deepEqual(
      heads(loaded),
      expectedHeads,
      `${label}: reloaded heads ${index}`,
    );
  }
  const repeated = applyChanges(base, [
    ...leftChanges,
    ...rightChanges,
    ...leftChanges,
    ...rightChanges,
  ]);
  assert.equal(text(repeated), expected, `${label}: repeated delivery`);
  assert.deepEqual(heads(repeated), expectedHeads, `${label}: repeated heads`);
  return JSON.parse(expected);
}

function sameId(left, right) {
  return (
    left.namespace_part === right.namespace_part &&
    left.local_part === right.local_part
  );
}

function deletedCustomSource() {
  const deleted = structuredClone(source);
  deleted.catalogue = deleted.catalogue.filter(
    (row) => !sameId(row.id, custom),
  );
  deleted.offerings = deleted.offerings.filter(
    (row) => !sameId(row.course_id, custom),
  );
  deleted.enrollments = deleted.enrollments.filter(
    (row) => row.offering_id !== "user-offering-fixture-1",
  );
  deleted.overrides = deleted.overrides.filter(
    (row) =>
      row.offering_id !== "user-offering-fixture-1" &&
      !(
        row.course_namespace === custom.namespace_part &&
        row.course_local === custom.local_part
      ),
  );
  deleted.custom_course_ids = [];
  deleted.custom_categories = [];
  return deleted;
}

test("the complete fixture passes the MoonBit decoder and the JavaScript transform", () => {
  assert.deepEqual(Object.keys(source).toSorted(), [
    "advancement_year",
    "catalogue",
    "custom_categories",
    "custom_course_ids",
    "enrollments",
    "next_custom_course_number",
    "offerings",
    "overrides",
    "program_id",
    "selected_term",
    "timetable_grade",
    "version",
    "visible_days",
    "visible_periods",
  ]);
  assert.ok(source.catalogue.length > 0);
  assert.ok(source.offerings.length > 0);
  assert.ok(source.enrollments.length > 0);
  assert.ok(source.overrides.length > 0);
  assert.ok(source.custom_course_ids.length > 0);
  assert.ok(source.custom_categories.length > 0);
  validateSource(source, "complete fixture");
  const document = api.update(null, JSON.stringify(source));
  assert.deepEqual(JSON.parse(text(document)), source);
  const canonical = bridge.canonical_persisted_source(text(document));
  assert.ok(!canonical.startsWith("error:"), canonical);
  assert.deepEqual(JSON.parse(canonical), JSON.parse(text(document)));
});

test("derived fields and duplicate identities are rejected", () => {
  const document = openDocument(source, "rejection base");
  assert.throws(
    () =>
      api.update(document, JSON.stringify({ ...source, total_credits: 99 })),
    /未対応の保存項目/,
  );
  const duplicate = structuredClone(source);
  duplicate.catalogue.push(structuredClone(duplicate.catalogue[0]));
  assert.throws(
    () => api.update(document, JSON.stringify(duplicate)),
    /IDが重複/,
  );
});

test("collection identities agree between the transform and the decoder", () => {
  const document = openDocument(source, "identity base");
  const duplicateOffering = structuredClone(source);
  duplicateOffering.offerings.push(
    structuredClone(duplicateOffering.offerings[0]),
  );
  assert.throws(
    () => api.update(document, JSON.stringify(duplicateOffering)),
    /IDが重複/,
  );
  assert.match(
    bridge.validate_persisted_source(JSON.stringify(duplicateOffering)),
    /^error:開講IDが重複しています/,
  );
  const duplicateEnrollment = structuredClone(source);
  duplicateEnrollment.enrollments.push(
    structuredClone(duplicateEnrollment.enrollments[0]),
  );
  assert.throws(
    () => api.update(document, JSON.stringify(duplicateEnrollment)),
    /IDが重複/,
  );
  assert.match(
    bridge.validate_persisted_source(JSON.stringify(duplicateEnrollment)),
    /^error:履修が重複しています/,
  );
  const duplicateOverride = structuredClone(source);
  duplicateOverride.overrides.push(
    structuredClone(duplicateOverride.overrides[0]),
  );
  assert.throws(
    () => api.update(document, JSON.stringify(duplicateOverride)),
    /IDが重複/,
  );
  assert.match(
    bridge.validate_persisted_source(JSON.stringify(duplicateOverride)),
    /^error:上書きが重複しています/,
  );
  const ignoredField = structuredClone(source);
  ignoredField.overrides.push({
    target_kind: "course",
    course_namespace: "fixture",
    course_local: "retired",
    offering_id: "ignored-a",
    value_kind: "text",
    text: "Retired rename",
    credits: 0,
    slots: [],
  });
  const differentIgnoredField = structuredClone(ignoredField);
  differentIgnoredField.overrides.push({
    ...ignoredField.overrides.at(-1),
    offering_id: "ignored-b",
  });
  assert.throws(
    () => api.update(document, JSON.stringify(differentIgnoredField)),
    /上書きが重複しています/,
  );
  assert.match(
    bridge.validate_persisted_source(JSON.stringify(differentIgnoredField)),
    /^error:上書きが重複しています/,
  );
});

test("concurrent offering phases keep one complete offering record", () => {
  const base = openDocument(source);
  const leftSource = structuredClone(source);
  const leftOffering = leftSource.offerings[0];
  leftOffering.slots = [
    { day: "Monday", period: 3 },
    { day: "Thursday", period: 2 },
  ];
  leftOffering.term_slots = [
    { term: "S1", slots: [{ day: "Monday", period: 3 }] },
    { term: "S2", slots: [{ day: "Thursday", period: 2 }] },
  ];
  const rightSource = structuredClone(source);
  const rightOffering = rightSource.offerings[0];
  rightOffering.slots = [
    { day: "Monday", period: 1 },
    { day: "Thursday", period: 4 },
  ];
  rightOffering.term_slots = [
    { term: "S1", slots: [{ day: "Monday", period: 1 }] },
    { term: "S2", slots: [{ day: "Thursday", period: 4 }] },
  ];
  const merged = assertConverged(
    base,
    edit(base, leftSource, ACTOR_LEFT, "left offering phases"),
    edit(base, rightSource, ACTOR_RIGHT, "right offering phases"),
    "offering phase matrix",
  );
  const offering = merged.offerings.find(
    (row) => row.id === "fixture-offering-1",
  );
  assert.ok(
    JSON.stringify(offering) === JSON.stringify(leftOffering) ||
      JSON.stringify(offering) === JSON.stringify(rightOffering),
    "offering slots and phases must be one complete branch record",
  );
});

test("missing references cross the transform and fail the decoder", () => {
  const base = openDocument(source);
  const missingOffering = structuredClone(source);
  missingOffering.enrollments[0].offering_id = "missing-offering";
  const document = api.update(base, JSON.stringify(missingOffering));
  const output = text(document);
  assert.match(
    bridge.validate_persisted_source(output),
    /^error:履修の開講がありません/,
  );
  const missingCourse = structuredClone(source);
  missingCourse.offerings[0].course_id = {
    namespace_part: "fixture",
    local_part: "missing",
  };
  const courseDocument = api.update(base, JSON.stringify(missingCourse));
  assert.match(
    bridge.validate_persisted_source(text(courseDocument)),
    /^error:開講の科目がありません/,
  );
});

test("concurrent scalar and same-record edits converge in every delivery order", () => {
  const base = openDocument(source);
  const leftFirst = structuredClone(source);
  leftFirst.selected_term = "S2";
  const leftSecond = structuredClone(leftFirst);
  leftSecond.overrides[0].text = "Left rename";
  leftSecond.enrollments[0].passing_grade = "excellent";
  leftSecond.enrollments[0].snapshot.name = "Left frozen";
  leftSecond.enrollments[0].snapshot.credits = 9;
  const rightFirst = structuredClone(source);
  rightFirst.visible_days = 6;
  rightFirst.selected_term = "A1";
  const rightSecond = structuredClone(rightFirst);
  rightSecond.overrides[0].text = "Right rename";
  rightSecond.enrollments[0].passing_grade = "fair";
  rightSecond.enrollments[0].snapshot.name = "Right frozen";
  rightSecond.enrollments[0].snapshot.credits = 7;
  const left = edit(
    edit(base, leftFirst, ACTOR_LEFT, "left scalar edit"),
    leftSecond,
    ACTOR_LEFT,
    "left record edit",
  );
  const right = edit(
    edit(base, rightFirst, ACTOR_RIGHT, "right scalar edit"),
    rightSecond,
    ACTOR_RIGHT,
    "right record edit",
  );
  assert.equal(changes(base, left).length, 2);
  assert.equal(changes(base, right).length, 2);
  assert.equal(
    Automerge.decodeChange(Automerge.getLastLocalChange(left)).actor,
    ACTOR_LEFT,
  );
  assert.equal(
    Automerge.decodeChange(Automerge.getLastLocalChange(right)).actor,
    ACTOR_RIGHT,
  );
  const merged = assertConverged(base, left, right, "scalar matrix");
  assert.ok(
    merged.selected_term === "S2" || merged.selected_term === "A1",
    "same-scalar conflict selects one branch value",
  );
  assert.equal(merged.visible_days, 6);
  assert.ok(
    JSON.stringify(merged.overrides[0]) ===
      JSON.stringify(leftSecond.overrides[0]) ||
      JSON.stringify(merged.overrides[0]) ===
        JSON.stringify(rightSecond.overrides[0]),
    "override record must be one complete branch record",
  );
  assert.ok(
    JSON.stringify(merged.enrollments[0]) ===
      JSON.stringify(leftSecond.enrollments[0]) ||
      JSON.stringify(merged.enrollments[0]) ===
        JSON.stringify(rightSecond.enrollments[0]),
    "enrollment grade and snapshot must stay atomic",
  );
});

test("concurrent additions, deletions, and categories converge", () => {
  const base = openDocument(source);
  const leftSource = structuredClone(source);
  const added = { namespace_part: "fixture", local_part: "added-left" };
  leftSource.catalogue.push({
    id: added,
    name: "Added left",
    credits: 2,
    status: "active",
  });
  leftSource.offerings.push({
    id: "added-left-offering",
    course_id: added,
    academic_year: 2026,
    schedule: "regular",
    terms: ["A1"],
    semester: "",
    status: "offered",
    slots: [{ day: "Wednesday", period: 3 }],
    term_slots: [{ term: "A1", slots: [{ day: "Wednesday", period: 3 }] }],
    coordinated_group: "",
    coordinated_source: "",
  });
  leftSource.enrollments.push({
    offering_id: "added-left-offering",
    status: "planned",
    passing_grade: "",
    failing_grade: "",
    snapshot: emptySnapshot,
  });
  leftSource.custom_categories.push({
    course: physics2,
    category: fixtureCategory,
  });
  const rightSource = structuredClone(source);
  rightSource.offerings = rightSource.offerings.filter(
    (row) => row.id !== "fixture-offering-2",
  );
  rightSource.enrollments = rightSource.enrollments.filter(
    (row) => row.offering_id !== "fixture-offering-2",
  );
  rightSource.catalogue.reverse();
  rightSource.offerings.reverse();
  const merged = assertConverged(
    base,
    edit(base, leftSource, ACTOR_LEFT, "left additions"),
    edit(base, rightSource, ACTOR_RIGHT, "right deletions"),
    "add/delete matrix",
  );
  assert.ok(merged.catalogue.some((row) => row.id.local_part === "added-left"));
  assert.ok(!merged.offerings.some((row) => row.id === "fixture-offering-2"));
  assert.equal(merged.custom_categories.length, 2);
});

test("competing collection orders keep surviving keys and append additions", () => {
  const base = openDocument(source);
  const leftSource = structuredClone(source);
  leftSource.catalogue = [
    leftSource.catalogue.find((row) => row.id.local_part === "physics-2"),
    leftSource.catalogue.find((row) => row.id.local_part === "physics"),
    leftSource.catalogue.find(
      (row) => row.id.local_part === "course-fixture-1",
    ),
    leftSource.catalogue.find((row) => row.id.local_part === "retired"),
  ];
  const rightSource = structuredClone(source);
  for (const local of ["zzz-added", "aaa-added"]) {
    const id = { namespace_part: "fixture", local_part: local };
    rightSource.catalogue.push({
      id,
      name: local,
      credits: 2,
      status: "active",
    });
    rightSource.offerings.push({
      id: `${local}-offering`,
      course_id: id,
      academic_year: 2026,
      schedule: "regular",
      terms: ["A2"],
      semester: "",
      status: "offered",
      slots: [{ day: "Friday", period: 4 }],
      term_slots: [{ term: "A2", slots: [{ day: "Friday", period: 4 }] }],
      coordinated_group: "",
      coordinated_source: "",
    });
  }
  const left = edit(base, leftSource, ORDER_ACTOR, "left order");
  assert.equal(
    Automerge.decodeChange(Automerge.getLastLocalChange(left)).actor,
    ORDER_ACTOR,
  );
  const merged = assertConverged(
    base,
    left,
    edit(base, rightSource, ACTOR_RIGHT, "right additions"),
    "order matrix",
  );
  assert.deepEqual(
    merged.catalogue.map((row) => row.id.local_part),
    [
      "physics-2",
      "physics",
      "course-fixture-1",
      "retired",
      "aaa-added",
      "zzz-added",
    ],
    "winning order retains surviving keys and appends unlisted additions sorted",
  );
});

test("concurrent additions with the same identity keep one complete record", () => {
  const base = openDocument(source);
  const shared = { namespace_part: "fixture", local_part: "shared" };
  const branch = (name, credits, day) => {
    const draft = structuredClone(source);
    draft.catalogue.push({
      id: shared,
      name,
      credits,
      status: "active",
    });
    draft.offerings.push({
      id: `shared-${name}`,
      course_id: shared,
      academic_year: 2026,
      schedule: "regular",
      terms: ["A1"],
      semester: "",
      status: "offered",
      slots: [{ day, period: 2 }],
      term_slots: [{ term: "A1", slots: [{ day, period: 2 }] }],
      coordinated_group: "",
      coordinated_source: "",
    });
    return draft;
  };
  const leftSource = branch("Left shared", 2, "Saturday");
  const rightSource = branch("Right shared", 4, "Sunday");
  const merged = assertConverged(
    base,
    edit(base, leftSource, ACTOR_LEFT, "left shared addition"),
    edit(base, rightSource, ACTOR_RIGHT, "right shared addition"),
    "same-ID additions",
  );
  const rows = merged.catalogue.filter((row) => sameId(row.id, shared));
  assert.equal(rows.length, 1, "one complete shared record");
  assert.ok(
    JSON.stringify(rows[0]) === JSON.stringify(leftSource.catalogue.at(-1)) ||
      JSON.stringify(rows[0]) === JSON.stringify(rightSource.catalogue.at(-1)),
    "shared record must be one complete branch record",
  );
  assert.equal(
    merged.offerings.filter((row) => sameId(row.course_id, shared)).length,
    2,
    "distinct offerings from both branches survive",
  );
});

test("custom deletion wins over every dependent edit and cannot revive", () => {
  const deleted = deletedCustomSource();
  for (const [label, mutate] of [
    [
      "course name",
      (draft) => {
        draft.catalogue.find((row) => sameId(row.id, custom)).name =
          "Left custom";
      },
    ],
    [
      "offering slots",
      (draft) => {
        const offering = draft.offerings.find(
          (row) => row.id === "user-offering-fixture-1",
        );
        offering.slots = [{ day: "Thursday", period: 5 }];
        offering.term_slots = [
          { term: "S1", slots: [{ day: "Thursday", period: 5 }] },
        ];
      },
    ],
    [
      "category",
      (draft) => {
        draft.custom_categories[0].category = "other-category";
      },
    ],
    [
      "enrollment",
      (draft) => {
        const enrollment = draft.enrollments.find(
          (row) => row.offering_id === "user-offering-fixture-1",
        );
        enrollment.status = "passed";
        enrollment.passing_grade = "good";
        enrollment.snapshot = {
          course_id: custom,
          name: "Frozen custom",
          credits: 4,
        };
      },
    ],
    [
      "override",
      (draft) => {
        draft.overrides.push({
          target_kind: "course",
          course_namespace: custom.namespace_part,
          course_local: custom.local_part,
          offering_id: "",
          value_kind: "text",
          text: "Custom override",
          credits: 0,
          slots: [],
        });
      },
    ],
    [
      "offering override",
      (draft) => {
        const override = draft.overrides.find(
          (row) => row.offering_id === "user-offering-fixture-1",
        );
        override.slots = [{ day: "Monday", period: 5 }];
      },
    ],
  ]) {
    const editedSource = structuredClone(source);
    mutate(editedSource);
    const base = openDocument(source, `${label}: base`);
    const deletion = edit(base, deleted, ACTOR_LEFT, `${label}: deletion`);
    const edited = edit(base, editedSource, ACTOR_RIGHT, `${label}: edit`);
    const merged = assertConverged(base, deletion, edited, label);
    assert.deepEqual(merged, deleted, `${label}: deletion wins`);
    assert.throws(
      () =>
        api.update(
          applyChanges(base, [
            ...changes(base, deletion),
            ...changes(base, edited),
          ]),
          JSON.stringify(editedSource),
        ),
      /削除済み/,
      `${label}: revival rejected`,
    );
  }
});

test("a document predating tombstones can delete, save, reload, and continue", () => {
  const base = openDocument(source, "pre-tombstone");
  const deleted = edit(
    base,
    deletedCustomSource(),
    ACTOR_LEFT,
    "pre-tombstone deletion",
  );
  const reloaded = reload(deleted);
  assert.equal(text(reloaded), text(deleted));
  assert.deepEqual(heads(reloaded), heads(deleted));
  assert.throws(() => api.update(reloaded, JSON.stringify(source)), /削除済み/);
  const later = structuredClone(deletedCustomSource());
  later.selected_term = "A2";
  assert.equal(
    JSON.parse(text(api.update(reloaded, JSON.stringify(later)))).selected_term,
    "A2",
  );
});
