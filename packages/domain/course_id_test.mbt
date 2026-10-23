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
  assert_empty_course_namespace(
    @tanikun-domain.CourseId::new("\u{3000}", "PHY101"),
  )
  assert_empty_course_local(@tanikun-domain.CourseId::new("master", "\u{00A0}"))
}

///|
test "course id rejects control characters" {
  assert_control_character_course_namespace(
    @tanikun-domain.CourseId::new("master\n", "PHY101"),
  )
  assert_control_character_course_namespace(
    @tanikun-domain.CourseId::new("master\u{2028}", "PHY101"),
  )
  assert_control_character_course_local(
    @tanikun-domain.CourseId::new("master", "PHY\u{0085}101"),
  )
}

///|
test "course id equality uses the stored parts" {
  let first = expect_ok(@tanikun-domain.CourseId::new("master", "PHY101"))
  let same = expect_ok(@tanikun-domain.CourseId::new("master", "PHY101"))
  let other = expect_ok(@tanikun-domain.CourseId::new("master", "PHY102"))
  assert_true(first == same)
  assert_true(first != other)
}

///|
test "course id comparison is lexicographic" {
  let later = expect_ok(@tanikun-domain.CourseId::new("master", "PHY102"))
  let earlier = expect_ok(@tanikun-domain.CourseId::new("master", "PHY101"))
  let short_local = expect_ok(@tanikun-domain.CourseId::new("master", "PHY2"))
  let long_local = expect_ok(@tanikun-domain.CourseId::new("master", "PHY10"))
  assert_true(earlier < later)
  assert_true(later > earlier)
  assert_eq(earlier.compare(earlier), 0)
  // Lexicographic, not shortlex: PHY10 sorts before PHY2.
  assert_true(long_local < short_local)
}

///|
test "course id compares namespaces before local parts" {
  let alpha = expect_ok(@tanikun-domain.CourseId::new("alpha", "PHY999"))
  let beta = expect_ok(@tanikun-domain.CourseId::new("beta", "PHY000"))
  assert_true(alpha < beta)
  assert_true(beta > alpha)
  assert_true(alpha.compare(beta) < 0)
  assert_eq(alpha.compare(alpha), 0)
}
