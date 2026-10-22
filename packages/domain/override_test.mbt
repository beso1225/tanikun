///|
fn override_course() -> @tanikun-domain.Course raise Error {
  make_course(
    "PHY101",
    "Physics",
    expect_ok(@tanikun-domain.Credits::new(4)),
    @tanikun-domain.CourseStatus::Active,
  )
}

///|
fn override_credits(half_units : Int) -> @tanikun-domain.Credits raise Error {
  expect_ok(@tanikun-domain.Credits::new(half_units))
}

///|
fn override_target_course(
  course : @tanikun-domain.Course,
) -> @tanikun-domain.OverrideTarget {
  @tanikun-domain.OverrideTarget::Course(course.id)
}

///|
fn override_target_offering(
  offering : @tanikun-domain.CourseOffering,
) -> @tanikun-domain.OverrideTarget {
  @tanikun-domain.OverrideTarget::Offering(offering.id)
}

///|
fn override_set(
  entries : Array[@tanikun-domain.Override],
) -> @tanikun-domain.Overrides raise Error {
  expect_ok(@tanikun-domain.Overrides::new(entries))
}

///|
test "course display name override applies to display and planned enrollments" {
  let course = override_course()
  let entry = expect_ok(
    @tanikun-domain.Override::new(
      override_target_course(course),
      @tanikun-domain.OverrideAttribute::DisplayName,
      @tanikun-domain.OverrideValue::Text("Applied Physics"),
    ),
  )
  let overrides = override_set([entry])
  assert_eq(
    @tanikun-domain.effective_course_name(course, overrides),
    "Applied Physics",
  )
  let planned = @tanikun-domain.Enrollment::planned(enrollment_offering_id())
  assert_eq(
    @tanikun-domain.effective_name(planned, course, overrides),
    "Applied Physics",
  )
}

///|
test "pass snapshot captures active course overrides" {
  let course = override_course()
  let name_override = expect_ok(
    @tanikun-domain.Override::new(
      override_target_course(course),
      @tanikun-domain.OverrideAttribute::DisplayName,
      @tanikun-domain.OverrideValue::Text("Applied Physics"),
    ),
  )
  let credits_override = expect_ok(
    @tanikun-domain.Override::new(
      override_target_course(course),
      @tanikun-domain.OverrideAttribute::Credits,
      @tanikun-domain.OverrideValue::Credits(override_credits(6)),
    ),
  )
  let overrides = override_set([name_override, credits_override])
  let snapshot = expect_ok(
    @tanikun-domain.PassedCourseSnapshot::from_course(course, overrides),
  )
  assert_eq(snapshot.name, "Applied Physics")
  assert_eq(snapshot.credits.half_units(), 6)

  let passed = @tanikun-domain.Enrollment::passed(
    enrollment_offering_id(),
    @tanikun-domain.PassingGrade::Excellent,
    snapshot,
  )
  assert_eq(
    @tanikun-domain.effective_name(passed, course, overrides),
    "Applied Physics",
  )
  assert_eq(
    @tanikun-domain.effective_credits(passed, course, overrides).half_units(),
    6,
  )
}

///|
test "credit override applies before a pass and the snapshot wins after" {
  let course = override_course()
  let entry = expect_ok(
    @tanikun-domain.Override::new(
      override_target_course(course),
      @tanikun-domain.OverrideAttribute::Credits,
      @tanikun-domain.OverrideValue::Credits(override_credits(6)),
    ),
  )
  let overrides = override_set([entry])
  let planned = @tanikun-domain.Enrollment::planned(enrollment_offering_id())
  let in_progress = @tanikun-domain.Enrollment::in_progress(
    enrollment_offering_id(),
  )
  assert_eq(
    @tanikun-domain.effective_credits(planned, course, overrides).half_units(),
    6,
  )
  assert_eq(
    @tanikun-domain.effective_credits(in_progress, course, overrides).half_units(),
    6,
  )

  let snapshot = expect_ok(
    @tanikun-domain.PassedCourseSnapshot::new(
      course.id,
      course.name,
      course.credits,
    ),
  )
  let passed = @tanikun-domain.Enrollment::passed(
    enrollment_offering_id(),
    @tanikun-domain.PassingGrade::Excellent,
    snapshot,
  )
  assert_eq(
    @tanikun-domain.effective_credits(passed, course, overrides).half_units(),
    4,
  )
}

