///|
fn correction_input() -> @tanikun-requirements.EvaluationInput[
  @tanikun-requirements.Rule,
] raise Error {
  let course = credit_course("PHY101", 4)
  credit_input(
    credit_requirement_set([], []),
    [course],
    [credit_offering("offering-1", course.id)],
    [in_progress_enrollment("offering-1")],
    @tanikun-domain.Overrides::empty(),
  )
}

///|
fn correction_passed(
  offering_id : String,
  course : @tanikun-domain.Course,
  half_units : Int,
) -> @tanikun-domain.Enrollment raise Error {
  let snapshot = expect_ok(
    @tanikun-domain.PassedCourseSnapshot::new(
      course.id,
      course.name,
      credit_value(half_units),
    ),
  )
  @tanikun-domain.Enrollment::passed(
    expect_ok(@tanikun-domain.OfferingId::new(offering_id)),
    @tanikun-domain.PassingGrade::Good,
    snapshot,
  )
}

///|
test "correction replaces an enrollment without mutating the input" {
  let input = correction_input()
  let course = credit_course("PHY101", 4)
  let corrected = correction_passed("offering-1", course, 4)
  let updated = expect_ok(
    @tanikun-requirements.correct_enrollment(
      input,
      expect_ok(@tanikun-domain.OfferingId::new("offering-1")),
      corrected,
    ),
  )
  let before = expect_ok(@tanikun-requirements.evaluate(input))
  let after = expect_ok(@tanikun-requirements.evaluate(updated))
  assert_eq(before.credits.confirmed.total.half_units(), 0)
  assert_eq(before.credits.standard.total.half_units(), 4)
  assert_eq(after.credits.confirmed.total.half_units(), 4)
  assert_eq(after.credits.standard.total.half_units(), 4)
  // The original input is unchanged after constructing the correction.
  let again = expect_ok(@tanikun-requirements.evaluate(input))
  assert_eq(again.credits.confirmed.total.half_units(), 0)
}

///|
test "correction rejects an unknown previous offering" {
  let input = correction_input()
  let course = credit_course("PHY101", 4)
  assert_unknown_enrollment(
    @tanikun-requirements.correct_enrollment(
      input,
      expect_ok(@tanikun-domain.OfferingId::new("missing")),
      correction_passed("offering-1", course, 4),
    ),
    expect_ok(@tanikun-domain.OfferingId::new("missing")),
  )
}

///|
test "correction rejects a duplicate corrected offering" {
  let course = credit_course("PHY101", 4)
  let input = credit_input(
    credit_requirement_set([], []),
    [course],
    [
      credit_offering("offering-1", course.id),
      credit_offering("offering-2", course.id),
    ],
    [planned_enrollment("offering-1"), planned_enrollment("offering-2")],
    @tanikun-domain.Overrides::empty(),
  )
  assert_duplicate_enrollment(
    @tanikun-requirements.correct_enrollment(
      input,
      expect_ok(@tanikun-domain.OfferingId::new("offering-1")),
      planned_enrollment("offering-2"),
    ),
    expect_ok(@tanikun-domain.OfferingId::new("offering-2")),
  )
}

///|
test "correction validates the corrected enrollment" {
  let input = correction_input()
  let other = credit_course("PHY102", 4)
  let snapshot = expect_ok(
    @tanikun-domain.PassedCourseSnapshot::new(
      other.id,
      other.name,
      credit_value(4),
    ),
  )
  let corrected = @tanikun-domain.Enrollment::passed(
    expect_ok(@tanikun-domain.OfferingId::new("offering-1")),
    @tanikun-domain.PassingGrade::Good,
    snapshot,
  )
  assert_passed_snapshot_course_mismatch(
    @tanikun-requirements.correct_enrollment(
      input,
      expect_ok(@tanikun-domain.OfferingId::new("offering-1")),
      corrected,
    ),
    expect_ok(@tanikun-domain.OfferingId::new("offering-1")),
    other.id,
    course_id("PHY101"),
  )
}
