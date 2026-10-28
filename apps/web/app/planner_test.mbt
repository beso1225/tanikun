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
test "duplicate placement is idempotent" {
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
    None => ()
    Some(_) => fail("duplicate placement should not report an error")
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
test "removing an absent enrollment is a no-op" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::RemoveEnrollment(
      offering_id=planner_offering_id("missing"),
    ),
  )
  match state.error {
    None => ()
    Some(_) => fail("removing an absent enrollment should not report an error")
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
  assert_eq(state.off_grid_entries(@app.PlannerTerm::A1).length(), 2)
  assert_eq(state.off_grid_entries(@app.PlannerTerm::A2).length(), 2)
  assert_eq(state.off_grid_entries(@app.PlannerTerm::W).length(), 1)
  let winter = state.off_grid_entries(@app.PlannerTerm::A1)[1]
  assert_true(winter.winter)
  assert_eq(state.scheduled_blocks(@app.PlannerTerm::S1).length(), 1)
}

///|
test "visible slot boundaries and hidden block count" {
  let state = planner_state()
  let period_6 = planner_slot(@tanikun-domain.DayOfWeek::Friday, 6)
  let period_7 = planner_slot(@tanikun-domain.DayOfWeek::Monday, 7)
  let saturday = planner_slot(@tanikun-domain.DayOfWeek::Saturday, 1)
  assert_true(state.is_visible_slot(period_6.day, period_6.period))
  assert_true(!state.is_visible_slot(saturday.day, saturday.period))
  assert_true(!state.is_visible_slot(period_7.day, period_7.period))

  let course = state.catalogue[0]
  state.offerings.push(
    planner_offering("late", course, @tanikun-domain.Term::S1, [period_7]),
  )
  state.enrollments.push(
    @tanikun-domain.Enrollment::planned(planner_offering_id("late")),
  )
  assert_eq(state.hidden_scheduled_block_count(@app.PlannerTerm::S1), 1)
}

///|
test "catalogue filters by term, query, and enrollment" {
  let state = planner_state()
  let course = state.catalogue[0]
  state.offerings.push(
    planner_offering("offering-s2", course, @tanikun-domain.Term::S2, [
      planner_slot(@tanikun-domain.DayOfWeek::Tuesday, 2),
    ]),
  )
  state.enrollments.push(
    @tanikun-domain.Enrollment::planned(planner_offering_id("offering-1")),
  )
  assert_eq(state.catalogue_entries(@app.PlannerTerm::S1).length(), 1)
  assert_true(state.catalogue_entries(@app.PlannerTerm::S1)[0].enrolled)
  assert_eq(state.catalogue_entries(@app.PlannerTerm::S2).length(), 1)
  assert_true(!state.catalogue_entries(@app.PlannerTerm::S2)[0].enrolled)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateCatalogueQuery(query="Physics"),
  )
  assert_eq(state.catalogue_entries(@app.PlannerTerm::S1).length(), 1)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateCatalogueQuery(query="missing"),
  )
  assert_eq(state.catalogue_entries(@app.PlannerTerm::S1).length(), 0)
}

///|
test "picker lists only offerings for the clicked slot" {
  let state = planner_state()
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::OpenSlotPicker(
      day=@tanikun-domain.DayOfWeek::Monday,
      period=1,
    ),
  )
  assert_eq(state.picker_entries().length(), 1)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::OpenSlotPicker(
      day=@tanikun-domain.DayOfWeek::Tuesday,
      period=2,
    ),
  )
  assert_eq(state.picker_entries().length(), 0)
  let course = state.catalogue[0]
  state.offerings.push(
    planner_offering("offering-s2", course, @tanikun-domain.Term::S2, [
      planner_slot(@tanikun-domain.DayOfWeek::Tuesday, 2),
    ]),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::OpenSlotPicker(
      day=@tanikun-domain.DayOfWeek::Tuesday,
      period=2,
    ),
  )
  assert_eq(state.picker_entries().length(), 1)
}

///|
test "intensive picker follows the selected semester" {
  let state = planner_state()
  let course = state.catalogue[0]
  state.offerings.push(
    planner_intensive("intensive-s", course, @tanikun-domain.Semester::S),
  )
  state.offerings.push(
    planner_intensive("intensive-w", course, @tanikun-domain.Semester::W),
  )
  let state = @app.update_planner(state, @app.PlannerMsg::OpenIntensivePicker)
  assert_eq(state.picker_entries().length(), 1)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::W),
  )
  let state = @app.update_planner(state, @app.PlannerMsg::OpenIntensivePicker)
  assert_eq(state.picker_entries().length(), 1)
}

///|
test "adding from a picker closes it" {
  let state = planner_state()
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::OpenSlotPicker(
      day=@tanikun-domain.DayOfWeek::Monday,
      period=1,
    ),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("offering-1")),
  )
  match state.picker {
    None => ()
    Some(_) => fail("picker should close after adding an offering")
  }
  assert_eq(state.enrollments.length(), 1)
}

///|
test "the all-courses picker lists the selected term" {
  let state = planner_state()
  let state = @app.update_planner(state, @app.PlannerMsg::OpenCataloguePicker)
  assert_eq(state.picker_entries().length(), 1)
}

///|
test "opening a new picker resets the search query" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::OpenCataloguePicker,
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateCatalogueQuery(query="Physics"),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::OpenSlotPicker(
      day=@tanikun-domain.DayOfWeek::Monday,
      period=1,
    ),
  )
  assert_eq(state.catalogue_query, "")
}

///|
test "adding from the all-courses picker keeps it open" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::OpenCataloguePicker,
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("offering-1")),
  )
  match state.picker {
    Some(@app.PickerTarget::All) => ()
    _ => fail("all-courses picker should stay open")
  }
  assert_true(state.picker_entries()[0].enrolled)
}

///|
test "adding from the intensive picker keeps it open" {
  let state = planner_state()
  let course = state.catalogue[0]
  state.offerings.push(
    planner_intensive("intensive-s", course, @tanikun-domain.Semester::S),
  )
  let state = @app.update_planner(state, @app.PlannerMsg::OpenIntensivePicker)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("intensive-s")),
  )
  match state.picker {
    Some(@app.PickerTarget::Intensive) => ()
    _ => fail("intensive picker should stay open")
  }
  assert_true(state.picker_entries()[0].enrolled)
}

