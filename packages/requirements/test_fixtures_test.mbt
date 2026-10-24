///|
/// Shared Phase 1 requirement test fixtures.
///
/// These builders are test-only. Production packages must not depend on this
/// file; keeping them here avoids cross-test-file helper ownership.
///

///|
fn category_id(value : String) -> @tanikun-domain.CategoryId raise Error {
  expect_ok(@tanikun-domain.CategoryId::new(value))
}

///|
fn category(
  id : String,
  name : String,
) -> @tanikun-requirements.Category raise Error {
  expect_ok(@tanikun-requirements.Category::new(category_id(id), name))
}

///|
fn course_id(local_part : String) -> @tanikun-domain.CourseId raise Error {
  expect_ok(@tanikun-domain.CourseId::new("master", local_part))
}

///|
fn program_id(value : String) -> @tanikun-domain.ProgramId raise Error {
  expect_ok(@tanikun-domain.ProgramId::new(value))
}

///|
fn academic_year(value : Int) -> @tanikun-domain.AcademicYear raise Error {
  expect_ok(@tanikun-domain.AcademicYear::new(value))
}

///|
fn requirement_set(
  key : @tanikun-requirements.RequirementSetKey,
  categories : Array[@tanikun-requirements.Category],
  assignments : Array[(@tanikun-domain.CourseId, @tanikun-domain.CategoryId)],
  rule : String,
) -> Result[
  @tanikun-requirements.RequirementSet[String],
  @tanikun-domain.DomainError,
] {
  @tanikun-requirements.RequirementSet::new(key, categories, assignments, rule)
}

///|
fn credit_value(half_units : Int) -> @tanikun-domain.Credits raise Error {
  expect_ok(@tanikun-domain.Credits::new(half_units))
}

///|
fn credit_course(
  local_part : String,
  half_units : Int,
) -> @tanikun-domain.Course raise Error {
  expect_ok(
    @tanikun-domain.Course::new(
      course_id(local_part),
      local_part,
      credit_value(half_units),
      @tanikun-domain.CourseStatus::Active,
    ),
  )
}

///|
fn credit_offering(
  id : String,
  course_id : @tanikun-domain.CourseId,
) -> @tanikun-domain.CourseOffering raise Error {
  let period = expect_ok(@tanikun-domain.Period::new(1))
  let slot = @tanikun-domain.Slot::new(
    @tanikun-domain.DayOfWeek::Monday,
    period,
  )
  expect_ok(
    @tanikun-domain.CourseOffering::new(
      expect_ok(@tanikun-domain.OfferingId::new(id)),
      course_id,
      academic_year(2026),
      @tanikun-domain.OfferingSchedule::YearLong,
      @tanikun-domain.OfferingStatus::Offered,
      [slot],
    ),
  )
}

///|
fn credit_course_status(
  local_part : String,
  half_units : Int,
  status : @tanikun-domain.CourseStatus,
) -> @tanikun-domain.Course raise Error {
  expect_ok(
    @tanikun-domain.Course::new(
      course_id(local_part),
      local_part,
      credit_value(half_units),
      status,
    ),
  )
}

///|
fn credit_offering_status(
  id : String,
  course_id : @tanikun-domain.CourseId,
  status : @tanikun-domain.OfferingStatus,
) -> @tanikun-domain.CourseOffering raise Error {
  let period = expect_ok(@tanikun-domain.Period::new(1))
  let slot = @tanikun-domain.Slot::new(
    @tanikun-domain.DayOfWeek::Monday,
    period,
  )
  let slots = match status {
    @tanikun-domain.OfferingStatus::Offered => [slot]
    @tanikun-domain.OfferingStatus::NotOffered => []
  }
  expect_ok(
    @tanikun-domain.CourseOffering::new(
      expect_ok(@tanikun-domain.OfferingId::new(id)),
      course_id,
      academic_year(2026),
      @tanikun-domain.OfferingSchedule::YearLong,
      status,
      slots,
    ),
  )
}

///|
fn credit_regular_offering(
  id : String,
  course_id : @tanikun-domain.CourseId,
) -> @tanikun-domain.CourseOffering raise Error {
  let period = expect_ok(@tanikun-domain.Period::new(1))
  let slot = @tanikun-domain.Slot::new(
    @tanikun-domain.DayOfWeek::Monday,
    period,
  )
  expect_ok(
    @tanikun-domain.CourseOffering::new(
      expect_ok(@tanikun-domain.OfferingId::new(id)),
      course_id,
      academic_year(2026),
      @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::S1]),
      @tanikun-domain.OfferingStatus::Offered,
      [slot],
    ),
  )
}

///|
fn credit_slot_override(
  offering : @tanikun-domain.CourseOffering,
  slots : Array[@tanikun-domain.Slot],
) -> @tanikun-domain.Override raise Error {
  expect_ok(
    @tanikun-domain.Override::new(
      @tanikun-domain.OverrideTarget::Offering(offering.id),
      @tanikun-domain.OverrideAttribute::Slots,
      @tanikun-domain.OverrideValue::Slots(slots),
    ),
  )
}

