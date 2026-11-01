// Atomic records keep grades and passed snapshots together. Collections use
// stable entity keys so unrelated additions and deletions merge independently.
const plannerCourseKey = (id) => [id.namespace_part, id.local_part];
const overrideIdentity = (row) =>
  row.target_kind === "course"
    ? ["course", row.course_namespace, row.course_local, row.value_kind]
    : ["offering", row.offering_id, row.value_kind];
{
  const A = globalThis.Automerge;
  const deletionPrefix = "deleted_custom_course:";
  // Keep tombstones in the existing shared fields map. Lazily creating a new
  // map on each replica would itself conflict when upgrading older documents.
  const deletedCourses = (doc) =>
    Object.fromEntries(
      Object.keys(doc.fields)
        .filter((key) => key.startsWith(deletionPrefix))
        .map((key) => [
          key.slice(deletionPrefix.length),
          JSON.parse(String(doc.fields[key])),
        ]),
    );
  const collections = {
    catalogue: (row) => plannerCourseKey(row.id),
    offerings: (row) => row.id,
    enrollments: (row) => row.offering_id,
    overrides: (row) => [
      row.target_kind,
      row.course_namespace,
      row.course_local,
      row.offering_id,
      row.value_kind,
    ],
    custom_course_ids: plannerCourseKey,
    custom_categories: (row) => plannerCourseKey(row.course),
  };
  const scalarFields = new Set([
    "version",
    "program_id",
    "advancement_year",
    "timetable_grade",
    "selected_term",
    "visible_days",
    "visible_periods",
    "next_custom_course_number",
  ]);
  const normalize = (source) => {
    if (source.version !== 1) throw new Error("未対応の保存データ形式です");
    const result = {};
    for (const [field, value] of Object.entries(source)) {
      if (Object.hasOwn(collections, field)) {
        const rows = {};
        const identities = new Set();
        for (const row of value) {
          const key = JSON.stringify(collections[field](row));
          if (Object.hasOwn(rows, key))
            throw new Error("保存データのIDが重複しています");
          // The domain identity ignores fields that the storage key keeps for
          // compatibility. Reject a source the decoder would reject as a
          // duplicate override before it reaches Automerge.
          if (field === "overrides") {
            const identity = JSON.stringify(overrideIdentity(row));
            if (identities.has(identity))
              throw new Error("上書きが重複しています");
            identities.add(identity);
          }
          rows[key] = JSON.stringify(row);
        }
        result[field] = rows;
      } else {
        if (!scalarFields.has(field)) throw new Error("未対応の保存項目です");
        result[field] = JSON.stringify(value);
      }
    }
    return result;
  };
  const atomic = (value) => new A.ImmutableString(value);
  const update = (previous, text) => {
    const source = normalize(JSON.parse(text));
    const doc =
      previous ??
      A.from({ version: 1, fields: {}, collections: {}, orders: {} });
    const tombstones = deletedCourses(doc);
    if (
      Object.keys(source.custom_course_ids ?? {}).some((key) =>
        Object.hasOwn(tombstones, key),
      )
    ) {
      throw new Error(
        "削除済みの独自科目を再保存できません。再読み込みしてください",
      );
    }
    const removed = Object.keys(doc.collections.custom_course_ids ?? {}).filter(
      (key) => !Object.hasOwn(source.custom_course_ids, key),
    );
    return A.change(A.clone(doc), (draft) => {
      for (const key of removed) {
        const offeringIds = Object.values(doc.collections.offerings)
          .map((value) => JSON.parse(String(value)))
          .filter(
            (row) =>
              row.course_id &&
              JSON.stringify(plannerCourseKey(row.course_id)) === key,
          )
          .map((row) => row.id);
        draft.fields[deletionPrefix + key] = atomic(
          JSON.stringify(offeringIds),
        );
      }
      for (const [field, value] of Object.entries(source)) {
        if (Object.hasOwn(collections, field)) {
          if (!draft.collections[field]) draft.collections[field] = {};
          const rows = draft.collections[field];
          const order = JSON.stringify(Object.keys(value));
          if (String(draft.orders[field]) !== order)
            draft.orders[field] = atomic(order);
          for (const key of Object.keys(rows)) {
            if (!Object.hasOwn(value, key)) delete rows[key];
          }
          for (const [key, record] of Object.entries(value)) {
            if (String(rows[key]) !== record) rows[key] = atomic(record);
          }
        } else if (String(draft.fields[field]) !== value) {
          draft.fields[field] = atomic(value);
        }
      }
    });
  };
  const text = (doc) => {
    if (doc.version !== 1) throw new Error("未対応の保存データ形式です");
    const source = {};
    for (const key of Object.keys(doc.fields).toSorted()) {
      if (key.startsWith(deletionPrefix)) continue;
      if (!scalarFields.has(key)) throw new Error("未対応の保存項目です");
      source[key] = JSON.parse(String(doc.fields[key]));
    }
    for (const field of Object.keys(doc.collections).toSorted()) {
      if (!Object.hasOwn(collections, field))
        throw new Error("未対応の保存データ形式です");
      const rows = doc.collections[field];
      const order = JSON.parse(String(doc.orders[field]));
      const keys = [
        ...order.filter((key) => Object.hasOwn(rows, key)),
        ...Object.keys(rows)
          .filter((key) => !order.includes(key))
          .toSorted(),
      ];
      source[field] = keys.map((key) => JSON.parse(String(rows[key])));
    }
    // Delete wins across the entire custom entity, including records edited or
    // enrolled concurrently. Keep the tombstone in history to prevent revival.
    const tombstones = deletedCourses(doc);
    const deleted = new Set(Object.keys(tombstones));
    if (deleted.size > 0) {
      const courseDeleted = (id) =>
        deleted.has(JSON.stringify(plannerCourseKey(id)));
      const offerings = new Set(Object.values(tombstones).flat());
      for (const row of source.offerings) {
        if (row.course_id && courseDeleted(row.course_id))
          offerings.add(row.id);
      }
      source.catalogue = source.catalogue.filter(
        (row) => !courseDeleted(row.id),
      );
      source.offerings = source.offerings.filter(
        (row) => !offerings.has(row.id),
      );
      source.enrollments = source.enrollments.filter(
        (row) => !offerings.has(row.offering_id),
      );
      source.custom_course_ids = source.custom_course_ids.filter(
        (id) => !courseDeleted(id),
      );
      source.custom_categories = source.custom_categories.filter(
        (row) => !courseDeleted(row.course),
      );
      source.overrides = source.overrides.filter(
        (row) =>
          !offerings.has(row.offering_id) &&
          !courseDeleted({
            namespace_part: row.course_namespace,
            local_part: row.course_local,
          }),
      );
    }
    return JSON.stringify(source);
  };
  globalThis.tanikunDocument = { update, text };
}
