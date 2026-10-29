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
