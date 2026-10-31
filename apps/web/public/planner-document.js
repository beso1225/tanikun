// Atomic records keep grades and passed snapshots together. Collections use
// stable entity keys so unrelated additions and deletions merge independently.
const plannerCourseKey = (id) => [id.namespace_part, id.local_part];
{
  const A = globalThis.Automerge;
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
        for (const row of value) {
          const key = JSON.stringify(collections[field](row));
          if (Object.hasOwn(rows, key))
            throw new Error("保存データのIDが重複しています");
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
    return A.change(A.clone(doc), (draft) => {
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
    return JSON.stringify(source);
  };
  globalThis.tanikunDocument = { update, text };
}
