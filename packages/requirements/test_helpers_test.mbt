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
