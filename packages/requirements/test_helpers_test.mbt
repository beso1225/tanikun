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
    @tanikun-domain.DomainError::InvalidAtLeastCount(count~, child_count~) => {
      assert_eq(count, expected_count)
      assert_eq(child_count, expected_child_count)
    }
    _ => fail("expected InvalidAtLeastCount")
  }
}

///|
fn[T] assert_duplicate_course_id(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.CourseId,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::DuplicateCourseId(id~) =>
      assert_same_course_id(id, expected)
    _ => fail("expected DuplicateCourseId")
  }
}

///|
fn[T] assert_duplicate_offering_id(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.OfferingId,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::DuplicateOfferingId(id~) =>
      assert_eq(id.value, expected.value)
    _ => fail("expected DuplicateOfferingId")
  }
}

///|
fn[T] assert_duplicate_enrollment(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.OfferingId,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::DuplicateEnrollment(offering_id~) =>
      assert_eq(offering_id.value, expected.value)
    _ => fail("expected DuplicateEnrollment")
  }
}

///|
fn[T] assert_unknown_offering(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.OfferingId,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::UnknownOffering(offering_id~) =>
      assert_eq(offering_id.value, expected.value)
    _ => fail("expected UnknownOffering")
  }
}

///|
fn[T] assert_unknown_course(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.CourseId,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::UnknownCourse(course_id~) =>
      assert_same_course_id(course_id, expected)
    _ => fail("expected UnknownCourse")
  }
}

///|
fn[T] assert_duplicate_passed_course(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.CourseId,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::DuplicatePassedCourse(course_id~) =>
      assert_same_course_id(course_id, expected)
    _ => fail("expected DuplicatePassedCourse")
  }
}

///|
fn[T] assert_profile_requirement_set_mismatch(
  result : Result[T, @tanikun-domain.DomainError],
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::ProfileRequirementSetMismatch => ()
    _ => fail("expected ProfileRequirementSetMismatch")
  }
}

///|
fn[T] assert_retired_course_enrollment(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.CourseId,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::RetiredCourseEnrollment(course_id~) =>
      assert_same_course_id(course_id, expected)
    _ => fail("expected RetiredCourseEnrollment")
  }
}

///|
fn[T] assert_not_offered_enrollment(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.OfferingId,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::NotOfferedEnrollment(offering_id~) =>
      assert_eq(offering_id.value, expected.value)
    _ => fail("expected NotOfferedEnrollment")
  }
}

///|
fn[T] assert_passed_snapshot_course_mismatch(
  result : Result[T, @tanikun-domain.DomainError],
  expected_offering : @tanikun-domain.OfferingId,
  expected_snapshot_course : @tanikun-domain.CourseId,
  expected_offering_course : @tanikun-domain.CourseId,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::PassedSnapshotCourseMismatch(
      offering_id~,
      snapshot_course_id~,
      offering_course_id~
    ) => {
      assert_eq(offering_id.value, expected_offering.value)
      assert_same_course_id(snapshot_course_id, expected_snapshot_course)
      assert_same_course_id(offering_course_id, expected_offering_course)
    }
    _ => fail("expected PassedSnapshotCourseMismatch")
  }
}

///|
fn[T] assert_missing_offering_slots(
  result : Result[T, @tanikun-domain.DomainError],
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::MissingOfferingSlots => ()
    _ => fail("expected MissingOfferingSlots")
  }
}

///|
fn[T] assert_duplicate_offering_slot(
  result : Result[T, @tanikun-domain.DomainError],
  expected_day : @tanikun-domain.DayOfWeek,
  expected_period : Int,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::DuplicateOfferingSlot(slot~) => {
      assert_true(slot.day == expected_day)
      assert_eq(slot.period.value, expected_period)
    }
    _ => fail("expected DuplicateOfferingSlot")
  }
}

///|
fn[T] assert_unknown_enrollment(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.OfferingId,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::UnknownEnrollment(offering_id~) =>
      assert_eq(offering_id.value, expected.value)
    _ => fail("expected UnknownEnrollment")
  }
}