///|
test "display name override does not rewrite a passed snapshot" {
  let course = override_course()
  let entry = expect_ok(
    @tanikun-domain.Override::new(
      override_target_course(course),
      @tanikun-domain.OverrideAttribute::DisplayName,
      @tanikun-domain.OverrideValue::Text("Applied Physics"),
    ),
  )
  let overrides = override_set([entry])
  let snapshot = expect_ok(
    @tanikun-domain.PassedCourseSnapshot::new(
      course.id,
      "Physics",
      course.credits,
    ),
  )
  let passed = @tanikun-domain.Enrollment::passed(
    enrollment_offering_id(),
    @tanikun-domain.PassingGrade::Good,
    snapshot,
  )
  assert_eq(
    @tanikun-domain.effective_name(passed, course, overrides),
    "Physics",
  )
  let planned = @tanikun-domain.Enrollment::planned(enrollment_offering_id())
  assert_eq(
    @tanikun-domain.effective_name(planned, course, overrides),
    "Applied Physics",
  )
}

///|
test "duplicate override target and attribute pairs are rejected" {
  let course = override_course()
  let target = override_target_course(course)
  let first = expect_ok(
    @tanikun-domain.Override::new(
      target,
      @tanikun-domain.OverrideAttribute::DisplayName,
      @tanikun-domain.OverrideValue::Text("Applied Physics"),
    ),
  )
  let second = expect_ok(
    @tanikun-domain.Override::new(
      target,
      @tanikun-domain.OverrideAttribute::DisplayName,
      @tanikun-domain.OverrideValue::Text("Physics II"),
    ),
  )
  assert_duplicate_override(
    @tanikun-domain.Overrides::new([first, second]),
    target,
    @tanikun-domain.OverrideAttribute::DisplayName,
  )
}

///|
test "different attributes on one target are allowed" {
  let course = override_course()
  let target = override_target_course(course)
  let name = expect_ok(
    @tanikun-domain.Override::new(
      target,
      @tanikun-domain.OverrideAttribute::DisplayName,
      @tanikun-domain.OverrideValue::Text("Applied Physics"),
    ),
  )
  let credits = expect_ok(
    @tanikun-domain.Override::new(
      target,
      @tanikun-domain.OverrideAttribute::Credits,
      @tanikun-domain.OverrideValue::Credits(override_credits(6)),
    ),
  )
  let _ = override_set([name, credits])
}

///|
test "invalid override combinations are rejected" {
  let course = override_course()
  let offering = expect_ok(
    make_offering(
      "offering-1",
      @tanikun-domain.OfferingSchedule::YearLong,
      @tanikun-domain.OfferingStatus::Offered,
      [offering_slot(@tanikun-domain.DayOfWeek::Monday, 1)],
    ),
  )
  let course_target = override_target_course(course)
  let offering_target = override_target_offering(offering)
  assert_invalid_override_combination(
    @tanikun-domain.Override::new(
      course_target,
      @tanikun-domain.OverrideAttribute::Slots,
      @tanikun-domain.OverrideValue::Slots([
        offering_slot(@tanikun-domain.DayOfWeek::Tuesday, 2),
      ]),
    ),
    course_target,
    @tanikun-domain.OverrideAttribute::Slots,
  )
  assert_invalid_override_combination(
    @tanikun-domain.Override::new(
      offering_target,
      @tanikun-domain.OverrideAttribute::Credits,
      @tanikun-domain.OverrideValue::Credits(override_credits(6)),
    ),
    offering_target,
    @tanikun-domain.OverrideAttribute::Credits,
  )
  assert_invalid_override_combination(
    @tanikun-domain.Override::new(
      offering_target,
      @tanikun-domain.OverrideAttribute::DisplayName,
      @tanikun-domain.OverrideValue::Text("Applied Physics"),
    ),
    offering_target,
    @tanikun-domain.OverrideAttribute::DisplayName,
  )
  assert_invalid_override_combination(
    @tanikun-domain.Override::new(
      course_target,
      @tanikun-domain.OverrideAttribute::Credits,
      @tanikun-domain.OverrideValue::Text("6"),
    ),
    course_target,
    @tanikun-domain.OverrideAttribute::Credits,
  )
  assert_empty_override_text(
    @tanikun-domain.Override::new(
      course_target,
      @tanikun-domain.OverrideAttribute::DisplayName,
      @tanikun-domain.OverrideValue::Text("  "),
    ),
  )
}

