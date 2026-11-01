///|
fn persistence_slot(
  day : @tanikun-domain.DayOfWeek,
  period : Int,
) -> @tanikun-domain.Slot raise Error {
  planner_slot(day, period)
}

///|
fn persistence_offering(
  id : String,
  course : @tanikun-domain.Course,
  schedule : @tanikun-domain.OfferingSchedule,
  slots : Array[@tanikun-domain.Slot],
  status : @tanikun-domain.OfferingStatus,
) -> @tanikun-domain.CourseOffering raise Error {
  planner_expect_ok(
    @tanikun-domain.CourseOffering::new(
      planner_offering_id(id),
      course.id,
      planner_expect_ok(@tanikun-domain.AcademicYear::new(2026)),
      schedule,
      status,
      slots,
    ),
  )
}

///|
fn persistence_requirement_sets() -> @tanikun-requirements.RequirementSets[
  @tanikun-requirements.Rule,
] raise Error {
  let key = @tanikun-requirements.RequirementSetKey::new(
    planner_expect_ok(@tanikun-domain.ProgramId::new("applied-physics")),
    planner_expect_ok(@tanikun-domain.AcademicYear::new(2026)),
  )
  let category = planner_expect_ok(
    @tanikun-domain.CategoryId::new("foundation"),
  )
  let definition = planner_expect_ok(
    @tanikun-requirements.Category::new(category, "Foundation"),
  )
  let rule = planner_expect_ok(
    @tanikun-requirements.Rule::total_minimum(planner_credits(4)),
  )
  let set = planner_expect_ok(
    @tanikun-requirements.RequirementSet::new(key, [definition], [], rule),
  )
  planner_expect_ok(@tanikun-requirements.RequirementSets::new([set]))
}

///|
fn persistence_satisfaction_text(
  value : @tanikun-requirements.Satisfaction,
) -> String {
  match value {
    @tanikun-requirements.Satisfaction::Satisfied => "satisfied"
    @tanikun-requirements.Satisfaction::Partial => "partial"
    @tanikun-requirements.Satisfaction::Unsatisfied => "unsatisfied"
  }
}

///|
fn persistence_mode_text(mode : @app.RequirementMode) -> String {
  "\{persistence_satisfaction_text(mode.satisfaction)}|\{mode.status}|\{mode.progress}|\{mode.remaining}|\{mode.unit}|\{mode.done}|\{mode.total}"
}

///|
fn persistence_summary_text(
  node : @app.RequirementNode,
  parts : Array[String],
) -> Unit {
  parts.push(
    "\{node.label}|\{persistence_mode_text(node.confirmed)}|\{persistence_mode_text(node.standard)}|\{persistence_mode_text(node.optimistic)}|\{node.missing_courses.join(",")}",
  )
  for child in node.children {
    persistence_summary_text(child, parts)
  }
}

///|
fn persistence_summary_signature(summary : @app.PlannerSummary) -> String {
  let parts = [
    "\{summary.confirmed.half_units()}|\{summary.standard.half_units()}|\{summary.optimistic.half_units()}",
  ]
  for category in summary.categories {
    parts.push(
      "\{category.name}|\{category.confirmed.half_units()}|\{category.standard.half_units()}|\{category.optimistic.half_units()}",
    )
  }
  persistence_summary_text(summary.requirement_root, parts)
  parts.join("||")
}

