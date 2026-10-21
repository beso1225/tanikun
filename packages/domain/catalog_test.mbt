///|
fn catalog_course(
  local_part : String,
  name : String,
  status : @tanikun-domain.CourseStatus,
) -> @tanikun-domain.Course raise Error {
  let id = expect_ok(@tanikun-domain.CourseId::new("master", local_part))
  let credits = expect_ok(@tanikun-domain.Credits::new(2))
  expect_ok(@tanikun-domain.Course::new(id, name, credits, status))
}

///|
test "same name with different ids stays distinct" {
  let first = catalog_course(
    "PHY101",
    "Physics",
    @tanikun-domain.CourseStatus::Active,
  )
  let second = catalog_course(
    "PHY102",
    "Physics",
    @tanikun-domain.CourseStatus::Active,
  )
  let first_id = first.id
  let second_id = second.id
  let catalog = expect_ok(@tanikun-domain.CourseCatalog::new([first, second]))
  assert_eq(catalog.len(), 2)
  assert_same_id(expect_some(catalog.lookup(first_id)).id, first_id)
  assert_same_id(expect_some(catalog.lookup(second_id)).id, second_id)
}

///|
test "duplicate course ids are rejected" {
  let first = catalog_course(
    "PHY101",
    "Physics",
    @tanikun-domain.CourseStatus::Active,
  )
  let duplicate = catalog_course(
    "PHY101",
    "Physics II",
    @tanikun-domain.CourseStatus::Retired,
  )
  let expected_id = first.id
  assert_duplicate_course_id(
    @tanikun-domain.CourseCatalog::new([first, duplicate]),
    expected_id,
  )
}

///|
test "retired courses remain referenceable" {
  let retired = catalog_course(
    "PHY101",
    "Physics",
    @tanikun-domain.CourseStatus::Retired,
  )
  let retired_id = retired.id
  let catalog = expect_ok(@tanikun-domain.CourseCatalog::new([retired]))
  let found = expect_some(catalog.lookup(retired_id))
  assert_same_id(found.id, retired_id)
  match found.status {
    @tanikun-domain.CourseStatus::Retired => ()
    @tanikun-domain.CourseStatus::Active =>
      fail("expected the catalog entry to stay retired")
  }
}

///|
test "catalog orders courses by id and looks them up deterministically" {
  let later = catalog_course(
    "PHY102",
    "Physics II",
    @tanikun-domain.CourseStatus::Active,
  )
  let earlier = catalog_course(
    "PHY101",
    "Physics",
    @tanikun-domain.CourseStatus::Active,
  )
  let later_id = later.id
  let earlier_id = earlier.id
  let catalog = expect_ok(@tanikun-domain.CourseCatalog::new([later, earlier]))
  let courses = catalog.courses()
  assert_same_id(courses[0].id, earlier_id)
  assert_same_id(courses[1].id, later_id)
  assert_same_id(expect_some(catalog.lookup(earlier_id)).id, earlier_id)
  assert_same_id(expect_some(catalog.lookup(earlier_id)).id, earlier_id)
}

///|
test "rename updates the catalog entry without changing its id" {
  let original = catalog_course(
    "PHY101",
    "Physics",
    @tanikun-domain.CourseStatus::Active,
  )
  let original_id = original.id
  let renamed = expect_ok(original.rename("Applied Physics"))
  let catalog = expect_ok(@tanikun-domain.CourseCatalog::new([renamed]))
  let found = expect_some(catalog.lookup(original_id))
  assert_same_id(found.id, original_id)
  assert_eq(found.name, "Applied Physics")
}
