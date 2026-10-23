///|
test "all id types reject every Unicode whitespace" {
  for value in unicode_whitespace_values() {
    assert_empty_course_namespace(
      @tanikun-domain.CourseId::new(value, "PHY101"),
    )
    assert_empty_course_local(@tanikun-domain.CourseId::new("master", value))
    assert_empty_offering_id(@tanikun-domain.OfferingId::new(value))
    assert_empty_category_id(@tanikun-domain.CategoryId::new(value))
    assert_empty_program_id(@tanikun-domain.ProgramId::new(value))
  }
}