///|
/// A source state that exercises every persisted status, grade, schedule,
/// phase, override kind, coordination record, and display field.
fn persistence_full_state() -> @app.PlannerState raise Error {
  let program = planner_expect_ok(
    @tanikun-domain.ProgramId::new("applied-physics"),
  )
  let year = planner_expect_ok(@tanikun-domain.AcademicYear::new(2026))
  let profile = @tanikun-domain.AcademicProfile::new(program, year)
  let physics = planner_course("PHY101", "Physics", 4)
  let physics_two = planner_course("PHY102", "Physics II", 4)
  let retired = planner_expect_ok(
    @tanikun-domain.Course::new(
      planner_course_id("PHY103"),
      "Retired physics",
      planner_credits(4),
      @tanikun-domain.CourseStatus::Retired,
    ),
  )
  let catalogue = [physics, physics_two, retired]
  let slots = [persistence_slot(@tanikun-domain.DayOfWeek::Monday, 1)]
  let phased = persistence_offering(
    "phased",
    physics,
    @tanikun-domain.OfferingSchedule::Regular(terms=[
      @tanikun-domain.Term::S1,
      @tanikun-domain.Term::S2,
    ]),
    slots,
    @tanikun-domain.OfferingStatus::Offered,
  )
  let phased = planner_expect_ok(
    phased.with_term_slots([
      (@tanikun-domain.Term::S1, slots),
      (
        @tanikun-domain.Term::S2,
        [persistence_slot(@tanikun-domain.DayOfWeek::Sunday, 3)],
      ),
    ]),
  )
  let allocation = planner_expect_ok(
    @tanikun-domain.CoordinatedAllocation::new(
      "fixture", "Verified fixture handout",
    ),
  )
  let phased = phased.with_coordinated_allocation(allocation)
  let year_long = persistence_offering(
    "year-long",
    physics_two,
    @tanikun-domain.OfferingSchedule::YearLong,
    [persistence_slot(@tanikun-domain.DayOfWeek::Saturday, 2)],
    @tanikun-domain.OfferingStatus::Offered,
  )
  let intensive_w = persistence_offering(
    "intensive-w",
    physics_two,
    @tanikun-domain.OfferingSchedule::Intensive(
      semester=@tanikun-domain.Semester::W,
    ),
    [],
    @tanikun-domain.OfferingStatus::NotOffered,
  )
  let intensive_s = persistence_offering(
    "intensive-s",
    physics_two,
    @tanikun-domain.OfferingSchedule::Intensive(
      semester=@tanikun-domain.Semester::S,
    ),
    [],
    @tanikun-domain.OfferingStatus::Offered,
  )
  let intensive_a = persistence_offering(
    "intensive-a",
    physics_two,
    @tanikun-domain.OfferingSchedule::Intensive(
      semester=@tanikun-domain.Semester::A,
    ),
    [],
    @tanikun-domain.OfferingStatus::Offered,
  )
  let offerings = [phased, year_long, intensive_w, intensive_s, intensive_a]
  let enrollments = []
  let planned_course = planner_course("PLAN101", "Planned course", 4)
  catalogue.push(planned_course)
  let planned = persistence_offering(
    "planned",
    planned_course,
    @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::A1]),
    [persistence_slot(@tanikun-domain.DayOfWeek::Monday, 2)],
    @tanikun-domain.OfferingStatus::Offered,
  )
  offerings.push(planned)
  enrollments.push(@tanikun-domain.Enrollment::planned(planned.id))
  let in_progress_course = planner_course("PROG101", "In-progress course", 4)
  catalogue.push(in_progress_course)
  let in_progress = persistence_offering(
    "in-progress",
    in_progress_course,
    @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::A2]),
    [persistence_slot(@tanikun-domain.DayOfWeek::Monday, 3)],
    @tanikun-domain.OfferingStatus::Offered,
  )
  offerings.push(in_progress)
  enrollments.push(@tanikun-domain.Enrollment::in_progress(in_progress.id))
  let passing = [
    @tanikun-domain.PassingGrade::ExcellentPlus,
    @tanikun-domain.PassingGrade::Excellent,
    @tanikun-domain.PassingGrade::Good,
    @tanikun-domain.PassingGrade::Fair,
    @tanikun-domain.PassingGrade::Pass,
  ]
  for index in 0..<passing.length() {
    let course = planner_course("PASS\{index}", "Pass course \{index}", 4)
    catalogue.push(course)
    let offering = persistence_offering(
      "passed-\{index}",
      course,
      @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::S1]),
      [persistence_slot(@tanikun-domain.DayOfWeek::Wednesday, index + 1)],
      @tanikun-domain.OfferingStatus::Offered,
    )
    offerings.push(offering)
    let snapshot = planner_expect_ok(
      @tanikun-domain.PassedCourseSnapshot::new(
        course.id,
        "Frozen physics \{index}",
        planner_credits(7 + index),
      ),
    )
    enrollments.push(
      @tanikun-domain.Enrollment::passed(offering.id, passing[index], snapshot),
    )
  }
  let failing = [
    @tanikun-domain.FailingGrade::Fail,
    @tanikun-domain.FailingGrade::NotPassed,
  ]
  for index in 0..<failing.length() {
    let course = planner_course("FAIL\{index}", "Fail course \{index}", 4)
    catalogue.push(course)
    let offering = persistence_offering(
      "failed-\{index}",
      course,
      @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::S2]),
      [persistence_slot(@tanikun-domain.DayOfWeek::Thursday, index + 1)],
      @tanikun-domain.OfferingStatus::Offered,
    )
    offerings.push(offering)
    enrollments.push(
      @tanikun-domain.Enrollment::failed(offering.id, failing[index]),
    )
  }
  let not_taken_course = planner_course("NOT101", "Not-taken course", 4)
  catalogue.push(not_taken_course)
  let not_taken = persistence_offering(
    "not-taken",
    not_taken_course,
    @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::S2]),
    [persistence_slot(@tanikun-domain.DayOfWeek::Friday, 1)],
    @tanikun-domain.OfferingStatus::Offered,
  )
  offerings.push(not_taken)
  enrollments.push(@tanikun-domain.Enrollment::not_taken(not_taken.id))
  let overrides = planner_expect_ok(
    @tanikun-domain.Overrides::new([
      planner_expect_ok(
        @tanikun-domain.Override::new(
          @tanikun-domain.OverrideTarget::Course(physics.id),
          @tanikun-domain.OverrideAttribute::DisplayName,
          @tanikun-domain.OverrideValue::Text("Renamed physics"),
        ),
      ),
      planner_expect_ok(
        @tanikun-domain.Override::new(
          @tanikun-domain.OverrideTarget::Course(physics_two.id),
          @tanikun-domain.OverrideAttribute::Credits,
          @tanikun-domain.OverrideValue::Credits(planner_credits(9)),
        ),
      ),
      planner_expect_ok(
        @tanikun-domain.Override::new(
          @tanikun-domain.OverrideTarget::Offering(phased.id),
          @tanikun-domain.OverrideAttribute::Slots,
          @tanikun-domain.OverrideValue::Slots([
            persistence_slot(@tanikun-domain.DayOfWeek::Tuesday, 4),
          ]),
        ),
      ),
    ]),
  )
  let state = @app.PlannerState::new(
    catalogue,
    offerings,
    enrollments,
    overrides,
    profile,
    persistence_requirement_sets(),
    [],
  )
  let state = state.with_custom_id_prefix("session-")
  let state = open_custom_form(state)
  let state = update_custom(
    state,
    @app.CustomCourseField::Name,
    "Custom fixture",
  )
  let state = update_custom(
    state,
    @app.CustomCourseField::Category,
    "foundation",
  )
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::A2),
  )
  let state = @app.update_planner(state, @app.PlannerMsg::IncreaseVisibleDays)
  let state = @app.update_planner(state, @app.PlannerMsg::IncreaseVisibleDays)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::IncreaseVisiblePeriods,
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::IncreaseVisiblePeriods,
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::IncreaseVisiblePeriods,
  )
  @app.update_planner(state, @app.PlannerMsg::IncreaseVisiblePeriods)
}

