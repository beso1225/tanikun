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
fn assert_same_id(
  actual : @tanikun-domain.CourseId,
  expected : @tanikun-domain.CourseId,
) -> Unit raise Error {
  assert_true(actual == expected)
  assert_eq(actual.namespace_part, expected.namespace_part)
  assert_eq(actual.local_part, expected.local_part)
}

///|
fn[T] assert_invalid_credits(
  result : Result[T, @tanikun-domain.DomainError],
  expected : Int,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::InvalidCredits(half_units~) =>
      assert_eq(half_units, expected)
    _ => fail("expected InvalidCredits")
  }
}

///|
fn[T] assert_empty_course_namespace(
  result : Result[T, @tanikun-domain.DomainError],
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::EmptyIdField(
      kind=@tanikun-domain.IdKind::Course,
      field=@tanikun-domain.IdField::Namespace
    ) => ()
    _ => fail("expected an empty course namespace")
  }
}

///|
fn[T] assert_empty_course_local(
  result : Result[T, @tanikun-domain.DomainError],
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::EmptyIdField(
      kind=@tanikun-domain.IdKind::Course,
      field=@tanikun-domain.IdField::Local
    ) => ()
    _ => fail("expected an empty course local part")
  }
}

///|
fn[T] assert_control_character_course_namespace(
  result : Result[T, @tanikun-domain.DomainError],
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::ControlCharacterInId(
      kind=@tanikun-domain.IdKind::Course,
      field=@tanikun-domain.IdField::Namespace
    ) => ()
    _ => fail("expected a control character in the course namespace")
  }
}

///|
fn[T] assert_control_character_course_local(
  result : Result[T, @tanikun-domain.DomainError],
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::ControlCharacterInId(
      kind=@tanikun-domain.IdKind::Course,
      field=@tanikun-domain.IdField::Local
    ) => ()
    _ => fail("expected a control character in the course local part")
  }
}

///|
fn[T] assert_empty_course_name(
  result : Result[T, @tanikun-domain.DomainError],
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::EmptyCourseName => ()
    _ => fail("expected EmptyCourseName")
  }
}

///|
fn[T] assert_duplicate_course_id(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.CourseId,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::DuplicateCourseId(id~) =>
      assert_same_id(id, expected)
    _ => fail("expected DuplicateCourseId")
  }
}

///|
fn[T] assert_invalid_academic_year(
  result : Result[T, @tanikun-domain.DomainError],
  expected : Int,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::InvalidAcademicYear(year~) =>
      assert_eq(year, expected)
    _ => fail("expected InvalidAcademicYear")
  }
}

///|
fn[T] assert_invalid_period(
  result : Result[T, @tanikun-domain.DomainError],
  expected : Int,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::InvalidPeriod(value~) =>
      assert_eq(value, expected)
    _ => fail("expected InvalidPeriod")
  }
}

///|
fn[T] assert_empty_offering_id(
  result : Result[T, @tanikun-domain.DomainError],
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::EmptyIdField(
      kind=@tanikun-domain.IdKind::Offering,
      field=@tanikun-domain.IdField::Value
    ) => ()
    _ => fail("expected an empty offering ID")
  }
}

///|
fn[T] assert_control_character_offering_id(
  result : Result[T, @tanikun-domain.DomainError],
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::ControlCharacterInId(
      kind=@tanikun-domain.IdKind::Offering,
      field=@tanikun-domain.IdField::Value
    ) => ()
    _ => fail("expected a control character in an offering ID")
  }
}

///|
fn[T] assert_empty_offering_terms(
  result : Result[T, @tanikun-domain.DomainError],
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::EmptyOfferingTerms => ()
    _ => fail("expected EmptyOfferingTerms")
  }
}

///|
fn[T] assert_duplicate_offering_term(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.Term,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::DuplicateOfferingTerm(term~) =>
      assert_true(term == expected)
    _ => fail("expected DuplicateOfferingTerm")
  }
}

///|
fn[T] assert_mixed_offering_terms(
  result : Result[T, @tanikun-domain.DomainError],
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::MixedOfferingTerms => ()
    _ => fail("expected MixedOfferingTerms")
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
fn[T] assert_unexpected_offering_slots(
  result : Result[T, @tanikun-domain.DomainError],
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::UnexpectedOfferingSlots => ()
    _ => fail("expected UnexpectedOfferingSlots")
  }
}

///|
fn[T] assert_duplicate_offering_slot(
  result : Result[T, @tanikun-domain.DomainError],
  expected : @tanikun-domain.Slot,
) -> Unit raise Error {
  match expect_error(result) {
    @tanikun-domain.DomainError::DuplicateOfferingSlot(slot~) =>
      assert_true(slot == expected)
    _ => fail("expected DuplicateOfferingSlot")
  }
}