///|
test "removing an opened offering closes its detail" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("offering-1")),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectOffering(
      offering_id=planner_offering_id("offering-1"),
    ),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::RemoveEnrollment(
      offering_id=planner_offering_id("offering-1"),
    ),
  )
  match state.selected_offering {
    None => ()
    Some(_) => fail("detail should close after removing the offering")
  }
}

///|
test "credit totals derive confirmed and projected values" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("offering-1")),
  )
  let totals = match state.planner_summary() {
    Ok(totals) => totals
    Err(_) => fail("expected credit totals")
  }
  assert_eq(totals.confirmed.half_units(), 0)
  assert_eq(totals.standard.half_units(), 0)
  assert_eq(totals.optimistic.half_units(), 4)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::RemoveEnrollment(
      offering_id=planner_offering_id("offering-1"),
    ),
  )
  let totals = match state.planner_summary() {
    Ok(totals) => totals
    Err(_) => fail("expected empty credit totals")
  }
  assert_eq(totals.confirmed.half_units(), 0)
  assert_eq(totals.standard.half_units(), 0)
  assert_eq(totals.optimistic.half_units(), 0)
}

///|
test "invalid planner input reports a credit total error" {
  let state = planner_state()
  state.enrollments.push(
    @tanikun-domain.Enrollment::planned(planner_offering_id("missing-offering")),
  )
  match state.planner_summary() {
    Err(_) => ()
    Ok(_) => fail("expected an invalid credit total")
  }
}

///|
test "credit totals expose the standard projection" {
  let state = planner_state()
  state.enrollments.push(
    @tanikun-domain.Enrollment::in_progress(planner_offering_id("offering-1")),
  )
  let totals = match state.planner_summary() {
    Ok(totals) => totals
    Err(_) => fail("expected credit totals")
  }
  assert_eq(totals.confirmed.half_units(), 0)
  assert_eq(totals.standard.half_units(), 4)
  assert_eq(totals.optimistic.half_units(), 4)
}

///|
test "enrollment status changes replace the enrollment and freeze a pass snapshot" {
  let id = planner_offering_id("offering-1")
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=id),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=id,
      target=@app.EnrollmentStatusTarget::InProgress,
    ),
  )
  match state.enrollments[0].status {
    @tanikun-domain.EnrollmentStatus::InProgress => ()
    _ => fail("expected in-progress status")
  }
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=id,
      target=@app.EnrollmentStatusTarget::Passed(
        grade=@tanikun-domain.PassingGrade::Excellent,
      ),
    ),
  )
  let snapshot = match state.enrollments[0].snapshot() {
    Some(snapshot) => snapshot
    None => fail("expected a pass snapshot")
  }
  assert_eq(snapshot.name, "Physics")
  assert_eq(snapshot.credits.half_units(), 4)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=id,
      target=@app.EnrollmentStatusTarget::Passed(
        grade=@tanikun-domain.PassingGrade::Good,
      ),
    ),
  )
  let changed_snapshot = match state.enrollments[0].snapshot() {
    Some(snapshot) => snapshot
    None => fail("expected a pass snapshot")
  }
  assert_eq(changed_snapshot.name, "Physics")
  assert_eq(changed_snapshot.credits.half_units(), 4)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=id,
      target=@app.EnrollmentStatusTarget::Failed(
        grade=@tanikun-domain.FailingGrade::Fail,
      ),
    ),
  )
  match state.enrollments[0].snapshot() {
    None => ()
    Some(_) => fail("failed enrollment must not keep a pass snapshot")
  }
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=id,
      target=@app.EnrollmentStatusTarget::NotTaken,
    ),
  )
  match state.enrollments[0].snapshot() {
    None => ()
    Some(_) => fail("not-taken enrollment must not keep a pass snapshot")
  }
}

///|
test "a later override does not change a frozen pass snapshot" {
  let id = planner_offering_id("offering-1")
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=id),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=id,
      target=@app.EnrollmentStatusTarget::Passed(
        grade=@tanikun-domain.PassingGrade::Excellent,
      ),
    ),
  )
  let course_id = state.catalogue[0].id
  let name_override = planner_expect_ok(
    @tanikun-domain.Override::new(
      @tanikun-domain.OverrideTarget::Course(course_id),
      @tanikun-domain.OverrideAttribute::DisplayName,
      @tanikun-domain.OverrideValue::Text("Renamed Physics"),
    ),
  )
  let overrides = planner_expect_ok(
    @tanikun-domain.Overrides::new([name_override]),
  )
  let state = @app.PlannerState::new(
    state.catalogue,
    state.offerings,
    state.enrollments,
    overrides,
    state.profile,
    state.requirement_sets,
    state.custom_categories,
  )
  let snapshot = match state.enrollments[0].snapshot() {
    Some(snapshot) => snapshot
    None => fail("expected a pass snapshot")
  }
  assert_eq(snapshot.name, "Physics")
}

///|
test "updating an unknown enrollment reports an error" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=planner_offering_id("missing"),
      target=@app.EnrollmentStatusTarget::InProgress,
    ),
  )
  match state.error {
    Some(error) =>
      assert_true(error.kind == @app.UiErrorKind::UnknownEnrollment)
    None => fail("expected an unknown-enrollment error")
  }
}

///|
test "a failed course can be retaken through another offering" {
  let id = planner_offering_id("offering-1")
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=id),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=id,
      target=@app.EnrollmentStatusTarget::Failed(
        grade=@tanikun-domain.FailingGrade::Fail,
      ),
    ),
  )
  let retake = planner_offering(
    "retake-s2",
    state.catalogue[0],
    @tanikun-domain.Term::S2,
    [planner_slot(@tanikun-domain.DayOfWeek::Tuesday, 2)],
  )
  state.offerings.push(retake)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("retake-s2")),
  )
  assert_eq(state.enrollments.length(), 2)
}

///|
fn open_custom_form(state : @app.PlannerState) -> @app.PlannerState {
  @app.update_planner(state, @app.PlannerMsg::OpenCustomCourseForm)
}

///|
fn update_custom(
  state : @app.PlannerState,
  field : @app.CustomCourseField,
  value : String,
) -> @app.PlannerState {
  @app.update_planner(
    state,
    @app.PlannerMsg::UpdateCustomCourseField(field~, value~),
  )
}

