///|
test "planner summary exposes credits, categories, and requirement status" {
  let state = @app.sample_state()
  let summary = match state.planner_summary() {
    Ok(value) => value
    Err(_) => fail("expected a planner summary")
  }
  assert_eq(summary.confirmed.half_units(), 0)
  assert_eq(summary.standard.half_units(), 0)
  assert_eq(summary.optimistic.half_units(), 12)
  assert_eq(summary.categories.length(), 3)
  assert_eq(summary.categories[0].name, "基礎物理")
  assert_eq(summary.categories[0].optimistic.half_units(), 4)
  assert_eq(summary.categories[1].name, "実験")
  assert_eq(summary.categories[1].optimistic.half_units(), 2)
  assert_eq(summary.categories[2].name, "演習")
  assert_eq(summary.categories[2].optimistic.half_units(), 6)
  assert_true(
    summary.requirement_root.optimistic.satisfaction ==
    @tanikun-requirements.Satisfaction::Satisfied,
  )
  assert_eq(summary.requirement_root.label, "全体")
  assert_eq(summary.requirement_root.confirmed.status_label(), "不足")
  assert_eq(summary.requirement_root.standard.status_label(), "不足")
  assert_eq(
    summary.requirement_root.optimistic.status_label(),
    "計画上充足",
  )
  assert_eq(
    summary.requirement_root.optimistic.progress,
    "要件 2 / 2件（部分 0）",
  )
  assert_eq(summary.requirement_root.children.length(), 2)
  assert_eq(summary.requirement_root.children[0].label, "合計単位数")
  assert_eq(summary.requirement_root.children[1].label, "区分単位数")
}

///|
test "planner summary recomputes after a status change" {
  let id = planner_offering_id("phy101-s1")
  let state = @app.update_planner(
    @app.sample_state(),
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=id,
      target=@app.EnrollmentStatusTarget::Passed(
        grade=@tanikun-domain.PassingGrade::Good,
      ),
    ),
  )
  let summary = match state.planner_summary() {
    Ok(value) => value
    Err(_) => fail("expected a planner summary")
  }
  assert_eq(summary.confirmed.half_units(), 4)
  assert_eq(summary.categories[0].confirmed.half_units(), 4)
  assert_eq(summary.requirement_root.confirmed.status_label(), "達成")
  assert_eq(summary.requirement_root.standard.status_label(), "達成")
  assert_eq(summary.requirement_root.optimistic.status_label(), "達成")
}

///|
test "planner summary reports invalid input" {
  let state = @app.sample_state()
  let enrollments = state.enrollments.copy()
  enrollments.push(
    @tanikun-domain.Enrollment::planned(planner_offering_id("missing-offering")),
  )
  let state = @app.PlannerState::new(
    state.catalogue,
    state.offerings,
    enrollments,
    state.overrides,
    state.profile,
    state.requirement_sets,
    state.custom_categories,
  )
  match state.planner_summary() {
    Err(_) => ()
    Ok(_) => fail("expected an invalid summary")
  }
  match state.planner_summary() {
    Err(_) => ()
    Ok(_) => fail("expected invalid credit totals")
  }
}

///|
test "a credits override updates the summary" {
  let state = @app.sample_state()
  let offering_id = planner_offering_id("phy101-s1")
  let state = open_override_form(state, offering_id)
  let state = update_override(state, @app.OverrideField::Credits, "6")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitOverride)
  let summary = match state.planner_summary() {
    Ok(value) => value
    Err(_) => fail("expected a planner summary")
  }
  assert_eq(summary.confirmed.half_units(), 0)
  assert_eq(summary.standard.half_units(), 0)
  assert_eq(summary.optimistic.half_units(), 14)
  assert_eq(summary.categories[0].optimistic.half_units(), 6)
}

///|
test "undo restores a passed enrollment with its grade and snapshot" {
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
  let before = state.enrollments[0]
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::RemoveEnrollment(offering_id=id),
  )
  assert_eq(state.enrollments.length(), 0)
  assert_true(state.undo_available())
  let state = @app.update_planner(state, @app.PlannerMsg::UndoEnrollmentRemoval)
  assert_eq(state.enrollments.length(), 1)
  assert_true(!state.undo_available())
  let after = state.enrollments[0]
  assert_true(after.offering_id == before.offering_id)
  assert_true(after.is_passed())
  match after.status {
    @tanikun-domain.EnrollmentStatus::Confirmed(
      @tanikun-domain.ConfirmedGrade::Passed(grade~, ..)
    ) => assert_true(grade == @tanikun-domain.PassingGrade::Good)
    _ => fail("expected the passed grade to survive undo")
  }
  let snapshot = match after.snapshot() {
    Some(value) => value
    None => fail("expected the pass snapshot to survive undo")
  }
  assert_eq(snapshot.name, "Physics")
  assert_eq(snapshot.credits.half_units(), 4)
}

