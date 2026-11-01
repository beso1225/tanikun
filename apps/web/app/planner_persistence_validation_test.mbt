///|
fn persistence_valid_dto() -> @app.PersistedPlan raise {
  let text = @app.encode_planner_state(persistence_full_state())
  @json.from_json(@json.parse(text))
}

///|
fn persistence_expect_rejected(
  text : String,
  expected : String,
) -> Unit raise Error {
  let base = persistence_full_state()
  let before = @app.encode_planner_state(base)
  match @app.decode_planner_state(base, text) {
    Ok(_) => fail("expected the document to be rejected: \{expected}")
    Err(message) => assert_eq(message, expected)
  }
  assert_eq(@app.encode_planner_state(base), before)
}

///|
test "duplicate identities are rejected with their specific messages" {
  let dto = persistence_valid_dto()
  persistence_expect_rejected(
    { ..dto, catalogue: [dto.catalogue[0], dto.catalogue[0]], }
    .to_json()
    .stringify(),
    "科目IDが重複しています",
  )
  persistence_expect_rejected(
    { ..dto, offerings: [dto.offerings[0], dto.offerings[0]], }
    .to_json()
    .stringify(),
    "開講IDが重複しています",
  )
  persistence_expect_rejected(
    { ..dto, enrollments: [dto.enrollments[0], dto.enrollments[0]], }
    .to_json()
    .stringify(),
    "履修が重複しています",
  )
  persistence_expect_rejected(
    { ..dto, overrides: [dto.overrides[0], dto.overrides[0]], }
    .to_json()
    .stringify(),
    "上書きが重複しています",
  )
}

///|
test "broken references are rejected after the decoded records" {
  let dto = persistence_valid_dto()
  let missing_course = {
    ..dto.offerings[0],
    course_id: { namespace_part: "master", local_part: "missing", },
  }
  let offerings = dto.offerings.copy()
  offerings[0] = missing_course
  persistence_expect_rejected(
    { ..dto, offerings, }.to_json().stringify(),
    "開講の科目がありません",
  )
  let enrollments = dto.enrollments.copy()
  enrollments[0] = { ..enrollments[0], offering_id: "missing-offering", }
  persistence_expect_rejected(
    { ..dto, enrollments, }.to_json().stringify(),
    "履修の開講がありません",
  )
  let overrides = dto.overrides.copy()
  overrides[0] = { ..overrides[0], course_local: "missing", }
  persistence_expect_rejected(
    { ..dto, overrides, }.to_json().stringify(),
    "上書き対象の科目がありません",
  )
  persistence_expect_rejected(
    { ..dto, program_id: "other-program", }.to_json().stringify(),
    "対象の要件セットがありません",
  )
}

///|
test "invalid tags, references, and display ranges keep their messages" {
  let dto = persistence_valid_dto()
  persistence_expect_rejected(
    { ..dto, selected_term: "XX", }.to_json().stringify(),
    "選択学期が正しくありません",
  )
  persistence_expect_rejected(
    { ..dto, timetable_grade: 9, }.to_json().stringify(),
    "表示学年が正しくありません",
  )
  persistence_expect_rejected(
    { ..dto, visible_days: 4, }.to_json().stringify(),
    "表示日数が正しくありません",
  )
  persistence_expect_rejected(
    { ..dto, visible_periods: 11, }.to_json().stringify(),
    "表示時限が正しくありません",
  )
  persistence_expect_rejected(
    { ..dto, next_custom_course_number: 0, }.to_json().stringify(),
    "独自科目の採番が正しくありません",
  )
  let catalogue = dto.catalogue.copy()
  catalogue[0] = { ..catalogue[0], status: "unknown", }
  persistence_expect_rejected(
    { ..dto, catalogue, }.to_json().stringify(),
    "科目状態が正しくありません",
  )
  let offerings = dto.offerings.copy()
  offerings[0] = { ..offerings[0], schedule: "unknown", }
  persistence_expect_rejected(
    { ..dto, offerings, }.to_json().stringify(),
    "開講形態が正しくありません",
  )
  let offerings = dto.offerings.copy()
  offerings[0] = { ..offerings[0], status: "unknown", }
  persistence_expect_rejected(
    { ..dto, offerings, }.to_json().stringify(),
    "開講状態が正しくありません",
  )
  let enrollments = dto.enrollments.copy()
  enrollments[0] = { ..enrollments[0], status: "unknown", }
  persistence_expect_rejected(
    { ..dto, enrollments, }.to_json().stringify(),
    "履修状態が正しくありません",
  )
  let enrollments = dto.enrollments.copy()
  enrollments[2] = { ..enrollments[2], passing_grade: "unknown", }
  persistence_expect_rejected(
    { ..dto, enrollments, }.to_json().stringify(),
    "成績が正しくありません",
  )
  let offerings = dto.offerings.copy()
  let slots = offerings[0].slots.copy()
  slots[0] = { ..slots[0], day: "Funday", }
  offerings[0] = { ..offerings[0], slots, }
  persistence_expect_rejected(
    { ..dto, offerings, }.to_json().stringify(),
    "曜日が正しくありません",
  )
  let offerings = dto.offerings.copy()
  let slots = offerings[0].slots.copy()
  slots[0] = { ..slots[0], period: 0, }
  offerings[0] = { ..offerings[0], slots, }
  persistence_expect_rejected(
    { ..dto, offerings, }.to_json().stringify(),
    "時限が正しくありません",
  )
}

///|
test "custom membership invariants are rejected" {
  let dto = persistence_valid_dto()
  persistence_expect_rejected(
    { ..dto, custom_course_ids: [], }.to_json().stringify(),
    "独自科目が独自科目IDにありません",
  )
  let offerings = dto.offerings.copy()
  let custom_index = offerings.length() - 1
  let without_custom_offering = []
  for index in 0..<offerings.length() {
    if index != custom_index {
      without_custom_offering.push(offerings[index])
    }
  }
  persistence_expect_rejected(
    { ..dto, offerings: without_custom_offering, }.to_json().stringify(),
    "独自科目の開講がありません",
  )
  let catalogue = []
  let custom_course_id = dto.custom_course_ids[0]
  for course in dto.catalogue {
    if course.id != custom_course_id {
      catalogue.push(course)
    }
  }
  let without_custom_course = []
  for offering in without_custom_offering {
    if offering.course_id != custom_course_id {
      without_custom_course.push(offering)
    }
  }
  persistence_expect_rejected(
    { ..dto, catalogue, offerings: without_custom_course, }
    .to_json()
    .stringify(),
    "独自科目IDが catalogue にありません",
  )
  let categories = dto.custom_categories.copy()
  categories[0] = {
    ..categories[0],
    course: { namespace_part: "user", local_part: "missing", },
  }
  persistence_expect_rejected(
    { ..dto, custom_categories: categories, }.to_json().stringify(),
    "独自区分の科目がありません",
  )
  let categories = dto.custom_categories.copy()
  categories[0] = { ..categories[0], category: "missing", }
  persistence_expect_rejected(
    { ..dto, custom_categories: categories, }.to_json().stringify(),
    "独自区分の区分がありません",
  )
}
