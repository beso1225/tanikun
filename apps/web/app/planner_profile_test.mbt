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
