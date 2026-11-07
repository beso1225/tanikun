///|
test "override credits reject values outside one to twenty half units" {
  let id = planner_offering_id("offering-1")
  let base = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=id),
  )
  for value in ["0", "21", "abc"] {
    let state = open_override_form(base, id)
    let state = update_override(state, @app.OverrideField::Credits, value)
    let state = @app.update_planner(state, @app.PlannerMsg::SubmitOverride)
    match state.override_form {
      Some(form) => {
        match form.error_field {
          Some(@app.OverrideField::Credits) => ()
          _ => fail("expected a credits field error for \{value}")
        }
        assert_eq(form.error_message, "単位数が正しくありません")
      }
      None => fail("invalid override credits should keep the editor open")
    }
    assert_eq(state.overrides.len(), 0)
    assert_eq(
      state.catalogue_entries(@app.PlannerTerm::S1)[0].credits.half_units(),
      4,
    )
  }
}

///|
test "override credits accept the inclusive half-unit bounds" {
  let id = planner_offering_id("offering-1")
  let base = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=id),
  )
  for pair in [("1", 1), ("20", 20)] {
    let (value, expected) = pair
    let state = open_override_form(base, id)
    let state = update_override(state, @app.OverrideField::Credits, value)
    let state = @app.update_planner(state, @app.PlannerMsg::SubmitOverride)
    match state.override_form {
      None => ()
      Some(form) => fail(form.error_message)
    }
    assert_eq(state.overrides.len(), 1)
    assert_eq(
      state.overrides.entries()[0].credits().unwrap().half_units(),
      expected,
    )
  }
}

///|
test "invalid override period updates leave the draft unchanged" {
  let id = planner_offering_id("offering-1")
  let base = open_override_form(planner_state(), id)
  for value in ["0", "11", "abc"] {
    let state = @app.update_planner(
      base,
      @app.PlannerMsg::UpdateOverridePeriod(value~),
    )
    match state.override_form {
      Some(form) => {
        assert_eq(form.period.value(), 1)
        match form.error_field {
          None => ()
          Some(_) => fail("invalid period should not set a field error")
        }
      }
      None => fail("invalid period should keep the editor open")
    }
    assert_eq(state.revision, base.revision)
  }
  let errored = @app.update_planner(
    update_override(base, @app.OverrideField::Credits, "0"),
    @app.PlannerMsg::SubmitOverride,
  )
  let revision = errored.revision
  let state = @app.update_planner(
    errored,
    @app.PlannerMsg::UpdateOverridePeriod(value="11"),
  )
  match state.override_form {
    Some(form) =>
      match form.error_field {
        Some(@app.OverrideField::Credits) => ()
        _ => fail("invalid period should preserve the existing field error")
      }
    None => fail("invalid period should keep the editor open")
  }
  assert_eq(state.revision, revision)
  let state = @app.update_planner(
    base,
    @app.PlannerMsg::UpdateOverridePeriod(value="10"),
  )
  match state.override_form {
    Some(form) => assert_eq(form.period.value(), 10)
    None => fail("valid period should keep the editor open")
  }
}

///|
test "invalid custom course period reports a period field error" {
  for value in ["0", "11", "abc"] {
    let state = open_custom_form(planner_state())
    let state = update_custom(state, @app.CustomCourseField::Name, "Bad period")
    let state = update_custom(state, @app.CustomCourseField::Period, value)
    let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
    match state.custom_form {
      Some(form) => {
        match form.error_field {
          Some(@app.CustomCourseField::Period) => ()
          _ => fail("expected a period field error for \{value}")
        }
        assert_eq(form.error_message, "時限を選択してください")
      }
      None => fail("invalid custom period should keep the form open")
    }
    assert_eq(state.catalogue.length(), 1)
  }
}
