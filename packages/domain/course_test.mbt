///|
fn make_course(
  local_part : String,
  name : String,
  credits : @tanikun-domain.Credits,
  status : @tanikun-domain.CourseStatus,
) -> @tanikun-domain.Course raise Error {
  let id = expect_ok(@tanikun-domain.CourseId::new("master", local_part))
  expect_ok(@tanikun-domain.Course::new(id, name, credits, status))
}

///|
test "course rejects an empty display name" {
  let credits = expect_ok(@tanikun-domain.Credits::new(2))
  let id = expect_ok(@tanikun-domain.CourseId::new("master", "PHY101"))
  assert_empty_course_name(
    @tanikun-domain.Course::new(
      id,
      "  ",
      credits,
      @tanikun-domain.CourseStatus::Active,
    ),
  )
}

///|
test "course rename keeps the course identity" {
  let original = make_course(
    "PHY101",
    "Physics",
    expect_ok(@tanikun-domain.Credits::new(2)),
    @tanikun-domain.CourseStatus::Active,
  )
  let renamed = expect_ok(original.rename("Applied Physics"))
  assert_same_id(renamed.id, original.id)
  assert_eq(renamed.name, "Applied Physics")
  assert_eq(original.name, "Physics")
}

///|
test "course rename rejects an empty display name" {
  let original = make_course(
    "PHY101",
    "Physics",
    expect_ok(@tanikun-domain.Credits::new(2)),
    @tanikun-domain.CourseStatus::Active,
  )
  assert_empty_course_name(original.rename("  "))
}

///|
test "retired course keeps its status" {
  let retired = make_course(
    "PHY101",
    "Physics",
    expect_ok(@tanikun-domain.Credits::new(2)),
    @tanikun-domain.CourseStatus::Retired,
  )
  match retired.status {
    @tanikun-domain.CourseStatus::Retired => ()
    @tanikun-domain.CourseStatus::Active =>
      fail("expected the course to stay retired")
  }
}
