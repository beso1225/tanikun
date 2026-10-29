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
