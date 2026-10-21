///|
test "course id keeps namespace and local parts" {
  let id = expect_ok(@tanikun-domain.CourseId::new("master", "PHY101"))
  assert_eq(id.namespace_part, "master")
  assert_eq(id.local_part, "PHY101")
}

///|
test "course id rejects empty and whitespace parts" {
  assert_empty_course_namespace(@tanikun-domain.CourseId::new("", "PHY101"))
  assert_empty_course_local(@tanikun-domain.CourseId::new("master", "  "))
}

///|
test "course id rejects control characters" {
  assert_control_character_course_namespace(
    @tanikun-domain.CourseId::new("master\n", "PHY101"),
  )
}

///|
test "course id equality uses the stored parts" {
  let first = expect_ok(@tanikun-domain.CourseId::new("master", "PHY101"))
  let same = expect_ok(@tanikun-domain.CourseId::new("master", "PHY101"))
  let other = expect_ok(@tanikun-domain.CourseId::new("master", "PHY102"))
  assert_same_id(first, same)
  assert_false(first.equals(other))
}
