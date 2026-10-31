///|
test "a valid custom course and offering are added to the planner" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::OpenCataloguePicker,
  )
  let state = open_custom_form(state)
  let state = update_custom(
    state,
    @app.CustomCourseField::Name,
    "Linear Algebra",
  )
  let state = update_custom(state, @app.CustomCourseField::Credits, "5")
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::ToggleCustomTerm(term=@app.PlannerTerm::S1),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::ToggleCustomTerm(term=@app.PlannerTerm::S2),
  )
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

///|
fn create_named_custom_course(
  state : @app.PlannerState,
  name : String,
) -> @app.PlannerState {
  let state = open_custom_form(state)
  let state = update_custom(state, @app.CustomCourseField::Name, name)
  @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
}

///|
test "a custom regular offering supports multiple terms" {
  let state = open_custom_form(planner_state())
  let state = update_custom(state, @app.CustomCourseField::Name, "Spanning")
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::ToggleCustomTerm(term=@app.PlannerTerm::S2),
  )
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  match state.offerings[1].schedule() {
    @tanikun-domain.OfferingSchedule::Regular(terms~) =>
      assert_eq(terms.length(), 2)
    _ => fail("expected a regular offering")
  }
  assert_true(state.selected_term == @app.PlannerTerm::S1)
}

///|
test "a custom course can be edited without changing its identity" {
  let state = create_named_custom_course(planner_state(), "Before")
  let course_id = state.catalogue[1].id
  let offering_id = state.offerings[1].id
  let state = @app.update_planner(state, @app.PlannerMsg::OpenCataloguePicker)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::OpenEditCustomCourse(offering_id~),
  )
  let state = update_custom(state, @app.CustomCourseField::Name, "After")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  assert_eq(state.catalogue.length(), 2)
  assert_eq(state.offerings.length(), 2)
  assert_true(state.catalogue[1].id == course_id)
  assert_true(state.offerings[1].id == offering_id)
  assert_eq(state.catalogue[1].name, "After")
  assert_eq(state.next_custom_course_number, 2)
  match state.picker {
    Some(@app.PickerTarget::All) => ()
    _ => fail("edited offering should return to the catalogue picker")
  }
}

///|
test "an unenrolled custom course can be deleted" {
  let state = create_named_custom_course(planner_state(), "Delete me")
  let course_id = state.catalogue[1].id
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::DeleteCustomCourse(course_id~),
  )
  assert_eq(state.catalogue.length(), 1)
  assert_eq(state.offerings.length(), 1)
  assert_eq(state.custom_course_ids.length(), 0)
  match state.error {
    None => ()
    Some(_) => fail("deleting an unenrolled custom course should succeed")
  }
}

///|
test "an enrolled custom course cannot be deleted" {
  let state = create_named_custom_course(planner_state(), "Enrolled")
  let course_id = state.catalogue[1].id
  let offering_id = state.offerings[1].id
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id~),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::DeleteCustomCourse(course_id~),
  )
  assert_eq(state.catalogue.length(), 2)
  match state.error {
    Some(error) => assert_true(error.kind == @app.UiErrorKind::General)
    None => fail("enrolled custom course deletion should fail")
  }
}

///|
test "opening the custom form from a slot picker prefills the slot" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::OpenSlotPicker(
      day=@tanikun-domain.DayOfWeek::Tuesday,
      period=3,
    ),
  )
  let state = @app.update_planner(state, @app.PlannerMsg::OpenCustomCourseForm)
  match state.custom_form {
    Some(form) => {
      assert_eq(form.day, "1")
      assert_eq(form.period, "3")
      assert_true(form.schedule == @app.CustomCourseSchedule::Regular)
    }
    None => fail("expected the custom form")
  }
}

///|
test "regular custom terms must stay in one semester" {
  let state = open_custom_form(planner_state())
  let state = update_custom(state, @app.CustomCourseField::Name, "Mixed")
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::ToggleCustomTerm(term=@app.PlannerTerm::S2),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::ToggleCustomTerm(term=@app.PlannerTerm::A1),
  )
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  assert_eq(state.catalogue.length(), 1)
  match state.custom_form {
    Some(form) =>
      match form.error_field {
        Some(@app.CustomCourseField::Term) => ()
        _ => fail("expected a term field error")
      }
    None => fail("mixed custom terms should keep the form open")
  }
}

