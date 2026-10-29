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
