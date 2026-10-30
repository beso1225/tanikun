///|
fn allocation_state() -> @app.PlannerState raise Error {
  let base = planner_state()
  let design = planner_course("DESIGN", "Design studio", 6)
  let lab = planner_course("LAB", "Coordinated lab", 4)
  let exercise = planner_course("EXERCISE", "Coordinated exercise", 2)
  let extra = planner_course("EXTRA", "Extra course", 4)
  let a = [
    planner_slot(@tanikun-domain.DayOfWeek::Monday, 3),
    planner_slot(@tanikun-domain.DayOfWeek::Monday, 4),
    planner_slot(@tanikun-domain.DayOfWeek::Wednesday, 3),
    planner_slot(@tanikun-domain.DayOfWeek::Wednesday, 4),
  ]
  let b = a.copy()
  b.push(planner_slot(@tanikun-domain.DayOfWeek::Tuesday, 4))
  b.push(planner_slot(@tanikun-domain.DayOfWeek::Tuesday, 5))
  let phased = planner_expect_ok(
    @tanikun-domain.CourseOffering::new(
      planner_offering_id("design"),
      design.id,
      base.profile.advancement_year,
      @tanikun-domain.OfferingSchedule::Regular(terms=[
        @tanikun-domain.Term::S1,
        @tanikun-domain.Term::S2,
      ]),
      @tanikun-domain.OfferingStatus::Offered,
      a,
    ),
  )
  let phased = planner_expect_ok(
    phased.with_term_slots([
      (@tanikun-domain.Term::S1, a),
      (@tanikun-domain.Term::S2, b),
    ]),
  )
  let proof = planner_expect_ok(
    @tanikun-domain.CoordinatedAllocation::new(
      "allocation", "Verified fictional course handout",
    ),
  )
  let slots = [planner_slot(@tanikun-domain.DayOfWeek::Thursday, 1)]
  let left = planner_offering("lab", lab, @tanikun-domain.Term::S1, slots).with_coordinated_allocation(
    proof,
  )
  let right = planner_offering(
    "exercise",
    exercise,
    @tanikun-domain.Term::S1,
    slots,
  ).with_coordinated_allocation(proof)
  let early = planner_offering("early", extra, @tanikun-domain.Term::S1, [
    planner_slot(@tanikun-domain.DayOfWeek::Tuesday, 4),
  ])
  let late = planner_offering("late", extra, @tanikun-domain.Term::S2, [
    planner_slot(@tanikun-domain.DayOfWeek::Tuesday, 4),
  ])
  @app.PlannerState::new(
    [design, lab, exercise, extra],
    [phased, left, right, early, late],
    [],
    base.overrides,
    base.profile,
    base.requirement_sets,
    [],
  )
}

///|
test "one phase-aware enrollment registers and passes all terms once" {
  let state = @app.update_planner(
    allocation_state(),
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("design")),
  )
  assert_true(state.error is None)
  assert_eq(state.enrollments.length(), 1)
  assert_eq(state.scheduled_blocks(@app.PlannerTerm::S1).length(), 4)
  assert_eq(state.scheduled_blocks(@app.PlannerTerm::S2).length(), 6)
  assert_eq(state.catalogue_entries(@app.PlannerTerm::S1)[0].slots.length(), 4)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=planner_offering_id("design"),
      target=@app.EnrollmentStatusTarget::Passed(
        grade=@tanikun-domain.PassingGrade::Good,
      ),
    ),
  )
  assert_eq(
    planner_expect_ok(state.planner_summary()).confirmed.half_units(),
    6,
  )
  assert_eq(state.scheduled_blocks(@app.PlannerTerm::S2).length(), 6)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::RemoveEnrollment(offering_id=planner_offering_id("design")),
  )
  assert_eq(state.scheduled_blocks(@app.PlannerTerm::S2).length(), 0)
  let state = @app.update_planner(state, @app.PlannerMsg::UndoEnrollmentRemoval)
  assert_eq(state.scheduled_blocks(@app.PlannerTerm::S1).length(), 4)
  assert_eq(state.scheduled_blocks(@app.PlannerTerm::S2).length(), 6)
}

///|
test "phase conflicts inspect every term without reserving another term's slots" {
  let state = @app.update_planner(
    allocation_state(),
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("early")),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("design")),
  )
  assert_true(state.error is None)
  let state = @app.update_planner(
    allocation_state(),
    @app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("late")),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S1),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("design")),
  )
  assert_true(state.error is Some(_))
  assert_eq(state.enrollments.length(), 1)
}

///|
test "source-backed coordinated courses remain independently enrolled" {
  let state = @app.update_planner(
    allocation_state(),
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("lab")),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("exercise")),
  )
  assert_true(state.error is None)
  assert_eq(state.scheduled_blocks(@app.PlannerTerm::S1).length(), 2)
  assert_eq(
    planner_expect_ok(state.planner_summary()).optimistic.half_units(),
    6,
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::RemoveEnrollment(offering_id=planner_offering_id("lab")),
  )
  assert_eq(state.enrollments.length(), 1)
  let state = @app.update_planner(state, @app.PlannerMsg::UndoEnrollmentRemoval)
  assert_eq(state.enrollments.length(), 2)
}

///|
test "ordinary overlaps and changed coordinated slots still conflict" {
  let base = allocation_state()
  let right = base.offerings[2]
  let plain = planner_expect_ok(
    @tanikun-domain.CourseOffering::new(
      right.id,
      right.course_id,
      right.academic_year,
      right.schedule(),
      right.status,
      right.slots(),
    ),
  )
  let offerings = base.offerings.copy()
  offerings[2] = plain
  let state = @app.PlannerState::new(
    base.catalogue,
    offerings,
    [],
    base.overrides,
    base.profile,
    base.requirement_sets,
    [],
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("lab")),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("exercise")),
  )
  assert_true(state.error is Some(_))
  assert_eq(state.enrollments.length(), 1)

  let shifted = planner_expect_ok(
    @tanikun-domain.CourseOffering::new(
      right.id,
      right.course_id,
      right.academic_year,
      right.schedule(),
      right.status,
      [planner_slot(@tanikun-domain.DayOfWeek::Thursday, 2)],
    ),
  ).with_coordinated_allocation(right.coordinated_allocation.unwrap())
  offerings[2] = shifted
  let overrides = planner_expect_ok(
    @tanikun-domain.Overrides::new([
      planner_expect_ok(
        @tanikun-domain.Override::new(
          @tanikun-domain.OverrideTarget::Offering(right.id),
          @tanikun-domain.OverrideAttribute::Slots,
          @tanikun-domain.OverrideValue::Slots(right.slots()),
        ),
      ),
    ]),
  )
  let state = @app.PlannerState::new(
    base.catalogue,
    offerings,
    [],
    overrides,
    base.profile,
    base.requirement_sets,
    [],
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("lab")),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("exercise")),
  )
  assert_true(state.error is Some(_))
  assert_eq(state.enrollments.length(), 1)
}
