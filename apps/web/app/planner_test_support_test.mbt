///|
fn[T] planner_expect_ok(
  result : Result[T, @tanikun-domain.DomainError],
) -> T raise Error {
  match result {
    Ok(value) => value
    Err(_) => fail("expected Ok")
  }
}

///|
fn planner_course_id(
  local_part : String,
) -> @tanikun-domain.CourseId raise Error {
  planner_expect_ok(@tanikun-domain.CourseId::new("master", local_part))
}

///|
fn planner_offering_id(
  value : String,
) -> @tanikun-domain.OfferingId raise Error {
  planner_expect_ok(@tanikun-domain.OfferingId::new(value))
}

///|
fn planner_credits(half_units : Int) -> @tanikun-domain.Credits raise Error {
  planner_expect_ok(@tanikun-domain.Credits::new(half_units))
}

///|
fn planner_course(
  local_part : String,
  name : String,
  half_units : Int,
) -> @tanikun-domain.Course raise Error {
  planner_expect_ok(
    @tanikun-domain.Course::new(
      planner_course_id(local_part),
      name,
      planner_credits(half_units),
      @tanikun-domain.CourseStatus::Active,
    ),
  )
}

///|
fn planner_offering(
  id : String,
  course : @tanikun-domain.Course,
  term : @tanikun-domain.Term,
  slots : Array[@tanikun-domain.Slot],
) -> @tanikun-domain.CourseOffering raise Error {
  let year = planner_expect_ok(@tanikun-domain.AcademicYear::new(2026))
  planner_expect_ok(
    @tanikun-domain.CourseOffering::new(
      planner_offering_id(id),
      course.id,
      year,
      @tanikun-domain.OfferingSchedule::Regular(terms=[term]),
      @tanikun-domain.OfferingStatus::Offered,
      slots,
    ),
  )
}

///|
fn planner_slot(
  day : @tanikun-domain.DayOfWeek,
  period : Int,
) -> @tanikun-domain.Slot raise Error {
  let period = planner_expect_ok(@tanikun-domain.Period::new(period))
  @tanikun-domain.Slot::new(day, period)
}

///|
fn planner_requirement_set(
  program : @tanikun-domain.ProgramId,
  year : @tanikun-domain.AcademicYear,
) -> @tanikun-requirements.RequirementSet[@tanikun-requirements.Rule] raise Error {
  let rule = planner_expect_ok(
    @tanikun-requirements.Rule::total_minimum(planner_credits(4)),
  )
  planner_expect_ok(
    @tanikun-requirements.RequirementSet::new(
      @tanikun-requirements.RequirementSetKey::new(program, year),
      [],
      [],
      rule,
    ),
  )
}

///|
fn planner_state() -> @app.PlannerState raise Error {
  let program = planner_expect_ok(
    @tanikun-domain.ProgramId::new("applied-physics"),
  )
  let year = planner_expect_ok(@tanikun-domain.AcademicYear::new(2026))
  let course = planner_course("PHY101", "Physics", 4)
  let offering = planner_offering(
    "offering-1",
    course,
    @tanikun-domain.Term::S1,
    [planner_slot(@tanikun-domain.DayOfWeek::Monday, 1)],
  )
  let requirement_set = planner_requirement_set(program, year)
  let requirement_sets = planner_expect_ok(
    @tanikun-requirements.RequirementSets::new([requirement_set]),
  )
  @app.PlannerState::new(
    [course],
    [offering],
    [],
    @tanikun-domain.Overrides::empty(),
    @tanikun-domain.AcademicProfile::new(program, year),
    requirement_sets,
    [],
  )
}

///|