///|
test "a valid custom course and offering are added to the planner" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::OpenCataloguePicker,
  )
  let state = open_custom_form(state)
  let state = update_custom(
    state,
    @app.CustomCourseField::Name,
    "Linear Algebra",
  )
  let state = update_custom(state, @app.CustomCourseField::Credits, "5")
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::ToggleCustomTerm(term=@app.PlannerTerm::S1),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::ToggleCustomTerm(term=@app.PlannerTerm::S2),
  )
  let state = update_custom(state, @app.CustomCourseField::Day, "2")
  let state = update_custom(state, @app.CustomCourseField::Period, "5")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  assert_eq(state.catalogue.length(), 2)
  assert_eq(state.offerings.length(), 2)
  assert_eq(state.catalogue[1].name, "Linear Algebra")
  assert_eq(state.catalogue[1].credits.half_units(), 5)
  assert_eq(state.offerings[1].id.value, "user-offering-1")
  assert_true(state.selected_term == @app.PlannerTerm::S2)
  match state.picker {
    Some(@app.PickerTarget::All) => ()
    _ => fail("custom course submit should open the catalogue")
  }
  match state.custom_form {
    None => ()
    Some(_) => fail("custom course form should close after submit")
  }
}

///|
test "an invalid custom course name stays in the form with a field error" {
  let state = @app.update_planner(
    open_custom_form(planner_state()),
    @app.PlannerMsg::SubmitCustomCourse,
  )
  assert_eq(state.catalogue.length(), 1)
  match state.custom_form {
    Some(form) =>
      match form.error_field {
        Some(@app.CustomCourseField::Name) => ()
        _ => fail("expected a name field error")
      }
    None => fail("invalid custom course should keep the form open")
  }
}

///|
test "invalid custom credits and slots report field errors" {
  let state = open_custom_form(planner_state())
  let state = update_custom(state, @app.CustomCourseField::Name, "Bad")
  let state = update_custom(state, @app.CustomCourseField::Credits, "0")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  match state.custom_form {
    Some(form) =>
      match form.error_field {
        Some(@app.CustomCourseField::Credits) => ()
        _ => fail("expected a credits field error")
      }
    None => fail("invalid credits should keep the form open")
  }
  let state = update_custom(state, @app.CustomCourseField::Credits, "4")
  let state = update_custom(state, @app.CustomCourseField::Day, "9")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  match state.custom_form {
    Some(form) =>
      match form.error_field {
        Some(@app.CustomCourseField::Day) => ()
        _ => fail("expected a day field error")
      }
    None => fail("invalid slot should keep the form open")
  }
  assert_eq(state.catalogue.length(), 1)
}

///|
test "an intensive custom offering has no slots" {
  let state = open_custom_form(planner_state())
  let state = update_custom(state, @app.CustomCourseField::Name, "Intensive")
  let state = update_custom(
    state,
    @app.CustomCourseField::Schedule,
    "intensive",
  )
  let state = update_custom(state, @app.CustomCourseField::Term, "S")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  assert_eq(state.catalogue.length(), 2)
  match state.offerings[1].schedule() {
    @tanikun-domain.OfferingSchedule::Intensive(semester~) =>
      assert_true(semester == @tanikun-domain.Semester::S)
    _ => fail("expected an intensive offering")
  }
  assert_true(state.offerings[1].slots().is_empty())
  assert_true(state.selected_term == @app.PlannerTerm::S1)
}

///|
fn create_named_custom_course(
  state : @app.PlannerState,
  name : String,
) -> @app.PlannerState {
  let state = open_custom_form(state)
  let state = update_custom(state, @app.CustomCourseField::Name, name)
  @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
}

///|
test "a custom regular offering supports multiple terms" {
  let state = open_custom_form(planner_state())
  let state = update_custom(state, @app.CustomCourseField::Name, "Spanning")
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::ToggleCustomTerm(term=@app.PlannerTerm::S2),
  )
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  match state.offerings[1].schedule() {
    @tanikun-domain.OfferingSchedule::Regular(terms~) =>
      assert_eq(terms.length(), 2)
    _ => fail("expected a regular offering")
  }
  assert_true(state.selected_term == @app.PlannerTerm::S1)
}

///|
test "a custom course can be edited without changing its identity" {
  let state = create_named_custom_course(planner_state(), "Before")
  let course_id = state.catalogue[1].id
  let offering_id = state.offerings[1].id
  let state = @app.update_planner(state, @app.PlannerMsg::OpenCataloguePicker)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::OpenEditCustomCourse(offering_id~),
  )
  let state = update_custom(state, @app.CustomCourseField::Name, "After")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  assert_eq(state.catalogue.length(), 2)
  assert_eq(state.offerings.length(), 2)
  assert_true(state.catalogue[1].id == course_id)
  assert_true(state.offerings[1].id == offering_id)
  assert_eq(state.catalogue[1].name, "After")
  assert_eq(state.next_custom_course_number, 2)
  match state.picker {
    Some(@app.PickerTarget::All) => ()
    _ => fail("edited offering should return to the catalogue picker")
  }
}

///|
test "an unenrolled custom course can be deleted" {
  let state = create_named_custom_course(planner_state(), "Delete me")
  let course_id = state.catalogue[1].id
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::DeleteCustomCourse(course_id~),
  )
  assert_eq(state.catalogue.length(), 1)
  assert_eq(state.offerings.length(), 1)
  assert_eq(state.custom_course_ids.length(), 0)
  match state.error {
    None => ()
    Some(_) => fail("deleting an unenrolled custom course should succeed")
  }
}

///|
test "an enrolled custom course cannot be deleted" {
  let state = create_named_custom_course(planner_state(), "Enrolled")
  let course_id = state.catalogue[1].id
  let offering_id = state.offerings[1].id
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id~),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::DeleteCustomCourse(course_id~),
  )
  assert_eq(state.catalogue.length(), 2)
  match state.error {
    Some(error) => assert_true(error.kind == @app.UiErrorKind::General)
    None => fail("enrolled custom course deletion should fail")
  }
}

///|
test "opening the custom form from a slot picker prefills the slot" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::OpenSlotPicker(
      day=@tanikun-domain.DayOfWeek::Tuesday,
      period=3,
    ),
  )
  let state = @app.update_planner(state, @app.PlannerMsg::OpenCustomCourseForm)
  match state.custom_form {
    Some(form) => {
      assert_eq(form.day, "1")
      assert_eq(form.period, "3")
      assert_true(form.schedule == @app.CustomCourseSchedule::Regular)
    }
    None => fail("expected the custom form")
  }
}