///|
test "source round trip preserves every persisted field and requirement result" {
  let state = persistence_full_state()
  let text = @app.encode_planner_state(state)
  let restored = match @app.decode_planner_state(state, text) {
    Ok(value) => value
    Err(message) => fail("expected a restored state: \{message}")
  }
  assert_eq(@app.encode_planner_state(restored), text)
  let before = match state.planner_summary() {
    Ok(value) => value
    Err(_) => fail("expected the original summary")
  }
  let after = match restored.planner_summary() {
    Ok(value) => value
    Err(_) => fail("expected the restored summary")
  }
  assert_eq(
    persistence_summary_signature(after),
    persistence_summary_signature(before),
  )
}

///|
test "encoded source excludes UI state and restore resets it" {
  let state = persistence_full_state()
  let text = @app.encode_planner_state(state)
  for
    key in [
      "undo_removal", "selected_offering", "catalogue_query", "picker", "settings_open",
      "override_form", "custom_form", "storage_status", "revision", "custom_id_prefix",
      "last_saved_text", "total_credits", "planner_summary", "error",
    ] {
    assert_true(!text.contains("\"\{key}\""))
  }
  let offering_id = state.enrollments[0].offering_id
  let settings = @app.update_planner(state, @app.PlannerMsg::OpenSettings)
  assert_true(settings.settings_open)
  let queried = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateCatalogueQuery(query="draft query"),
  )
  assert_eq(queried.catalogue_query, "draft query")
  let picking = @app.update_planner(state, @app.PlannerMsg::OpenCataloguePicker)
  assert_true(picking.picker is Some(_))
  let selected = @app.update_planner(
    state,
    @app.PlannerMsg::SelectOffering(offering_id~),
  )
  assert_true(selected.selected_offering is Some(_))
  let overriding = @app.update_planner(
    state,
    @app.PlannerMsg::OpenOverrideEditor(offering_id~),
  )
  assert_true(overriding.override_form is Some(_))
  let customizing = @app.update_planner(
    state,
    @app.PlannerMsg::OpenCustomCourseForm,
  )
  assert_true(customizing.custom_form is Some(_))
  let failing = @app.update_planner(
    state,
    @app.PlannerMsg::StorageLoadFailed(message="boom"),
  )
  assert_true(failing.error is Some(_))
  for
    dirty in [
      settings, queried, picking, selected, overriding, customizing, failing,
    ] {
    assert_eq(@app.encode_planner_state(dirty), text)
  }
  let removed = @app.update_planner(
    state,
    @app.PlannerMsg::RemoveEnrollment(offering_id~),
  )
  assert_true(removed.undo_available())
  let removed_text = @app.encode_planner_state(removed)
  let restored_undo = match @app.decode_planner_state(state, removed_text) {
    Ok(value) => value
    Err(message) => fail("expected a restored removed state: \{message}")
  }
  assert_true(!restored_undo.undo_available())
  let restored = match @app.decode_planner_state(state, text) {
    Ok(value) => value
    Err(message) => fail("expected a restored state: \{message}")
  }
  assert_true(!restored.undo_available())
  assert_true(restored.selected_offering is None)
  assert_eq(restored.catalogue_query, "")
  assert_true(restored.picker is None)
  assert_true(restored.settings_open == false)
  assert_true(restored.override_form is None)
  assert_true(restored.custom_form is None)
  assert_true(restored.error is None)
  assert_true(restored.storage_status == @app.StorageStatus::Loading)
  assert_eq(restored.revision, 1)
  assert_eq(restored.custom_id_prefix, state.custom_id_prefix)
}

