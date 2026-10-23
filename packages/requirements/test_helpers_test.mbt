///|
fn[T] expect_ok(
  result : Result[T, @tanikun-domain.DomainError],
) -> T raise Error {
  match result {
    Ok(value) => value
    Err(_) => fail("expected Ok")
  }
}

///|
fn[T] expect_error(
  result : Result[T, @tanikun-domain.DomainError],
) -> @tanikun-domain.DomainError raise Error {
  match result {
    Ok(_) => fail("expected an error")
    Err(error) => error
  }
}

///|
fn[T] expect_some(value : T?) -> T raise Error {
  match value {
    Some(value) => value
    None => fail("expected Some")
  }
}

///|
fn assert_same_category_id(
  actual : @tanikun-domain.CategoryId,
  expected : @tanikun-domain.CategoryId,
) -> Unit raise Error {
  assert_true(actual == expected)
  assert_eq(actual.value, expected.value)
}

///|
fn assert_same_course_id(
  actual : @tanikun-domain.CourseId,
  expected : @tanikun-domain.CourseId,
) -> Unit raise Error {
  assert_true(actual == expected)
}

///|
fn[T] assert_empty_category_name(
  result : Result[T, @tanikun-domain.DomainError],
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::EmptyCategoryName => ()
    _ => fail("expected EmptyCategoryName")
  }
}

///|
fn[T] assert_duplicate_category_id(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.CategoryId,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::DuplicateCategoryId(id~) =>
      assert_same_category_id(id, expected)
    _ => fail("expected DuplicateCategoryId")
  }
}

///|
fn[T] assert_unknown_category(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.CategoryId,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::UnknownCategory(id~) =>
      assert_same_category_id(id, expected)
    _ => fail("expected UnknownCategory")
  }
}

///|
fn[T] assert_duplicate_category_assignment(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.CourseId,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::DuplicateCategoryAssignment(course_id~) =>
      assert_same_course_id(course_id, expected)
    _ => fail("expected DuplicateCategoryAssignment")
  }
}

///|
fn[T] assert_duplicate_requirement_set(
  result : Result[T, @tanikun-domain.DomainError],
  expected_program : @tanikun-domain.ProgramId,
  expected_year : @tanikun-domain.AcademicYear,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::DuplicateRequirementSet(
      program_id~,
      advancement_year~
    ) => {
      assert_true(program_id == expected_program)
      assert_true(advancement_year == expected_year)
    }
    _ => fail("expected DuplicateRequirementSet")
  }
}

///|
fn[T] assert_invalid_rule_threshold(
  result : Result[T, @tanikun-domain.DomainError],
  expected_half_units : Int,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::InvalidRuleThreshold(credits~) =>
      assert_eq(credits.half_units(), expected_half_units)
    _ => fail("expected InvalidRuleThreshold")
  }
}

///|
fn[T] assert_empty_rule_categories(
  result : Result[T, @tanikun-domain.DomainError],
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::EmptyRuleCategories => ()
    _ => fail("expected EmptyRuleCategories")
  }
}

///|
fn[T] assert_duplicate_rule_category(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.CategoryId,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::DuplicateRuleCategory(id~) =>
      assert_same_category_id(id, expected)
    _ => fail("expected DuplicateRuleCategory")
  }
}

///|
fn[T] assert_unknown_rule_category(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.CategoryId,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::UnknownRuleCategory(id~) =>
      assert_same_category_id(id, expected)
    _ => fail("expected UnknownRuleCategory")
  }
}

///|
fn[T] assert_empty_rule_courses(
  result : Result[T, @tanikun-domain.DomainError],
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::EmptyRuleCourses => ()
    _ => fail("expected EmptyRuleCourses")
  }
}

///|
fn[T] assert_duplicate_rule_course(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.CourseId,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::DuplicateRuleCourse(course_id~) =>
      assert_same_course_id(course_id, expected)
    _ => fail("expected DuplicateRuleCourse")
  }
}

///|
fn[T] assert_unknown_rule_course(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.CourseId,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::UnknownRuleCourse(course_id~) =>
      assert_same_course_id(course_id, expected)
    _ => fail("expected UnknownRuleCourse")
  }
}

///|
fn[T] assert_empty_rule_children(
  result : Result[T, @tanikun-domain.DomainError],
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::EmptyRuleChildren => ()
    _ => fail("expected EmptyRuleChildren")
  }
}

///|
fn[T] assert_invalid_at_least_count(
  result : Result[T, @tanikun-domain.DomainError],
  expected_count : Int,
  expected_child_count : Int,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::InvalidAtLeastCount(
      count~,
      child_count~,
    ) => {
      assert_eq(count, expected_count)
      assert_eq(child_count, expected_child_count)
    }
    _ => fail("expected InvalidAtLeastCount")
  }
}
