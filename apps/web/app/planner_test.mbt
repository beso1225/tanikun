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
    requirement_set,
    requirement_sets,
  )
}

///|
test "planner exposes five terms and maps W off the grid" {
  let terms = @app.PlannerTerm::values()
  assert_eq(terms.length(), 5)
  assert_true(terms[0] == @app.PlannerTerm::S1)
  assert_true(terms[1] == @app.PlannerTerm::S2)
  assert_true(terms[2] == @app.PlannerTerm::A1)
  assert_true(terms[3] == @app.PlannerTerm::A2)
  assert_true(terms[4] == @app.PlannerTerm::W)
  assert_true(@app.PlannerTerm::W.semester() == @tanikun-domain.Semester::W)
  match @app.PlannerTerm::W.term() {
    None => ()
    Some(_) => fail("W must not have a term")
  }
}

///|
test "term selection updates the state and clears an error" {
  let state = planner_state()
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("missing")),
  )
  match state.error {
    Some(_) => ()
    None => fail("expected an error before selecting a term")
  }
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::A1),
  )
  assert_true(state.selected_term == @app.PlannerTerm::A1)
  match state.error {
    None => ()
    Some(_) => fail("expected term selection to clear the error")
  }
}

///|
test "planned enrollment can be added and removed" {
  let id = planner_offering_id("offering-1")
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=id),
  )
  assert_eq(state.enrollments.length(), 1)
  assert_true(state.enrollments[0].offering_id == id)
  assert_eq(state.enrollments[0].is_confirmed(), false)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::RemoveEnrollment(offering_id=id),
  )
  assert_eq(state.enrollments.length(), 0)
}

///|
test "duplicate placement leaves the state unchanged and reports an error" {
  let id = planner_offering_id("offering-1")
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=id),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=id),
  )
  assert_eq(state.enrollments.length(), 1)
  match state.error {
    Some(error) =>
      assert_true(error.kind == @app.UiErrorKind::DuplicateEnrollment)
    None => fail("expected a duplicate error")
  }
}

///|
test "adding an unknown offering reports an error" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("missing")),
  )
  assert_eq(state.enrollments.length(), 0)
  match state.error {
    Some(error) => assert_true(error.kind == @app.UiErrorKind::UnknownOffering)
    None => fail("expected an unknown-offering error")
  }
}

///|
test "removing an absent enrollment reports an error" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::RemoveEnrollment(
      offering_id=planner_offering_id("missing"),
    ),
  )
  match state.error {
    Some(error) =>
      assert_true(error.kind == @app.UiErrorKind::UnknownEnrollment)
    None => fail("expected an unknown-enrollment error")
  }
}

///|
test "a slot conflict leaves the existing enrollment in place" {
  let state = planner_state()
  let course = state.catalogue[0]
  state.offerings.push(
    planner_offering("offering-2", course, @tanikun-domain.Term::S1, [
      planner_slot(@tanikun-domain.DayOfWeek::Monday, 1),
    ]),
  )
  let first = planner_offering_id("offering-1")
  let second = planner_offering_id("offering-2")
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=first),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=second),
  )
  assert_eq(state.enrollments.length(), 1)
  match state.error {
    Some(error) => assert_true(error.kind == @app.UiErrorKind::SlotConflict)
    None => fail("expected a slot-conflict error")
  }
}

///|
test "an offering from another term is rejected" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::A1),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("offering-1")),
  )
  assert_eq(state.enrollments.length(), 0)
  match state.error {
    Some(error) => assert_true(error.kind == @app.UiErrorKind::NotOfferedInTerm)
    None => fail("expected a term-mismatch error")
  }
}

///|
test "domain validation errors map to a UI validation error" {
  let error = @app.UiError::from_domain(
    @tanikun-domain.DomainError::EmptyCourseName,
    @app.UiErrorTarget::General,
  )
  assert_true(error.kind == @app.UiErrorKind::DomainValidation)
  assert_eq(error.message, "科目名を入力してください")
}

///|
test "the same slot in different terms is allowed" {
  let state = planner_state()
  let course = state.catalogue[0]
  state.offerings.push(
    planner_offering("offering-2", course, @tanikun-domain.Term::S2, [
      planner_slot(@tanikun-domain.DayOfWeek::Monday, 1),
    ]),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("offering-1")),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("offering-2")),
  )
  assert_eq(state.enrollments.length(), 2)
  match state.error {
    None => ()
    Some(_) => fail("expected no slot conflict across terms")
  }
}