///|
test "undo disappears after an unrelated state change" {
  let id = planner_offering_id("offering-1")
  let state = @app.update_planner(
    planner_state(),
    @app.PlannerMsg::AddOffering(offering_id=id),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::RemoveEnrollment(offering_id=id),
  )
  assert_true(state.undo_available())
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::SelectTerm(term=@app.PlannerTerm::S2),
  )
  assert_true(!state.undo_available())
  let state = @app.update_planner(state, @app.PlannerMsg::UndoEnrollmentRemoval)
  assert_eq(state.enrollments.length(), 0)
}

///|
test "a slot override does not move a passed block" {
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
  assert_eq(state.overrides.len(), 1)
  let block = state.scheduled_blocks(@app.PlannerTerm::S1)[0]
  assert_true(block.day == @tanikun-domain.DayOfWeek::Monday)
  assert_eq(block.period.value(), 1)
  let display = match state.offering_display(id) {
    Some(value) => value
    None => fail("expected an offering display")
  }
  assert_true(display.slots[0].day == @tanikun-domain.DayOfWeek::Monday)
  assert_eq(display.slots[0].period.value(), 1)
}

///|
test "frozen passed slots drive conflict checks in both directions" {
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
  let course = planner_course("PHY102", "Other Physics", 4)
  let catalogue = state.catalogue.copy()
  catalogue.push(course)

  let frozen = planner_offering(
    "offering-frozen",
    course,
    @tanikun-domain.Term::S1,
    [planner_slot(@tanikun-domain.DayOfWeek::Monday, 1)],
  )
  let offerings = state.offerings.copy()
  offerings.push(frozen)
  let frozen_state = @app.PlannerState::new(
    catalogue,
    offerings,
    state.enrollments,
    state.overrides,
    state.profile,
    state.requirement_sets,
    state.custom_categories,
  )
  let frozen_state = @app.update_planner(
    frozen_state,
    @app.PlannerMsg::AddOffering(
      offering_id=planner_offering_id("offering-frozen"),
    ),
  )
  match frozen_state.error {
    Some(error) => assert_true(error.kind == @app.UiErrorKind::SlotConflict)
    None => fail("frozen passed slot should reject placement")
  }

  let ghost = planner_offering(
    "offering-ghost",
    course,
    @tanikun-domain.Term::S1,
    [planner_slot(@tanikun-domain.DayOfWeek::Tuesday, 4)],
  )
  let offerings = state.offerings.copy()
  offerings.push(ghost)
  let ghost_state = @app.PlannerState::new(
    catalogue,
    offerings,
    state.enrollments,
    state.overrides,
    state.profile,
    state.requirement_sets,
    state.custom_categories,
  )
  let ghost_state = @app.update_planner(
    ghost_state,
    @app.PlannerMsg::AddOffering(
      offering_id=planner_offering_id("offering-ghost"),
    ),
  )
  match ghost_state.error {
    None => ()
    Some(_) => fail("overridden ghost slot should remain free")
  }
  assert_eq(ghost_state.enrollments.length(), 2)
}

///|
test "a custom course can be assigned to a requirement category" {
  let state = @app.sample_state()
  let before = match state.planner_summary() {
    Ok(value) => {
      let mut total = 0
      for category in value.categories {
        if category.name == "実験" {
          total = category.optimistic.half_units()
        }
      }
      total
    }
    Err(_) => fail("expected a summary")
  }
  let state = open_custom_form(state)
  let state = update_custom(state, @app.CustomCourseField::Name, "Lab Custom")
  let state = update_custom(state, @app.CustomCourseField::Category, "lab")
  let state = @app.update_planner(state, @app.PlannerMsg::SubmitCustomCourse)
  assert_eq(state.custom_categories.length(), 1)
  let course_id = state.catalogue[state.catalogue.length() - 1].id
  assert_eq(state.category_name_for(course_id), Some("実験"))
  let offering_id = state.offerings[state.offerings.length() - 1].id
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id~),
  )
  let after = match state.planner_summary() {
    Ok(value) => {
      let mut total = 0
      for category in value.categories {
        if category.name == "実験" {
          total = category.optimistic.half_units()
        }
      }
      total
    }
    Err(_) => fail("expected a summary")
  }
  assert_eq(after, before + 4)
}

///|
test "a partially satisfied root does not fill the confirmed bar" {
  let state = @app.sample_state()
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=planner_offering_id("phy301-s"),
      target=@app.EnrollmentStatusTarget::Passed(
        grade=@tanikun-domain.PassingGrade::Good,
      ),
    ),
  )
  let summary = match state.planner_summary() {
    Ok(value) => value
    Err(_) => fail("expected a planner summary")
  }
  assert_eq(summary.confirmed.half_units(), 2)
  assert_eq(summary.requirement_root.confirmed.done, 0)
  assert_eq(summary.requirement_root.confirmed.total, 2)
  assert_eq(summary.requirement_root.confirmed.status_label(), "不足")
  assert_eq(
    summary.requirement_root.optimistic.status_label(),
    "計画上充足",
  )
  assert_eq(summary.requirement_root.confirmed.remaining, "あと 2件")
}