///|
test "every planner term round-trips" {
  let state = persistence_full_state()
  for
    term in [
      @app.PlannerTerm::S1,
      @app.PlannerTerm::S2,
      @app.PlannerTerm::A1,
      @app.PlannerTerm::A2,
      @app.PlannerTerm::W,
    ] {
    let selected = @app.update_planner(
      state,
      @app.PlannerMsg::SelectTerm(term~),
    )
    let text = @app.encode_planner_state(selected)
    let restored = match @app.decode_planner_state(selected, text) {
      Ok(value) => value
      Err(message) => fail("expected a restored term: \{message}")
    }
    assert_true(restored.selected_term == term)
    assert_eq(@app.encode_planner_state(restored), text)
  }
}

///|
/// A fixed version-1 document. Keep this literal independent of the encoder so
/// a schema change cannot pass by drifting both sides together.
fn persistence_v1_fixture() -> String {
  "{\"version\":1,\"catalogue\":[{\"id\":{\"namespace_part\":\"fixture\",\"local_part\":\"PHY101\"},\"name\":\"Fixture Physics\",\"credits\":8,\"status\":\"active\"}],\"offerings\":[{\"id\":\"fixture-s1\",\"course_id\":{\"namespace_part\":\"fixture\",\"local_part\":\"PHY101\"},\"academic_year\":2026,\"schedule\":\"regular\",\"terms\":[\"S1\"],\"semester\":\"\",\"status\":\"offered\",\"slots\":[{\"day\":\"Monday\",\"period\":1}],\"term_slots\":[{\"term\":\"S1\",\"slots\":[{\"day\":\"Monday\",\"period\":1}]}],\"coordinated_group\":\"\",\"coordinated_source\":\"\"}],\"enrollments\":[{\"offering_id\":\"fixture-s1\",\"status\":\"passed\",\"passing_grade\":\"good\",\"failing_grade\":\"\",\"snapshot\":{\"course_id\":{\"namespace_part\":\"fixture\",\"local_part\":\"PHY101\"},\"name\":\"Frozen Fixture\",\"credits\":8}}],\"overrides\":[],\"program_id\":\"applied-physics\",\"advancement_year\":2026,\"timetable_grade\":3,\"selected_term\":\"S1\",\"visible_days\":5,\"visible_periods\":6,\"custom_course_ids\":[],\"custom_categories\":[],\"next_custom_course_number\":1}"
}