///|
test "a year-long offering conflicts with S1 and A1 slots" {
  let state = planner_state()
  let course = state.catalogue[0]
  let year = planner_expect_ok(@tanikun-domain.AcademicYear::new(2026))
  state.offerings.push(
    planner_expect_ok(
      @tanikun-domain.CourseOffering::new(
        planner_offering_id("year-long"),
        course.id,
        year,
        @tanikun-domain.OfferingSchedule::YearLong,
        @tanikun-domain.OfferingStatus::Offered,
        [planner_slot(@tanikun-domain.DayOfWeek::Monday, 1)],
      ),
    ),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("year-long")),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("offering-1")),
  )
  match state.error {
    Some(error) => assert_true(error.kind == @app.UiErrorKind::SlotConflict)
    None => fail("expected a year-long conflict in S1")
  }

  let state = planner_state()
  let course = state.catalogue[0]
  state.offerings.push(
    planner_expect_ok(
      @tanikun-domain.CourseOffering::new(
        planner_offering_id("year-long"),
        course.id,
        year,
        @tanikun-domain.OfferingSchedule::YearLong,
        @tanikun-domain.OfferingStatus::Offered,
        [planner_slot(@tanikun-domain.DayOfWeek::Monday, 1)],
      ),
    ),
  )
  state.offerings.push(
    planner_offering("offering-a1", course, @tanikun-domain.Term::A1, [
      planner_slot(@tanikun-domain.DayOfWeek::Monday, 1),
    ]),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::A1),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("year-long")),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("offering-a1")),
  )
  match state.error {
    Some(error) => assert_true(error.kind == @app.UiErrorKind::SlotConflict)
    None => fail("expected a year-long conflict in A1")
  }
}

///|
fn planner_intensive(
  id : String,
  course : @tanikun-domain.Course,
  semester : @tanikun-domain.Semester,
) -> @tanikun-domain.CourseOffering raise Error {
  let year = planner_expect_ok(@tanikun-domain.AcademicYear::new(2026))
  planner_expect_ok(
    @tanikun-domain.CourseOffering::new(
      planner_offering_id(id),
      course.id,
      year,
      @tanikun-domain.OfferingSchedule::Intensive(semester~),
      @tanikun-domain.OfferingStatus::Offered,
      [],
    ),
  )
}

///|
test "visible range starts at five days and six periods and is bounded" {
  let state = planner_state()
  assert_eq(state.visible_days, 5)
  assert_eq(state.visible_periods, 6)
  let state = @app.update_planner(state, @app.PlannerMsg::DecreaseVisibleDays)
  assert_eq(state.visible_days, 5)
  let state = @app.update_planner(state, @app.PlannerMsg::IncreaseVisibleDays)
  assert_eq(state.visible_days, 6)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::IncreaseVisiblePeriods,
  )
  assert_eq(state.visible_periods, 7)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::DecreaseVisiblePeriods,
  )
  assert_eq(state.visible_periods, 6)
}

///|
test "S and A intensives stay off-grid in their semester terms" {
  let state = planner_state()
  let course = state.catalogue[0]
  state.offerings.push(
    planner_intensive("intensive-s", course, @tanikun-domain.Semester::S),
  )
  state.offerings.push(
    planner_intensive("intensive-a", course, @tanikun-domain.Semester::A),
  )
  state.offerings.push(
    planner_intensive("intensive-w", course, @tanikun-domain.Semester::W),
  )
  state.enrollments.push(
    @tanikun-domain.Enrollment::planned(planner_offering_id("offering-1")),
  )
  state.enrollments.push(
    @tanikun-domain.Enrollment::planned(planner_offering_id("intensive-s")),
  )
  state.enrollments.push(
    @tanikun-domain.Enrollment::planned(planner_offering_id("intensive-a")),
  )
  state.enrollments.push(
    @tanikun-domain.Enrollment::planned(planner_offering_id("intensive-w")),
  )
  assert_eq(state.off_grid_entries(@app.PlannerTerm::S1).length(), 1)
  assert_eq(state.off_grid_entries(@app.PlannerTerm::S2).length(), 1)
  assert_eq(state.off_grid_entries(@app.PlannerTerm::A1).length(), 1)
  assert_eq(state.off_grid_entries(@app.PlannerTerm::W).length(), 1)
  assert_eq(state.scheduled_blocks(@app.PlannerTerm::S1).length(), 1)
}
