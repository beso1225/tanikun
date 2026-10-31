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
  let category_def = planner_expect_ok(
    @tanikun-requirements.Category::new(category, "Foundation"),
  )
  let rule = planner_expect_ok(
    @tanikun-requirements.Rule::total_minimum(planner_credits(4)),
  )
  let requirement_set = planner_expect_ok(
    @tanikun-requirements.RequirementSet::new(
      @tanikun-requirements.RequirementSetKey::new(
        base.profile.program_id,
        base.profile.advancement_year,
      ),
      [category_def],
      [(extra.id, category)],
      rule,
    ),
  )
  let requirement_sets = planner_expect_ok(
    @tanikun-requirements.RequirementSets::new([requirement_set]),
  )
  let state = @app.PlannerState::new(
    [base.catalogue[0], extra],
    [base.offerings[0], offering],
    [],
    overrides,
    base.profile,
    requirement_sets,
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
    @app.PlannerMsg::StorageStatusChanged(
      status=@app.StorageStatus::Saving,
      text=@app.encode_planner_state(state),
    ),
  )
  assert_true(state.undo_available())
}

///|
test "stale storage status updates do not overwrite newer edits" {
  let seed = @app.sample_state()
  let state = @app.update_planner(
    seed,
    @app.PlannerMsg::RemoveEnrollment(
      offering_id=planner_offering_id("phy101-s1"),
    ),
  )
  let stale = @app.update_planner(
    state,
    @app.PlannerMsg::StorageStatusChanged(
      status=@app.StorageStatus::Saved,
      text=@app.encode_planner_state(seed),
    ),
  )
  assert_true(stale.storage_status == @app.StorageStatus::Loading)
  let current = @app.update_planner(
    stale,
    @app.PlannerMsg::StorageStatusChanged(
      status=@app.StorageStatus::Saved,
      text=@app.encode_planner_state(stale),
    ),
  )
  assert_true(current.storage_status == @app.StorageStatus::Saved)
  assert_true(current.undo_available())
}

///|
fn persistence_replace_required(
  text : String,
  old : String,
  new : String,
) -> String raise Error {
  let replaced = text.replace(old~, new~)
  if replaced == text {
    fail("expected persistence fixture text to contain a replacement target")
  }
  replaced
}

///|
fn persistence_expect_decode_error(
  state : @app.PlannerState,
  text : String,
) -> Unit raise Error {
  match @app.decode_planner_state(state, text) {
    Err(_) => ()
    Ok(_) => fail("expected the document to be rejected")
  }
}

///|
test "planner persistence rejects corrupt scalar fields" {
  let state = @app.sample_state()
  let text = @app.encode_planner_state(state)
  for
    (old, new) in [
      ("\"timetable_grade\":3", "\"timetable_grade\":9"),
      ("\"visible_days\":5", "\"visible_days\":99"),
      ("\"visible_periods\":6", "\"visible_periods\":99"),
      ("\"selected_term\":\"S1\"", "\"selected_term\":\"XX\""),
      ("\"next_custom_course_number\":1", "\"next_custom_course_number\":0"),
    ] {
    persistence_expect_decode_error(
      state,
      persistence_replace_required(text, old, new),
    )
  }
}

///|
test "planner persistence rejects broken document references" {
  let state = @app.sample_state()
  let text = @app.encode_planner_state(state)
  persistence_expect_decode_error(
    state,
    persistence_replace_required(
      text, "\"offering_id\":\"phy101-s1\"", "\"offering_id\":\"no-such-offering\"",
    ),
  )
  persistence_expect_decode_error(
    state,
    persistence_replace_required(
      text, "\"program_id\":\"applied-physics\"", "\"program_id\":\"no-such-program\"",
    ),
  )
  persistence_expect_decode_error(
    state,
    persistence_replace_required(
      text, "\"local_part\":\"PHY101\"", "\"local_part\":\"PHY102\"",
    ),
  )
}

///|
test "storage load failure is reported and explicit discard resumes saving" {
  let state = @app.update_planner(
    @app.sample_state(),
    @app.PlannerMsg::StorageLoadFailed(
      message="保存データを読み込めません",
    ),
  )
  assert_true(state.storage_status == @app.StorageStatus::LoadFailed)
  assert_true(state.error is Some(_))
  let discarded = @app.update_planner(state, @app.PlannerMsg::DiscardStoredPlan)
  assert_true(discarded.storage_status == @app.StorageStatus::Unsaved)
  assert_true(discarded.error is None)
}

///|
test "restore rejects custom catalogue rows without membership or an offering" {
  let state = create_named_custom_course(planner_state(), "Custom")
  let text = @app.encode_planner_state(state)
  let dto : @app.PersistedPlan = @json.from_json(@json.parse(text))
  let missing_membership = { ..dto, custom_course_ids: [], }
  persistence_expect_decode_error(
    state,
    missing_membership.to_json().stringify(),
  )
  let missing_offering = { ..dto, offerings: [dto.offerings[0]], }
  persistence_expect_decode_error(state, missing_offering.to_json().stringify())
}

///|
test "save failure guidance matches the document and preserves undo" {
  let seed = @app.sample_state()
  let state = @app.update_planner(
    seed,
    @app.PlannerMsg::RemoveEnrollment(
      offering_id=planner_offering_id("phy101-s1"),
    ),
  )
  let stale = @app.update_planner(
    state,
    @app.PlannerMsg::StorageSaveFailed(
      message="Stale",
      text=@app.encode_planner_state(seed),
    ),
  )
  assert_true(stale.error is None)
  let failed = @app.update_planner(
    state,
    @app.PlannerMsg::StorageSaveFailed(
      message="Reload this tab",
      text=@app.encode_planner_state(state),
    ),
  )
  assert_true(failed.storage_status == @app.StorageStatus::Failed)
  assert_eq(failed.error.unwrap().message, "Reload this tab")
  assert_true(failed.undo_available())
}