///|
test "slot override replaces offering slots after validation" {
  let offering = expect_ok(
    make_offering(
      "offering-1",
      @tanikun-domain.OfferingSchedule::YearLong,
      @tanikun-domain.OfferingStatus::Offered,
      [offering_slot(@tanikun-domain.DayOfWeek::Monday, 1)],
    ),
  )
  let replacement = offering_slot(@tanikun-domain.DayOfWeek::Tuesday, 2)
  let entry = expect_ok(
    @tanikun-domain.Override::new(
      override_target_offering(offering),
      @tanikun-domain.OverrideAttribute::Slots,
      @tanikun-domain.OverrideValue::Slots([replacement]),
    ),
  )
  let slots = expect_ok(
    @tanikun-domain.effective_slots(offering, override_set([entry])),
  )
  assert_eq(slots.length(), 1)
  assert_true(slots[0] == replacement)
}

///|
test "slot override validates regular and year-long slot rules" {
  let offering = expect_ok(
    make_offering(
      "offering-1",
      @tanikun-domain.OfferingSchedule::YearLong,
      @tanikun-domain.OfferingStatus::Offered,
      [offering_slot(@tanikun-domain.DayOfWeek::Monday, 1)],
    ),
  )
  let target = override_target_offering(offering)
  let empty = expect_ok(
    @tanikun-domain.Override::new(
      target,
      @tanikun-domain.OverrideAttribute::Slots,
      @tanikun-domain.OverrideValue::Slots([]),
    ),
  )
  assert_missing_offering_slots(
    @tanikun-domain.effective_slots(offering, override_set([empty])),
  )

  let repeated = offering_slot(@tanikun-domain.DayOfWeek::Monday, 1)
  let duplicate = expect_ok(
    @tanikun-domain.Override::new(
      target,
      @tanikun-domain.OverrideAttribute::Slots,
      @tanikun-domain.OverrideValue::Slots([repeated, repeated]),
    ),
  )
  assert_duplicate_offering_slot(
    @tanikun-domain.effective_slots(offering, override_set([duplicate])),
    repeated,
  )
}