///|
fn credit_requirement_set(
  categories : Array[@tanikun-requirements.Category],
  assignments : Array[(@tanikun-domain.CourseId, @tanikun-domain.CategoryId)],
) -> @tanikun-requirements.RequirementSet[@tanikun-requirements.Rule] raise Error {
  let key = @tanikun-requirements.RequirementSetKey::new(
    program_id("applied-physics"),
    academic_year(2026),
  )
  let rule = expect_ok(
    @tanikun-requirements.Rule::total_minimum(credit_value(1)),
  )
  expect_ok(
    @tanikun-requirements.RequirementSet::new(
      key, categories, assignments, rule,
    ),
  )
}

///|
fn credit_profile(
  program : String,
  year : Int,
) -> @tanikun-domain.AcademicProfile raise Error {
  @tanikun-domain.AcademicProfile::new(program_id(program), academic_year(year))
}

///|
fn credit_input(
  set : @tanikun-requirements.RequirementSet[@tanikun-requirements.Rule],
  courses : Array[@tanikun-domain.Course],
  offerings : Array[@tanikun-domain.CourseOffering],
  enrollments : Array[@tanikun-domain.Enrollment],
  overrides : @tanikun-domain.Overrides,
) -> @tanikun-requirements.EvaluationInput[@tanikun-requirements.Rule] raise Error {
  @tanikun-requirements.EvaluationInput::new(
    credit_profile("applied-physics", 2026),
    set,
    courses,
    offerings,
    enrollments,
    overrides,
  )
}

///|
fn credit_overrides(
  entries : Array[@tanikun-domain.Override],
) -> @tanikun-domain.Overrides raise Error {
  expect_ok(@tanikun-domain.Overrides::new(entries))
}

///|
fn credit_override(
  course : @tanikun-domain.Course,
  half_units : Int,
) -> @tanikun-domain.Override raise Error {
  expect_ok(
    @tanikun-domain.Override::new(
      @tanikun-domain.OverrideTarget::Course(course.id),
      @tanikun-domain.OverrideAttribute::Credits,
      @tanikun-domain.OverrideValue::Credits(credit_value(half_units)),
    ),
  )
}

///|
fn credit_snapshot(
  course : @tanikun-domain.Course,
  half_units : Int,
) -> @tanikun-domain.PassedCourseSnapshot raise Error {
  expect_ok(
    @tanikun-domain.PassedCourseSnapshot::new(
      course.id,
      course.name,
      credit_value(half_units),
    ),
  )
}

///|
fn passed_enrollment(
  offering_id : String,
  course : @tanikun-domain.Course,
  half_units : Int,
) -> @tanikun-domain.Enrollment raise Error {
  @tanikun-domain.Enrollment::passed(
    expect_ok(@tanikun-domain.OfferingId::new(offering_id)),
    @tanikun-domain.PassingGrade::Excellent,
    credit_snapshot(course, half_units),
  )
}

///|
fn planned_enrollment(
  offering_id : String,
) -> @tanikun-domain.Enrollment raise Error {
  @tanikun-domain.Enrollment::planned(
    expect_ok(@tanikun-domain.OfferingId::new(offering_id)),
  )
}

///|
fn in_progress_enrollment(
  offering_id : String,
) -> @tanikun-domain.Enrollment raise Error {
  @tanikun-domain.Enrollment::in_progress(
    expect_ok(@tanikun-domain.OfferingId::new(offering_id)),
  )
}

///|
fn failed_enrollment(
  offering_id : String,
) -> @tanikun-domain.Enrollment raise Error {
  @tanikun-domain.Enrollment::failed(
    expect_ok(@tanikun-domain.OfferingId::new(offering_id)),
    @tanikun-domain.FailingGrade::Fail,
  )
}

///|
fn not_taken_enrollment(
  offering_id : String,
) -> @tanikun-domain.Enrollment raise Error {
  @tanikun-domain.Enrollment::not_taken(
    expect_ok(@tanikun-domain.OfferingId::new(offering_id)),
  )
}

///|
fn credit_requirement_set_with_rule(
  categories : Array[@tanikun-requirements.Category],
  assignments : Array[(@tanikun-domain.CourseId, @tanikun-domain.CategoryId)],
  rule : @tanikun-requirements.Rule,
) -> @tanikun-requirements.RequirementSet[@tanikun-requirements.Rule] raise Error {
  let key = @tanikun-requirements.RequirementSetKey::new(
    program_id("applied-physics"),
    academic_year(2026),
  )
  expect_ok(
    @tanikun-requirements.RequirementSet::new(
      key, categories, assignments, rule,
    ),
  )
}

///|
fn rule_threshold(half_units : Int) -> @tanikun-domain.Credits raise Error {
  expect_ok(@tanikun-domain.Credits::new(half_units))
}

///|
fn rule_scope(
  categories : Array[@tanikun-domain.CategoryId],
  courses : Array[@tanikun-domain.CourseId],
) -> @tanikun-requirements.RuleScope {
  @tanikun-requirements.RuleScope::new(categories, courses)
}

///|
fn eval_context(
  total : @tanikun-domain.Credits,
  by_category : Array[(@tanikun-domain.CategoryId, @tanikun-domain.Credits)],
  by_course : Array[(@tanikun-domain.CourseId, @tanikun-domain.Credits)],
  passed_courses : Array[@tanikun-domain.CourseId],
) -> @tanikun-requirements.RuleContext {
  @tanikun-requirements.RuleContext::new(
    total, by_category, by_course, passed_courses,
  )
}