///|
test "regular custom terms must stay in one semester" {
  let state = open_custom_form(planner_state())
  let state = update_custom(state, @app.CustomCourseField::Name, "Mixed")
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::ToggleCustomTerm(term=@app.PlannerTerm::S2),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::ToggleCustomTerm(term=@app.PlannerTerm::A1),
  )
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  assert_eq(state.catalogue.length(), 1)
  match state.custom_form {
    Some(form) =>
      match form.error_field {
        Some(@app.CustomCourseField::Term) => ()
        _ => fail("expected a term field error")
      }
    None => fail("mixed custom terms should keep the form open")
  }
}

///|
test "creating from a slot picker returns to that slot picker" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::OpenSlotPicker(
      day=@tanikun-domain.DayOfWeek::Monday,
      period=3,
    ),
  )
  let state = open_custom_form(state)
  let state = update_custom(state, @app.CustomCourseField::Name, "Slot custom")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  match state.picker {
    Some(@app.PickerTarget::Slot(day~, period~)) => {
      assert_true(day == @tanikun-domain.DayOfWeek::Monday)
      assert_eq(period, 3)
    }
    _ => fail("custom creation should return to the slot picker")
  }
}

///|
test "creating from the intensive picker returns to the intensive picker" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::OpenIntensivePicker,
  )
  let state = open_custom_form(state)
  let state = update_custom(
    state,
    @app.CustomCourseField::Name,
    "Intensive custom",
  )
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  match state.picker {
    Some(@app.PickerTarget::Intensive) => ()
    _ => fail("custom creation should return to the intensive picker")
  }
}

///|
test "editing an enrolled custom offering rejects a slot conflict" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("offering-1")),
  )
  let state = create_named_custom_course(state, "Custom")
  let offering_id = state.offerings[1].id
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id~),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::OpenEditCustomCourse(offering_id~),
  )
  let state = update_custom(state, @app.CustomCourseField::Day, "0")
  let state = update_custom(state, @app.CustomCourseField::Period, "1")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  match state.custom_form {
    Some(form) =>
      match form.error_field {
        Some(@app.CustomCourseField::Schedule) => ()
        _ => fail("expected a schedule field error")
      }
    None => fail("conflicting custom edit should keep the form open")
  }
  assert_true(
    state.offerings[1].slots()[0].day == @tanikun-domain.DayOfWeek::Tuesday,
  )
}

///|
fn open_override_form(
  state : @app.PlannerState,
  offering_id : @tanikun-domain.OfferingId,
) -> @app.PlannerState {
  @app.update_planner(state, @app.PlannerMsg::OpenOverrideEditor(offering_id~))
}

///|
fn update_override(
  state : @app.PlannerState,
  field : @app.OverrideField,
  value : String,
) -> @app.PlannerState {
  @app.update_planner(
    state,
    @app.PlannerMsg::UpdateOverrideField(field~, value~),
  )
}

///|
test "a course name override changes the timetable and catalogue" {
  let id = planner_offering_id("offering-1")
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=id),
  )
  let state = open_override_form(state, id)
  let state = update_override(state, @app.OverrideField::Name, "Physics Honors")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitOverride)
  match state.override_form {
    None => ()
    Some(_) => fail("override submit should close the form")
  }
  assert_eq(state.overrides.len(), 1)
  assert_eq(
    state.scheduled_blocks(@app.PlannerTerm::S1)[0].course_name,
    "Physics Honors",
  )
  assert_eq(
    state.catalogue_entries(@app.PlannerTerm::S1)[0].course_name,
    "Physics Honors",
  )
}

///|
test "a credits override changes totals and catalogue credits" {
  let id = planner_offering_id("offering-1")
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=id),
  )
  let state = open_override_form(state, id)
  let state = update_override(state, @app.OverrideField::Credits, "6")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitOverride)
  let totals = match state.planner_summary() {
    Ok(value) => value
    Err(_) => fail("expected credit totals")
  }
  assert_eq(totals.optimistic.half_units(), 6)
  assert_eq(
    state.catalogue_entries(@app.PlannerTerm::S1)[0].credits.half_units(),
    6,
  )
}

///|
test "a slots override moves the scheduled block" {
  let id = planner_offering_id("offering-1")
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=id),
  )
  let state = open_override_form(state, id)
  let state = @app.update_planner(state, @app.PlannerMsg::ToggleOverrideSlots)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateOverrideDay(value="1"),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateOverridePeriod(value="4"),
  )
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitOverride)
  match state.override_form {
    None => ()
    Some(form) => fail(form.error_message)
  }
  let block = state.scheduled_blocks(@app.PlannerTerm::S1)[0]
  assert_true(block.day == @tanikun-domain.DayOfWeek::Tuesday)
  assert_eq(block.period.value(), 4)
  assert_eq(state.overrides.len(), 1)
  let display = match state.offering_display(id) {
    Some(value) => value
    None => fail("expected an offering display")
  }
  assert_true(display.slots[0].day == @tanikun-domain.DayOfWeek::Tuesday)
  assert_eq(display.slots[0].period.value(), 4)
  let state = open_override_form(state, id)
  let state = @app.update_planner(state, @app.PlannerMsg::ToggleOverrideSlots)
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitOverride)
  assert_eq(state.overrides.len(), 0)
  let block = state.scheduled_blocks(@app.PlannerTerm::S1)[0]
  assert_true(block.day == @tanikun-domain.DayOfWeek::Monday)
  assert_eq(block.period.value(), 1)
}

///|
test "a conflicting slot override keeps the form open" {
  let state = @app.sample_state()
  let id = planner_offering_id("phy101-s1")
  let state = open_override_form(state, id)
  let state = @app.update_planner(state, @app.PlannerMsg::ToggleOverrideSlots)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateOverrideDay(value="0"),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateOverridePeriod(value="2"),
  )
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitOverride)
  match state.override_form {
    Some(form) =>
      match form.error_field {
        Some(@app.OverrideField::Slots) => ()
        _ => fail("expected a slots field error")
      }
    None => fail("conflicting override should keep the form open")
  }
  assert_eq(state.overrides.len(), 0)
}

