///|
fn[T] sample_ok(result : Result[T, @tanikun-domain.DomainError]) -> T {
  match result {
    Ok(value) => value
    Err(_) => panic()
  }
}

///|
fn sample_course(
  local_part : String,
  name : String,
  half_units : Int,
) -> @tanikun-domain.Course {
  let id = sample_ok(@tanikun-domain.CourseId::new("master", local_part))
  sample_ok(
    @tanikun-domain.Course::new(
      id,
      name,
      sample_ok(@tanikun-domain.Credits::new(half_units)),
      @tanikun-domain.CourseStatus::Active,
    ),
  )
}

///|
fn sample_year() -> @tanikun-domain.AcademicYear {
  sample_ok(@tanikun-domain.AcademicYear::new(2026))
}

///|
fn sample_slot(
  day : @tanikun-domain.DayOfWeek,
  period : Int,
) -> @tanikun-domain.Slot {
  @tanikun-domain.Slot::new(day, sample_ok(@tanikun-domain.Period::new(period)))
}

///|
fn sample_offering(
  id : String,
  course : @tanikun-domain.Course,
  schedule : @tanikun-domain.OfferingSchedule,
  slots : Array[@tanikun-domain.Slot],
) -> @tanikun-domain.CourseOffering {
  sample_ok(
    @tanikun-domain.CourseOffering::new(
      sample_ok(@tanikun-domain.OfferingId::new(id)),
      course.id,
      sample_year(),
      schedule,
      @tanikun-domain.OfferingStatus::Offered,
      slots,
    ),
  )
}

///|
/// A small deterministic planner used by the Phase 2 shell and browser tests.
pub fn sample_state() -> PlannerState {
  let program = sample_ok(@tanikun-domain.ProgramId::new("applied-physics"))
  let year = sample_year()
  let phy101 = sample_course("PHY101", "Physics I", 4)
  let phy102 = sample_course("PHY102", "Physics II", 4)
  let phy103 = sample_course("PHY103", "Calculus", 4)
  let phy201 = sample_course("PHY201", "Physics Lab", 2)
  let phy301 = sample_course("PHY301", "Seminar S", 2)
  let phy302 = sample_course("PHY302", "Seminar S2", 2)
  let phy401 = sample_course("PHY401", "Seminar A", 2)
  let phy501 = sample_course("PHY501", "Winter Workshop", 2)
  let offerings = [
    sample_offering(
      "phy101-s1",
      phy101,
      @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::S1]),
      [sample_slot(@tanikun-domain.DayOfWeek::Monday, 1)],
    ),
    sample_offering(
      "phy102-s2",
      phy102,
      @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::S2]),
      [sample_slot(@tanikun-domain.DayOfWeek::Tuesday, 2)],
    ),
    sample_offering(
      "phy103-s1",
      phy103,
      @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::S1]),
      [sample_slot(@tanikun-domain.DayOfWeek::Monday, 2)],
    ),
    sample_offering(
      "phy103-s2",
      phy103,
      @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::S2]),
      [sample_slot(@tanikun-domain.DayOfWeek::Tuesday, 3)],
    ),
    sample_offering(
      "phy201-year",
      phy201,
      @tanikun-domain.OfferingSchedule::YearLong,
      [sample_slot(@tanikun-domain.DayOfWeek::Wednesday, 3)],
    ),
    sample_offering(
      "phy301-s",
      phy301,
      @tanikun-domain.OfferingSchedule::Intensive(
        semester=@tanikun-domain.Semester::S,
      ),
      [],
    ),
    sample_offering(
      "phy302-s",
      phy302,
      @tanikun-domain.OfferingSchedule::Intensive(
        semester=@tanikun-domain.Semester::S,
      ),
      [],
    ),
    sample_offering(
      "phy401-a",
      phy401,
      @tanikun-domain.OfferingSchedule::Intensive(
        semester=@tanikun-domain.Semester::A,
      ),
      [],
    ),
    sample_offering(
      "phy501-w",
      phy501,
      @tanikun-domain.OfferingSchedule::Intensive(
        semester=@tanikun-domain.Semester::W,
      ),
      [],
    ),
  ]
  let enrollments = [
    @tanikun-domain.Enrollment::failed(
      sample_ok(@tanikun-domain.OfferingId::new("phy103-s1")),
      @tanikun-domain.FailingGrade::Fail,
    ),
    @tanikun-domain.Enrollment::planned(
      sample_ok(@tanikun-domain.OfferingId::new("phy101-s1")),
    ),
    @tanikun-domain.Enrollment::planned(
      sample_ok(@tanikun-domain.OfferingId::new("phy201-year")),
    ),
    @tanikun-domain.Enrollment::planned(
      sample_ok(@tanikun-domain.OfferingId::new("phy301-s")),
    ),
    @tanikun-domain.Enrollment::planned(
      sample_ok(@tanikun-domain.OfferingId::new("phy401-a")),
    ),
    @tanikun-domain.Enrollment::planned(
      sample_ok(@tanikun-domain.OfferingId::new("phy501-w")),
    ),
  ]
  let rule = sample_ok(
    @tanikun-requirements.Rule::total_minimum(
      sample_ok(@tanikun-domain.Credits::new(4)),
    ),
  )
  let chemistry_rule = sample_ok(
    @tanikun-requirements.Rule::total_minimum(
      sample_ok(@tanikun-domain.Credits::new(20)),
    ),
  )
  let prior_rule = sample_ok(
    @tanikun-requirements.Rule::total_minimum(
      sample_ok(@tanikun-domain.Credits::new(2)),
    ),
  )
  let chemistry = sample_ok(@tanikun-domain.ProgramId::new("applied-chemistry"))
  let prior_year = sample_ok(@tanikun-domain.AcademicYear::new(2025))
  let requirement_sets = sample_ok(
    @tanikun-requirements.RequirementSets::new([
      sample_ok(
        @tanikun-requirements.RequirementSet::new(
          @tanikun-requirements.RequirementSetKey::new(program, year),
          [],
          [],
          rule,
        ),
      ),
      sample_ok(
        @tanikun-requirements.RequirementSet::new(
          @tanikun-requirements.RequirementSetKey::new(chemistry, year),
          [],
          [],
          chemistry_rule,
        ),
      ),
      sample_ok(
        @tanikun-requirements.RequirementSet::new(
          @tanikun-requirements.RequirementSetKey::new(program, prior_year),
          [],
          [],
          prior_rule,
        ),
      ),
    ]),
  )
  PlannerState::new(
    [phy101, phy102, phy103, phy201, phy301, phy302, phy401, phy501],
    offerings,
    enrollments,
    @tanikun-domain.Overrides::empty(),
    @tanikun-domain.AcademicProfile::new(program, year),
    requirement_sets,
  )
}