///|
test "slot override respects intensive and not-offered rules" {
  let intensive = expect_ok(
    make_offering(
      "offering-intensive",
      @tanikun-domain.OfferingSchedule::Intensive(
        semester=@tanikun-domain.Semester::W,
      ),
      @tanikun-domain.OfferingStatus::Offered,
      [],
    ),
  )
  let empty_slots = expect_ok(
    @tanikun-domain.Override::new(
      override_target_offering(intensive),
      @tanikun-domain.OverrideAttribute::Slots,
      @tanikun-domain.OverrideValue::Slots([]),
    ),
  )
  let empty_result = expect_ok(
    @tanikun-domain.effective_slots(intensive, override_set([empty_slots])),
  )
  assert_eq(empty_result.length(), 0)

  let non_empty_slots = expect_ok(
    @tanikun-domain.Override::new(
      override_target_offering(intensive),
      @tanikun-domain.OverrideAttribute::Slots,
      @tanikun-domain.OverrideValue::Slots([
        offering_slot(@tanikun-domain.DayOfWeek::Monday, 1),
      ]),
    ),
  )
  assert_unexpected_offering_slots(
    @tanikun-domain.effective_slots(intensive, override_set([non_empty_slots])),
  )

  let not_offered = expect_ok(
    make_offering(
      "offering-not-offered",
      @tanikun-domain.OfferingSchedule::YearLong,
      @tanikun-domain.OfferingStatus::NotOffered,
      [],
    ),
  )
  let slots_for_not_offered = expect_ok(
    @tanikun-domain.Override::new(
      override_target_offering(not_offered),
      @tanikun-domain.OverrideAttribute::Slots,
      @tanikun-domain.OverrideValue::Slots([
        offering_slot(@tanikun-domain.DayOfWeek::Tuesday, 2),
      ]),
    ),
  )
  assert_unexpected_offering_slots(
    @tanikun-domain.effective_slots(
      not_offered,
      override_set([slots_for_not_offered]),
    ),
  )
}

///|
test "multiple overrides are order-independent" {
  let course = override_course()
  let name = expect_ok(
    @tanikun-domain.Override::new(
      override_target_course(course),
      @tanikun-domain.OverrideAttribute::DisplayName,
      @tanikun-domain.OverrideValue::Text("Applied Physics"),
    ),
  )
  let credits = expect_ok(
    @tanikun-domain.Override::new(
      override_target_course(course),
      @tanikun-domain.OverrideAttribute::Credits,
      @tanikun-domain.OverrideValue::Credits(override_credits(6)),
    ),
  )
  let first = override_set([name, credits])
  let second = override_set([credits, name])
  assert_eq(
    @tanikun-domain.effective_course_name(course, first),
    "Applied Physics",
  )
  assert_eq(
    @tanikun-domain.effective_course_name(course, second),
    "Applied Physics",
  )
  assert_eq(
    @tanikun-domain.effective_course_credits(course, first).half_units(),
    6,
  )
  assert_eq(
    @tanikun-domain.effective_course_credits(course, second).half_units(),
    6,
  )
}

///|
test "override slot values are copied" {
  let offering = expect_ok(
    make_offering(
      "offering-1",
      @tanikun-domain.OfferingSchedule::YearLong,
      @tanikun-domain.OfferingStatus::Offered,
      [offering_slot(@tanikun-domain.DayOfWeek::Monday, 1)],
    ),
  )
  let original = [offering_slot(@tanikun-domain.DayOfWeek::Tuesday, 2)]
  let entry = expect_ok(
    @tanikun-domain.Override::new(
      override_target_offering(offering),
      @tanikun-domain.OverrideAttribute::Slots,
      @tanikun-domain.OverrideValue::Slots(original),
    ),
  )
  original[0] = offering_slot(@tanikun-domain.DayOfWeek::Wednesday, 3)
  let slots = expect_ok(
    @tanikun-domain.effective_slots(offering, override_set([entry])),
  )
  assert_true(slots[0] == offering_slot(@tanikun-domain.DayOfWeek::Tuesday, 2))
}

///|
test "no override keeps the course and offering data" {
  let course = override_course()
  let offering = expect_ok(
    make_offering(
      "offering-1",
      @tanikun-domain.OfferingSchedule::YearLong,
      @tanikun-domain.OfferingStatus::Offered,
      [offering_slot(@tanikun-domain.DayOfWeek::Monday, 1)],
    ),
  )
  let empty = override_set([])
  assert_eq(@tanikun-domain.effective_course_name(course, empty), "Physics")
  assert_eq(
    @tanikun-domain.effective_course_credits(course, empty).half_units(),
    4,
  )
  let slots = expect_ok(@tanikun-domain.effective_slots(offering, empty))
  assert_eq(slots.length(), 1)
}
