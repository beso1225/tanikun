///|
/// Shared Phase 1 domain test fixtures.
///
/// Test-only builders shared across domain test files. Production packages must
/// not depend on this file.
///

///|
fn make_course(
  local_part : String,
  name : String,
  credits : @tanikun-domain.Credits,
  status : @tanikun-domain.CourseStatus,
) -> @tanikun-domain.Course raise Error {
  let id = expect_ok(@tanikun-domain.CourseId::new("master", local_part))
  expect_ok(@tanikun-domain.Course::new(id, name, credits, status))
}

///|
fn offering_period(value : Int) -> @tanikun-domain.Period raise Error {
  expect_ok(@tanikun-domain.Period::new(value))
}

///|
fn offering_slot(
  day : @tanikun-domain.DayOfWeek,
  period : Int,
) -> @tanikun-domain.Slot raise Error {
  @tanikun-domain.Slot::new(day, offering_period(period))
}

///|
fn regular(
  terms : Array[@tanikun-domain.Term],
) -> @tanikun-domain.OfferingSchedule {
  @tanikun-domain.OfferingSchedule::Regular(terms~)
}

///|
fn intensive(
  semester : @tanikun-domain.Semester,
) -> @tanikun-domain.OfferingSchedule {
  @tanikun-domain.OfferingSchedule::Intensive(semester~)
}

///|
fn make_offering(
  id : String,
  schedule : @tanikun-domain.OfferingSchedule,
  status : @tanikun-domain.OfferingStatus,
  slots : Array[@tanikun-domain.Slot],
) -> Result[@tanikun-domain.CourseOffering, @tanikun-domain.DomainError] {
  let offering_id = match @tanikun-domain.OfferingId::new(id) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  let course_id = match @tanikun-domain.CourseId::new("master", "PHY101") {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  let academic_year = match @tanikun-domain.AcademicYear::new(2026) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  @tanikun-domain.CourseOffering::new(
    offering_id, course_id, academic_year, schedule, status, slots,
  )
}

///|
fn enrollment_offering_id() -> @tanikun-domain.OfferingId raise Error {
  expect_ok(@tanikun-domain.OfferingId::new("offering-1"))
}

///|
fn enrollment_course_id() -> @tanikun-domain.CourseId raise Error {
  expect_ok(@tanikun-domain.CourseId::new("master", "PHY101"))
}

///|
fn enrollment_snapshot() -> @tanikun-domain.PassedCourseSnapshot raise Error {
  let credits = expect_ok(@tanikun-domain.Credits::new(4))
  expect_ok(
    @tanikun-domain.PassedCourseSnapshot::new(
      enrollment_course_id(),
      "Physics",
      credits,
    ),
  )
}

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