///|
test "removing an override restores the master values" {
  let id = planner_offering_id("offering-1")
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=id),
  )
  let state = open_override_form(state, id)
  let state = update_override(state, @app.OverrideField::Name, "Temporary")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitOverride)
  let state = open_override_form(state, id)
  let state = update_override(state, @app.OverrideField::Name, "")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitOverride)
  assert_eq(state.overrides.len(), 0)
  assert_eq(
    state.scheduled_blocks(@app.PlannerTerm::S1)[0].course_name,
    "Physics",
  )
}

///|
test "an invalid override name keeps the form open" {
  let id = planner_offering_id("offering-1")
  let state = open_override_form(planner_state(), id)
  let state = update_override(state, @app.OverrideField::Name, "   ")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitOverride)
  match state.override_form {
    Some(form) =>
      match form.error_field {
        Some(@app.OverrideField::Name) => ()
        _ => fail("expected a name field error")
      }
    None => fail("invalid override should keep the form open")
  }
  assert_eq(state.overrides.len(), 0)
}

///|
test "a later override does not change a frozen pass display" {
  let id = planner_offering_id("offering-1")
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=id),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=id,
      target=@app.EnrollmentStatusTarget::Passed(
        grade=@tanikun-domain.PassingGrade::Good,
      ),
    ),
  )
  let state = open_override_form(state, id)
  let state = update_override(state, @app.OverrideField::Name, "Renamed")
  let state = update_override(state, @app.OverrideField::Credits, "6")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitOverride)
  assert_eq(
    state.scheduled_blocks(@app.PlannerTerm::S1)[0].course_name,
    "Physics",
  )
  let display = match state.offering_display(id) {
    Some(value) => value
    None => fail("expected an offering display")
  }
  assert_eq(display.name, "Physics")
  assert_eq(display.credits.half_units(), 4)
  let entries = state.catalogue_entries(@app.PlannerTerm::S1)
  assert_eq(entries.length(), 1)
  assert_eq(entries[0].course_name, "Physics")
  assert_eq(entries[0].credits.half_units(), 4)
  let totals = match state.planner_summary() {
    Ok(value) => value
    Err(_) => fail("expected credit totals")
  }
  assert_eq(totals.confirmed.half_units(), 4)
}

///|
test "offering display exposes master values before an override" {
  let state = planner_state()
  let display = match
    state.offering_display(planner_offering_id("offering-1")) {
    Some(value) => value
    None => fail("expected an offering display")
  }
  assert_eq(display.name, "Physics")
  assert_eq(display.credits.half_units(), 4)
  assert_eq(display.slots.length(), 1)
  assert_true(display.slots[0].day == @tanikun-domain.DayOfWeek::Monday)
  assert_eq(display.slots[0].period.value(), 1)
}

///|
test "profile candidates come from the requirement sets" {
  let state = @app.sample_state()
  let programs = state.program_ids()
  assert_eq(programs.length(), 2)
  assert_true(programs[0].value == "applied-physics")
  assert_true(programs[1].value == "applied-chemistry")
  let physics_years = state.advancement_years(programs[0])
  assert_eq(physics_years.length(), 2)
  assert_eq(physics_years[0].year(), 2026)
  assert_eq(physics_years[1].year(), 2025)
  let chemistry_years = state.advancement_years(programs[1])
  assert_eq(chemistry_years.length(), 1)
  assert_eq(chemistry_years[0].year(), 2026)
}

///|
test "switching programs keeps planner data and recomputes the summary" {
  let state = @app.sample_state()
  let state = create_named_custom_course(state, "Profile Custom")
  let offering_id = planner_offering_id("phy101-s1")
  let state = open_override_form(state, offering_id)
  let state = update_override(
    state,
    @app.OverrideField::Name,
    "Profile Override",
  )
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitOverride)
  let catalogue_len = state.catalogue.length()
  let offering_len = state.offerings.length()
  let enrollment_len = state.enrollments.length()
  let custom_len = state.custom_course_ids.length()
  let selected = state.selected_term
  let visible_days = state.visible_days
  let visible_periods = state.visible_periods
  let before = match state.planner_summary() {
    Ok(summary) => summary.requirement_root.optimistic.satisfaction
    Err(_) => fail("expected the initial requirement summary")
  }
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectProgram(program_id="applied-chemistry"),
  )
  assert_true(state.profile.program_id.value == "applied-chemistry")
  assert_true(state.profile.advancement_year.year() == 2026)
  assert_eq(state.catalogue.length(), catalogue_len)
  assert_eq(state.offerings.length(), offering_len)
  assert_eq(state.enrollments.length(), enrollment_len)
  assert_eq(state.custom_course_ids.length(), custom_len)
  assert_true(state.selected_term == selected)
  assert_eq(state.visible_days, visible_days)
  assert_eq(state.visible_periods, visible_periods)
  assert_eq(state.overrides.len(), 1)
  let after = match state.planner_summary() {
    Ok(summary) => summary.requirement_root.optimistic.satisfaction
    Err(_) => fail("expected the switched requirement summary")
  }
  assert_true(before == @tanikun-requirements.Satisfaction::Satisfied)
  assert_true(after != @tanikun-requirements.Satisfaction::Satisfied)
}

///|
test "switching the advancement year uses the selected program" {
  let state = @app.sample_state()
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectAdvancementYear(year="2025"),
  )
  assert_true(state.profile.program_id.value == "applied-physics")
  assert_eq(state.profile.advancement_year.year(), 2025)
  match state.active_requirement_set() {
    Some(set) => assert_eq(set.key.advancement_year.year(), 2025)
    None => fail("expected a requirement set for the prior year")
  }
}

///|
test "a missing profile requirement set is visible and recoverable" {
  let state = @app.sample_state()
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectAdvancementYear(year="2024"),
  )
  assert_eq(state.profile.advancement_year.year(), 2024)
  match state.active_requirement_set() {
    None => ()
    Some(_) => fail("expected no requirement set")
  }
  match state.planner_summary() {
    Err(_) => ()
    Ok(_) => fail("expected a missing requirement-set error")
  }
  match state.planner_summary() {
    Err(_) => ()
    Ok(_) => fail("expected totals to fail without a requirement set")
  }
  match state.error {
    Some(error) =>
      assert_true(error.kind == @app.UiErrorKind::MissingRequirementSet)
    None => fail("expected a visible missing-set error")
  }
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectAdvancementYear(year="2026"),
  )
  match state.planner_summary() {
    Ok(_) => ()
    Err(_) => fail("recovering to an available year should work")
  }
}

