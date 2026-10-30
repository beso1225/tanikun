///|
test "mandatory checklist counts three planning modes and identifies missing courses" {
  let base = allocation_state()
  let ids = [base.catalogue[0].id, base.catalogue[1].id, base.catalogue[2].id]
  let rule = planner_expect_ok(
    @tanikun-requirements.Rule::all([
      planner_expect_ok(@tanikun-requirements.Rule::mandatory_courses(ids)),
    ]),
  )
  let set = planner_expect_ok(
    @tanikun-requirements.RequirementSet::new(
      @tanikun-requirements.RequirementSetKey::new(
        base.profile.program_id,
        base.profile.advancement_year,
      ),
      [],
      [],
      rule,
    ),
  )
  let state = @app.PlannerState::new(
    base.catalogue,
    base.offerings,
    [],
    base.overrides,
    base.profile,
    planner_expect_ok(@tanikun-requirements.RequirementSets::new([set])),
    [],
  )
  let empty = planner_expect_ok(state.planner_summary())
  assert_eq(empty.requirement_root.children[0].label, "必修")
  assert_eq(empty.requirement_root.children[0].missing_courses.length(), 3)
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("design")),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("lab")),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("exercise")),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=planner_offering_id("design"),
      target=@app.EnrollmentStatusTarget::Passed(
        grade=@tanikun-domain.PassingGrade::Good,
      ),
    ),
  )
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::UpdateEnrollmentStatus(
      offering_id=planner_offering_id("lab"),
      target=@app.EnrollmentStatusTarget::InProgress,
    ),
  )
  let summary = planner_expect_ok(state.planner_summary())
  let required = summary.requirement_root.children[0]
  assert_eq(required.confirmed.done, 1)
  assert_eq(required.standard.done, 2)
  assert_eq(required.optimistic.done, 3)
  assert_eq(required.optimistic.progress, "3 / 3科目")
  assert_eq(required.missing_courses.length(), 0)
  assert_eq(
    summary.requirement_root.optimistic.status_label(),
    "計画上充足",
  )
  for
    target in [
      @app.EnrollmentStatusTarget::Failed(
        grade=@tanikun-domain.FailingGrade::Fail,
      ),
      @app.EnrollmentStatusTarget::NotTaken,
    ] {
    let excluded = @app.update_planner(
      state,
      @app.PlannerMsg::UpdateEnrollmentStatus(
        offering_id=planner_offering_id("exercise"),
        target~,
      ),
    )
    let node = planner_expect_ok(excluded.planner_summary()).requirement_root.children[0]
    assert_eq(node.optimistic.done, 2)
    assert_eq(node.missing_courses, ["Coordinated exercise"])
  }
  let state = @app.update_planner(
    state,
    @app.PlannerMsg::RemoveEnrollment(
      offering_id=planner_offering_id("exercise"),
    ),
  )
  let required = planner_expect_ok(state.planner_summary()).requirement_root.children[0]
  assert_eq(required.optimistic.done, 2)
  assert_eq(required.missing_courses, ["Coordinated exercise"])
}

///|
test "mandatory checklist follows the selected fictional curriculum" {
  let base = allocation_state()
  for count in [2, 3] {
    let program = planner_expect_ok(
      @tanikun-domain.ProgramId::new("program-\{count}"),
    )
    let profile = @tanikun-domain.AcademicProfile::new(
      program,
      base.profile.advancement_year,
    )
    let ids = []
    for index in 0..<count {
      ids.push(base.catalogue[index].id)
    }
    let rule = planner_expect_ok(
      @tanikun-requirements.Rule::mandatory_courses(ids),
    )
    let set = planner_expect_ok(
      @tanikun-requirements.RequirementSet::new(
        @tanikun-requirements.RequirementSetKey::new(
          program,
          profile.advancement_year,
        ),
        [],
        [],
        rule,
      ),
    )
    let state = @app.PlannerState::new(
      base.catalogue,
      base.offerings,
      [],
      base.overrides,
      profile,
      planner_expect_ok(@tanikun-requirements.RequirementSets::new([set])),
      [],
    )
    let state = @app.update_planner(
      state,
      @app.PlannerMsg::AddOffering(offering_id=planner_offering_id("design")),
    )
    let node = planner_expect_ok(state.planner_summary()).requirement_root
    assert_eq(node.label, "必修")
    assert_eq(node.confirmed.done, 0)
    assert_eq(node.standard.done, 0)
    assert_eq(node.optimistic.done, 1)
    assert_eq(node.optimistic.total, count)
    assert_eq(node.missing_courses.length(), count - 1)
  }
}
