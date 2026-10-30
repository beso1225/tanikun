///|
test "planner persistence round-trips source state and recomputes summary" {
  let state = @app.update_planner(
    @app.sample_state(),
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=planner_offering_id("phy101-s1"),
      target=@app.EnrollmentStatusTarget::Passed(
        grade=@tanikun-domain.PassingGrade::Good,
      ),
    ),
  )
  let before = match state.planner_summary() {
    Ok(value) => value
    Err(_) => fail("expected a summary")
  }
  let text = @app.encode_planner_state(state)
  let restored = match @app.decode_planner_state(state, text) {
    Ok(value) => value
    Err(_) => fail("expected a restored state")
  }
  assert_eq(restored.catalogue.length(), state.catalogue.length())
  assert_eq(restored.offerings.length(), state.offerings.length())
  assert_eq(restored.enrollments.length(), state.enrollments.length())
  assert_true(restored.profile.program_id == state.profile.program_id)
  assert_true(restored.selected_term == state.selected_term)
  let after = match restored.planner_summary() {
    Ok(value) => value
    Err(_) => fail("expected a restored summary")
  }
  assert_eq(after.confirmed.half_units(), before.confirmed.half_units())
  assert_eq(after.optimistic.half_units(), before.optimistic.half_units())
  assert_eq(after.requirement_root.label, before.requirement_root.label)
}

///|
test "planner persistence rejects corrupt and unsupported documents" {
  let state = @app.sample_state()
  match @app.decode_planner_state(state, "{not json") {
    Err(_) => ()
    Ok(_) => fail("expected corrupt data to fail")
  }
  let text = @app.encode_planner_state(state)
  let unsupported = text.replace(old="\"version\":1", new="\"version\":99")
  match @app.decode_planner_state(state, unsupported) {
    Err(_) => ()
    Ok(_) => fail("expected an unsupported version to fail")
  }
}

///|
test "planner persistence preserves phases, coordination, and visible range" {
  let state = allocation_state()
  let text = @app.encode_planner_state(state)
  let restored = match @app.decode_planner_state(state, text) {
    Ok(value) => value
    Err(_) => fail("expected a restored allocation state")
  }
  assert_eq(restored.offerings.length(), state.offerings.length())
  assert_eq(restored.visible_days, state.visible_days)
  assert_eq(restored.visible_periods, state.visible_periods)
  let design = restored.offerings[0]
  assert_eq(
    design.term_slots().length(),
    state.offerings[0].term_slots().length(),
  )
  let mut coordinated = false
  for offering in restored.offerings {
    if offering.id.value == "lab" {
      match offering.coordinated_allocation {
        Some(allocation) =>
          assert_eq(allocation.source, "Verified fictional course handout")
        None => fail("expected coordinated evidence")
      }
      coordinated = true
    }
  }
  assert_true(coordinated)
}

///|
test "planner persistence preserves overrides and custom category assignments" {
  let base = planner_state()
  let extra = planner_course("CUSTOM", "Custom course", 2)
  let offering = planner_offering(
    "custom-offering",
    extra,
    @tanikun-domain.Term::S1,
    [planner_slot(@tanikun-domain.DayOfWeek::Friday, 2)],
  )
  let override_entry = planner_expect_ok(
    @tanikun-domain.Override::new(
      @tanikun-domain.OverrideTarget::Course(base.catalogue[0].id),
      @tanikun-domain.OverrideAttribute::DisplayName,
      @tanikun-domain.OverrideValue::Text("Renamed physics"),
    ),
  )
  let overrides = planner_expect_ok(
    @tanikun-domain.Overrides::new([override_entry]),
  )
  let category = planner_expect_ok(
    @tanikun-domain.CategoryId::new("foundation"),
  )
  let state = @app.PlannerState::new(
    [base.catalogue[0], extra],
    [base.offerings[0], offering],
    [],
    overrides,
    base.profile,
    base.requirement_sets,
    [(extra.id, category)],
  )
  let text = @app.encode_planner_state(state)
  let restored = match @app.decode_planner_state(state, text) {
    Ok(value) => value
    Err(_) => fail("expected a restored custom state")
  }
  assert_eq(restored.overrides.len(), 1)
  assert_eq(restored.custom_categories.length(), 1)
  assert_eq(restored.catalogue.length(), 2)
  match restored.overrides.entries()[0].text() {
    Some(value) => assert_eq(value, "Renamed physics")
    None => fail("expected a text override")
  }
}

///|
test "persistence status updates do not expire the undo barrier" {
  let state = @app.sample_state()
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::RemoveEnrollment(
      offering_id=planner_offering_id("phy101-s1"),
    ),
  )
  assert_true(state.undo_available())
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::StorageStatusChanged(status=@app.StorageStatus::Saving),
  )
  assert_true(state.undo_available())
}