///|
test "selecting a program without requirement sets keeps the old profile" {
  let state = planner_state()
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectProgram(program_id="applied-chemistry"),
  )
  assert_true(state.profile.program_id.value == "applied-physics")
  assert_true(state.profile.advancement_year.year() == 2026)
  match state.error {
    Some(error) =>
      assert_true(error.kind == @app.UiErrorKind::MissingRequirementSet)
    None => fail("expected a missing-set error")
  }
  match state.planner_summary() {
    Ok(_) => ()
    Err(_) => fail("the previous profile should still evaluate")
  }
}

///|
test "a program switch keeps the current year when the target program has it" {
  let base = planner_state()
  let physics = base.profile.program_id
  let year = base.profile.advancement_year
  let chemistry = planner_expect_ok(
    @tanikun-domain.ProgramId::new("applied-chemistry"),
  )
  let prior_year = planner_expect_ok(@tanikun-domain.AcademicYear::new(2025))
  let sets = planner_expect_ok(
    @tanikun-requirements.RequirementSets::new([
      planner_requirement_set(physics, year),
      planner_requirement_set(chemistry, prior_year),
      planner_requirement_set(chemistry, year),
    ]),
  )
  let state = @app.PlannerState::new(
    base.catalogue,
    base.offerings,
    base.enrollments,
    base.overrides,
    base.profile,
    sets,
    [],
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectProgram(program_id="applied-chemistry"),
  )
  assert_true(state.profile.program_id.value == "applied-chemistry")
  assert_eq(state.profile.advancement_year.year(), 2026)
}

///|
test "a program switch falls back to its only available year" {
  let state = @app.update_planner(
    @app.sample_state(),
    @app.PlannerMsg::SelectAdvancementYear(year="2025"),
  )
  assert_eq(state.profile.advancement_year.year(), 2025)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectProgram(program_id="applied-chemistry"),
  )
  assert_true(state.profile.program_id.value == "applied-chemistry")
  assert_eq(state.profile.advancement_year.year(), 2026)
}

///|
test "timetable years follow the third-year advancement mapping" {
  let state = @app.sample_state()
  let years = state.timetable_years()
  assert_eq(years.length(), 4)
  assert_eq(years[0].grade, 1)
  assert_eq(years[0].academic_year.year(), 2024)
  assert_eq(years[1].grade, 2)
  assert_eq(years[1].academic_year.year(), 2025)
  assert_eq(years[2].grade, 3)
  assert_eq(years[2].academic_year.year(), 2026)
  assert_eq(years[3].grade, 4)
  assert_eq(years[3].academic_year.year(), 2027)
}

///|
test "grade and academic-year selection stay synchronized" {
  let state = @app.sample_state()
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectGrade(grade="4"),
  )
  assert_eq(state.timetable_year.grade, 4)
  assert_eq(state.timetable_year.academic_year.year(), 2027)
  assert_true(state.selected_term == @app.PlannerTerm::S2)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectGrade(grade="1"),
  )
  assert_eq(state.timetable_year.grade, 1)
  assert_eq(state.timetable_year.academic_year.year(), 2024)
  assert_true(state.selected_term == @app.PlannerTerm::S2)
}

///|
test "timetable projections and placement follow the selected year" {
  let state = @app.sample_state()
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectGrade(grade="4"),
  )
  let entries = state.catalogue_entries(@app.PlannerTerm::S1)
  assert_eq(entries.length(), 1)
  assert_eq(entries[0].course_name, "Advanced Physics")
  assert_eq(state.scheduled_blocks(@app.PlannerTerm::S1).length(), 0)
  let offering_id = planner_offering_id("phy601-s1")
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id~),
  )
  let blocks = state.scheduled_blocks(@app.PlannerTerm::S1)
  assert_eq(blocks.length(), 1)
  assert_eq(blocks[0].course_name, "Advanced Physics")
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectGrade(grade="3"),
  )
  let mut advanced_visible = false
  for entry in state.catalogue_entries(@app.PlannerTerm::S1) {
    if entry.course_name == "Advanced Physics" {
      advanced_visible = true
    }
  }
  assert_true(!advanced_visible)
  let mut advanced_block = false
  for block in state.scheduled_blocks(@app.PlannerTerm::S1) {
    if block.course_name == "Advanced Physics" {
      advanced_block = true
    }
  }
  assert_true(!advanced_block)
}

///|
test "a profile change remaps the timetable year by grade" {
  let state = @app.sample_state()
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectGrade(grade="4"),
  )
  assert_eq(state.timetable_year.grade, 4)
  assert_eq(state.timetable_year.academic_year.year(), 2027)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectAdvancementYear(year="2025"),
  )
  assert_eq(state.profile.advancement_year.year(), 2025)
  assert_eq(state.timetable_year.grade, 4)
  assert_eq(state.timetable_year.academic_year.year(), 2026)
}

///|
test "adding an offering from another year is rejected" {
  let state = @app.sample_state()
  let offering_id = planner_offering_id("phy601-s1")
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id~),
  )
  match state.error {
    Some(error) =>
      assert_true(error.kind == @app.UiErrorKind::DifferentAcademicYear)
    None => fail("expected a different-year error")
  }
  let mut advanced_block = false
  for block in state.scheduled_blocks(@app.PlannerTerm::S1) {
    if block.course_name == "Advanced Physics" {
      advanced_block = true
    }
  }
  assert_true(!advanced_block)
}

///|
test "a custom course uses the selected timetable year" {
  let state = @app.update_planner(
    @app.sample_state(),
    @app.PlannerMsg::SelectGrade(grade="4"),
  )
  let state = create_named_custom_course(state, "Year Four Custom")
  let offering = state.offerings[state.offerings.length() - 1]
  assert_eq(offering.academic_year.year(), 2027)
}