///|
test "a fixed version-1 fixture decodes to the documented source" {
  let fixture = persistence_v1_fixture()
  let base = planner_state()
  let restored = match @app.decode_planner_state(base, fixture) {
    Ok(value) => value
    Err(message) => fail("expected the v1 fixture to decode: \{message}")
  }
  assert_eq(@app.encode_planner_state(restored), fixture)
  assert_eq(restored.catalogue.length(), 1)
  assert_eq(restored.catalogue[0].name, "Fixture Physics")
  assert_eq(restored.offerings[0].id.value, "fixture-s1")
  assert_eq(restored.enrollments[0].offering_id.value, "fixture-s1")
  let summary = match restored.planner_summary() {
    Ok(value) => value
    Err(_) => fail("expected a summary for the v1 fixture")
  }
  assert_eq(summary.confirmed.half_units(), 8)
}

///|
test "unknown fields are ignored by version-1 decoding" {
  let fixture = persistence_v1_fixture()
  let extended = fixture.replace(
    old="\"version\":1,",
    new="\"version\":1,\"unknown_top_level\":true,",
  )
  let restored = match @app.decode_planner_state(planner_state(), extended) {
    Ok(value) => value
    Err(message) => fail("expected unknown fields to be ignored: \{message}")
  }
  assert_eq(@app.encode_planner_state(restored), fixture)
  let nested = fixture.replace(
    old="\"name\":\"Fixture Physics\",",
    new="\"name\":\"Fixture Physics\",\"unknown_course\":1,",
  )
  let restored_nested = match
    @app.decode_planner_state(planner_state(), nested) {
    Ok(value) => value
    Err(message) =>
      fail("expected nested unknown fields to be ignored: \{message}")
  }
  assert_eq(@app.encode_planner_state(restored_nested), fixture)
}
