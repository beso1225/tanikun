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

///|
test "single-part id validation reports blank before control" {
  // U+2028 is both Unicode whitespace and a line separator/control character.
  assert_empty_offering_id(@tanikun-domain.OfferingId::new("\u{2028}"))
  assert_empty_program_id(@tanikun-domain.ProgramId::new("\u{2028}"))
  assert_empty_category_id(@tanikun-domain.CategoryId::new("\u{2028}"))
}
