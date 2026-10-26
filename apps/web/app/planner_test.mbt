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
  assert_eq(state.off_grid_entries(@app.PlannerTerm::A1).length(), 1)
  assert_eq(state.off_grid_entries(@app.PlannerTerm::W).length(), 1)
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
  let totals = match state.credit_totals() {
    Ok(totals) => totals
    Err(_) => fail("expected credit totals")
  }
  assert_eq(totals.confirmed.half_units(), 0)
  assert_eq(totals.standard.half_units(), 0)
  assert_eq(totals.projected.half_units(), 4)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::RemoveEnrollment(
      offering_id=planner_offering_id("offering-1"),
    ),
  )
  let totals = match state.credit_totals() {
    Ok(totals) => totals
    Err(_) => fail("expected empty credit totals")
  }
  assert_eq(totals.confirmed.half_units(), 0)
  assert_eq(totals.standard.half_units(), 0)
  assert_eq(totals.projected.half_units(), 0)
}

///|
test "invalid planner input reports a credit total error" {
  let state = planner_state()
  state.enrollments.push(
    @tanikun-domain.Enrollment::planned(planner_offering_id("missing-offering")),
  )
  match state.credit_totals() {
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
  let totals = match state.credit_totals() {
    Ok(totals) => totals
    Err(_) => fail("expected credit totals")
  }
  assert_eq(totals.confirmed.half_units(), 0)
  assert_eq(totals.standard.half_units(), 4)
  assert_eq(totals.projected.half_units(), 4)
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
    state.requirement_set,
    state.requirement_sets,
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
  let state = open_custom_form(planner_state())
  let state = update_custom(
    state,
    @app.CustomCourseField::Name,
    "Linear Algebra",
  )
  let state = update_custom(state, @app.CustomCourseField::Credits, "5")
  let state = update_custom(state, @app.CustomCourseField::Term, "S2")
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