///|
test "creating from a slot picker returns to that slot picker" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::OpenSlotPicker(
      day=@tanikun-domain.DayOfWeek::Monday,
      period=3,
    ),
  )
  let state = open_custom_form(state)
  let state = update_custom(state, @app.CustomCourseField::Name, "Slot custom")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  match state.picker {
    Some(@app.PickerTarget::Slot(day~, period~)) => {
      assert_true(day == @tanikun-domain.DayOfWeek::Monday)
      assert_eq(period, 3)
    }
    _ => fail("custom creation should return to the slot picker")
  }
}

///|
test "creating from the intensive picker returns to the intensive picker" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::OpenIntensivePicker,
  )
  let state = open_custom_form(state)
  let state = update_custom(
    state,
    @app.CustomCourseField::Name,
    "Intensive custom",
  )
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  match state.picker {
    Some(@app.PickerTarget::Intensive) => ()
    _ => fail("custom creation should return to the intensive picker")
  }
}

///|
test "editing an enrolled custom offering rejects a slot conflict" {
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("offering-1")),
  )
  let state = create_named_custom_course(state, "Custom")
  let offering_id = state.offerings[1].id
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id~),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::OpenEditCustomCourse(offering_id~),
  )
  let state = update_custom(state, @app.CustomCourseField::Day, "0")
  let state = update_custom(state, @app.CustomCourseField::Period, "1")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  match state.custom_form {
    Some(form) =>
      match form.error_field {
        Some(@app.CustomCourseField::Schedule) => ()
        _ => fail("expected a schedule field error")
      }
    None => fail("conflicting custom edit should keep the form open")
  }
  assert_true(
    state.offerings[1].slots()[0].day == @tanikun-domain.DayOfWeek::Tuesday,
  )
}

///|
fn open_override_form(
  state : @app.PlannerState,
  offering_id : @tanikun-domain.OfferingId,
) -> @app.PlannerState {
  @app.update_planner(state, @app.PlannerMsg::OpenOverrideEditor(offering_id~))
}

///|
fn update_override(
  state : @app.PlannerState,
  field : @app.OverrideField,
  value : String,
) -> @app.PlannerState {
  @app.update_planner(
    state,
    @app.PlannerMsg::UpdateOverrideField(field~, value~),
  )
}

///|
test "replica custom IDs stay distinct after restoring a common plan" {
  let base = planner_state()
  let left = create_named_custom_course(
    base.with_custom_id_prefix("left-"),
    "Left",
  )
  let right = create_named_custom_course(
    base.with_custom_id_prefix("right-"),
    "Right",
  )
  assert_false(left.catalogue[1].id == right.catalogue[1].id)
  assert_false(left.offerings[1].id == right.offerings[1].id)
  let restored = @app.decode_planner_state(
    base.with_custom_id_prefix("next-"),
    @app.encode_planner_state(left),
  ).unwrap()
  let next = create_named_custom_course(restored, "Next")
  assert_eq(next.catalogue[2].id.local_part, "course-next-2")
}

///|
test "custom deletion removes its course and offering overrides only" {
  let state = create_named_custom_course(planner_state(), "Custom")
  let course_id = state.catalogue[1].id
  let offering_id = state.offerings[1].id
  let state = open_override_form(state, state.offerings[0].id)
  let state = update_override(
    state,
    @app.OverrideField::Name,
    "Keep master override",
  )
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitOverride)
  let state = open_override_form(state, offering_id)
  let state = update_override(
    state,
    @app.OverrideField::Name,
    "Custom override",
  )
  let state = update_override(state, @app.OverrideField::Credits, "6")
  let state = @app.update_planner(state, @app.PlannerMsg::ToggleOverrideSlots)
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitOverride)
  assert_eq(state.overrides.len(), 4)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::DeleteCustomCourse(course_id~),
  )
  assert_eq(state.overrides.len(), 1)
  assert_eq(
    state.overrides.entries()[0].text().unwrap(),
    "Keep master override",
  )
  assert_true(
    @app.decode_planner_state(state, @app.encode_planner_state(state)) is Ok(_),
  )
}