///|
test "a custom course can be added to a year with no offerings" {
  let state = @app.update_planner(
    @app.sample_state(),
    @app.PlannerMsg::SelectGrade(grade="1"),
  )
  let before = state.enrollments.length()
  let state = create_named_custom_course(state, "Empty Year Custom")
  let offering = state.offerings[state.offerings.length() - 1]
  assert_eq(offering.academic_year.year(), 2024)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=offering.id),
  )
  assert_eq(state.enrollments.length(), before + 1)
  let block = state.scheduled_blocks(@app.PlannerTerm::S1)[0]
  assert_eq(block.course_name, "Empty Year Custom")
}

///|
test "slot conflicts ignore enrollments from another academic year" {
  let state = @app.sample_state()
  let mut advanced = None
  for course in state.catalogue {
    if course.name == "Advanced Physics" {
      advanced = Some(course)
    }
  }
  let course = match advanced {
    Some(value) => value
    None => fail("expected the 2027 sample course")
  }
  let offering = planner_expect_ok(
    @tanikun-domain.CourseOffering::new(
      planner_offering_id("phy601-collision"),
      course.id,
      planner_expect_ok(@tanikun-domain.AcademicYear::new(2027)),
      @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::S1]),
      @tanikun-domain.OfferingStatus::Offered,
      [planner_slot(@tanikun-domain.DayOfWeek::Monday, 1)],
    ),
  )
  let offerings = state.offerings.copy()
  offerings.push(offering)
  let state = @app.PlannerState::new(
    state.catalogue,
    offerings,
    state.enrollments,
    state.overrides,
    state.profile,
    state.requirement_sets,
    state.custom_categories,
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectGrade(grade="4"),
  )
  let before = state.enrollments.length()
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(
      offering_id=planner_offering_id("phy601-collision"),
    ),
  )
  assert_eq(state.enrollments.length(), before + 1)
  match state.error {
    None => ()
    Some(_) => fail("cross-year slot collision should not block placement")
  }
  let mut placed = false
  for block in state.scheduled_blocks(@app.PlannerTerm::S1) {
    if block.course_name == "Advanced Physics" {
      placed = true
    }
  }
  assert_true(placed)
}

///|
test "planner summary exposes credits, categories, and requirement status" {
  let state = @app.sample_state()
  let summary = match state.planner_summary() {
    Ok(value) => value
    Err(_) => fail("expected a planner summary")
  }
  assert_eq(summary.confirmed.half_units(), 0)
  assert_eq(summary.standard.half_units(), 0)
  assert_eq(summary.optimistic.half_units(), 12)
  assert_eq(summary.categories.length(), 3)
  assert_eq(summary.categories[0].name, "基礎物理")
  assert_eq(summary.categories[0].optimistic.half_units(), 4)
  assert_eq(summary.categories[1].name, "実験")
  assert_eq(summary.categories[1].optimistic.half_units(), 2)
  assert_eq(summary.categories[2].name, "演習")
  assert_eq(summary.categories[2].optimistic.half_units(), 6)
  assert_true(
    summary.requirement_root.optimistic.satisfaction ==
    @tanikun-requirements.Satisfaction::Satisfied,
  )
  assert_eq(summary.requirement_root.label, "全体")
  assert_eq(summary.requirement_root.confirmed.status_label(), "不足")
  assert_eq(summary.requirement_root.standard.status_label(), "不足")
  assert_eq(summary.requirement_root.optimistic.status_label(), "達成")
  assert_eq(
    summary.requirement_root.optimistic.progress,
    "要件 2 / 2件（部分 0）",
  )
  assert_eq(summary.requirement_root.children.length(), 2)
  assert_eq(summary.requirement_root.children[0].label, "合計単位数")
  assert_eq(summary.requirement_root.children[1].label, "区分単位数")
}

///|
test "planner summary recomputes after a status change" {
  let id = planner_offering_id("phy101-s1")
  let state = @app.update_planner(
    @app.sample_state(),
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=id,
      target=@app.EnrollmentStatusTarget::Passed(
        grade=@tanikun-domain.PassingGrade::Good,
      ),
    ),
  )
  let summary = match state.planner_summary() {
    Ok(value) => value
    Err(_) => fail("expected a planner summary")
  }
  assert_eq(summary.confirmed.half_units(), 4)
  assert_eq(summary.categories[0].confirmed.half_units(), 4)
  assert_eq(summary.requirement_root.confirmed.status_label(), "達成")
  assert_eq(summary.requirement_root.standard.status_label(), "達成")
  assert_eq(summary.requirement_root.optimistic.status_label(), "達成")
}

///|
test "planner summary reports invalid input" {
  let state = @app.sample_state()
  let enrollments = state.enrollments.copy()
  enrollments.push(
    @tanikun-domain.Enrollment::planned(planner_offering_id("missing-offering")),
  )
  let state = @app.PlannerState::new(
    state.catalogue,
    state.offerings,
    enrollments,
    state.overrides,
    state.profile,
    state.requirement_sets,
    state.custom_categories,
  )
  match state.planner_summary() {
    Err(_) => ()
    Ok(_) => fail("expected an invalid summary")
  }
  match state.planner_summary() {
    Err(_) => ()
    Ok(_) => fail("expected invalid credit totals")
  }
}

///|
test "a credits override updates the summary" {
  let state = @app.sample_state()
  let offering_id = planner_offering_id("phy101-s1")
  let state = open_override_form(state, offering_id)
  let state = update_override(state, @app.OverrideField::Credits, "6")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitOverride)
  let summary = match state.planner_summary() {
    Ok(value) => value
    Err(_) => fail("expected a planner summary")
  }
  assert_eq(summary.confirmed.half_units(), 0)
  assert_eq(summary.standard.half_units(), 0)
  assert_eq(summary.optimistic.half_units(), 14)
  assert_eq(summary.categories[0].optimistic.half_units(), 6)
}

///|
test "undo restores a passed enrollment with its grade and snapshot" {
  let id = planner_offering_id("offering-1")
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=id),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=id,
      target=@app.EnrollmentStatusTarget::Passed(
        grade=@tanikun-domain.PassingGrade::Good,
      ),
    ),
  )
  let before = state.enrollments[0]
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::RemoveEnrollment(offering_id=id),
  )
  assert_eq(state.enrollments.length(), 0)
  assert_true(state.undo_available())
  let state = @app.update_planner(state, @app.PlannerMsg::UndoEnrollmentRemoval)
  assert_eq(state.enrollments.length(), 1)
  assert_true(!state.undo_available())
  let after = state.enrollments[0]
  assert_true(after.offering_id == before.offering_id)
  assert_true(after.is_passed())
  match after.status {
    @tanikun-domain.EnrollmentStatus::Confirmed(
      @tanikun-domain.ConfirmedGrade::Passed(grade~, ..)
    ) => assert_true(grade == @tanikun-domain.PassingGrade::Good)
    _ => fail("expected the passed grade to survive undo")
  }
  let snapshot = match after.snapshot() {
    Some(value) => value
    None => fail("expected the pass snapshot to survive undo")
  }
  assert_eq(snapshot.name, "Physics")
  assert_eq(snapshot.credits.half_units(), 4)
}

///|
test "undo disappears after an unrelated state change" {
  let id = planner_offering_id("offering-1")
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=id),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::RemoveEnrollment(offering_id=id),
  )
  assert_true(state.undo_available())
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2),
  )
  assert_true(!state.undo_available())
  let state = @app.update_planner(state, @app.PlannerMsg::UndoEnrollmentRemoval)
  assert_eq(state.enrollments.length(), 0)
}

///|
test "a slot override does not move a passed block" {
  let id = planner_offering_id("offering-1")
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=id),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=id,
      target=@app.EnrollmentStatusTarget::Passed(
        grade=@tanikun-domain.PassingGrade::Good,
      ),
    ),
  )
  let state = open_override_form(state, id)
  let state = @app.update_planner(state, @app.PlannerMsg::ToggleOverrideSlots)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateOverrideDay(value="1"),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateOverridePeriod(value="4"),
  )
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitOverride)
  assert_eq(state.overrides.len(), 1)
  let block = state.scheduled_blocks(@app.PlannerTerm::S1)[0]
  assert_true(block.day == @tanikun-domain.DayOfWeek::Monday)
  assert_eq(block.period.value(), 1)
  let display = match state.offering_display(id) {
    Some(value) => value
    None => fail("expected an offering display")
  }
  assert_true(display.slots[0].day == @tanikun-domain.DayOfWeek::Monday)
  assert_eq(display.slots[0].period.value(), 1)
}

///|
test "frozen passed slots drive conflict checks in both directions" {
  let id = planner_offering_id("offering-1")
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=id),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=id,
      target=@app.EnrollmentStatusTarget::Passed(
        grade=@tanikun-domain.PassingGrade::Good,
      ),
    ),
  )
  let state = open_override_form(state, id)
  let state = @app.update_planner(state, @app.PlannerMsg::ToggleOverrideSlots)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateOverrideDay(value="1"),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateOverridePeriod(value="4"),
  )
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitOverride)
  let course = planner_course("PHY102", "Other Physics", 4)
  let catalogue = state.catalogue.copy()
  catalogue.push(course)

  let frozen = planner_offering(
    "offering-frozen",
    course,
    @tanikun-domain.Term::S1,
    [planner_slot(@tanikun-domain.DayOfWeek::Monday, 1)],
  )
  let offerings = state.offerings.copy()
  offerings.push(frozen)
  let frozen_state = @app.PlannerState::new(
    catalogue,
    offerings,
    state.enrollments,
    state.overrides,
    state.profile,
    state.requirement_sets,
    state.custom_categories,
  )
  let frozen_state = @app.update_planner(
    frozen_state,
    @app.PlannerMsg::AddOffering(
      offering_id=planner_offering_id("offering-frozen"),
    ),
  )
  match frozen_state.error {
    Some(error) => assert_true(error.kind == @app.UiErrorKind::SlotConflict)
    None => fail("frozen passed slot should reject placement")
  }

  let ghost = planner_offering(
    "offering-ghost",
    course,
    @tanikun-domain.Term::S1,
    [planner_slot(@tanikun-domain.DayOfWeek::Tuesday, 4)],
  )
  let offerings = state.offerings.copy()
  offerings.push(ghost)
  let ghost_state = @app.PlannerState::new(
    catalogue,
    offerings,
    state.enrollments,
    state.overrides,
    state.profile,
    state.requirement_sets,
    state.custom_categories,
  )
  let ghost_state = @app.update_planner(
    ghost_state,
    @app.PlannerMsg::AddOffering(
      offering_id=planner_offering_id("offering-ghost"),
    ),
  )
  match ghost_state.error {
    None => ()
    Some(_) => fail("overridden ghost slot should remain free")
  }
  assert_eq(ghost_state.enrollments.length(), 2)
}

///|
test "a custom course can be assigned to a requirement category" {
  let state = @app.sample_state()
  let before = match state.planner_summary() {
    Ok(value) => {
      let mut total = 0
      for category in value.categories {
        if category.name == "実験" {
          total = category.optimistic.half_units()
        }
      }
      total
    }
    Err(_) => fail("expected a summary")
  }
  let state = open_custom_form(state)
  let state = update_custom(state, @app.CustomCourseField::Name, "Lab Custom")
  let state = update_custom(state, @app.CustomCourseField::Category, "lab")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  assert_eq(state.custom_categories.length(), 1)
  let course_id = state.catalogue[state.catalogue.length() - 1].id
  assert_eq(state.category_name_for(course_id), Some("実験"))
  let offering_id = state.offerings[state.offerings.length() - 1].id
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id~),
  )
  let after = match state.planner_summary() {
    Ok(value) => {
      let mut total = 0
      for category in value.categories {
        if category.name == "実験" {
          total = category.optimistic.half_units()
        }
      }
      total
    }
    Err(_) => fail("expected a summary")
  }
  assert_eq(after, before + 4)
}

///|
test "a partially satisfied root does not fill the confirmed bar" {
  let state = @app.sample_state()
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=planner_offering_id("phy301-s"),
      target=@app.EnrollmentStatusTarget::Passed(
        grade=@tanikun-domain.PassingGrade::Good,
      ),
    ),
  )
  let summary = match state.planner_summary() {
    Ok(value) => value
    Err(_) => fail("expected a planner summary")
  }
  assert_eq(summary.confirmed.half_units(), 2)
  assert_eq(summary.requirement_root.confirmed.done, 0)
  assert_eq(summary.requirement_root.confirmed.total, 2)
  assert_eq(summary.requirement_root.confirmed.status_label(), "不足")
  assert_eq(summary.requirement_root.optimistic.status_label(), "達成")
  assert_eq(summary.requirement_root.confirmed.remaining, "あと 2件")
}
