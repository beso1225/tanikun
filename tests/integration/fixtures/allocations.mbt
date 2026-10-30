///|
/// Fictional input for browser verification, compiled only into the test build.
pub fn allocation_fixture_state() -> PlannerState {
  let state = sample_state()
  let design = sample_course("DEMO-DESIGN", "Design studio", 6)
  let lab = sample_course("DEMO-LAB", "Coordinated lab", 4)
  let exercise = sample_course("DEMO-EXERCISE", "Coordinated exercise", 2)
  let first = [sample_slot(@tanikun-domain.DayOfWeek::Monday, 3), sample_slot(@tanikun-domain.DayOfWeek::Monday, 4), sample_slot(@tanikun-domain.DayOfWeek::Wednesday, 3), sample_slot(@tanikun-domain.DayOfWeek::Wednesday, 4)]
  let second = first.copy()
  second.push(sample_slot(@tanikun-domain.DayOfWeek::Tuesday, 4))
  second.push(sample_slot(@tanikun-domain.DayOfWeek::Tuesday, 5))
  let phased = sample_ok(sample_offering("demo-design", design, @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::S1, @tanikun-domain.Term::S2]), first).with_term_slots([(@tanikun-domain.Term::S1, first), (@tanikun-domain.Term::S2, second)]))
  let proof = sample_ok(@tanikun-domain.CoordinatedAllocation::new("demo", "Verified fictional handout"))
  let slots = [sample_slot(@tanikun-domain.DayOfWeek::Thursday, 1)]
  let left = sample_offering("demo-lab", lab, @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::S1]), slots).with_coordinated_allocation(proof)
  let right = sample_offering("demo-exercise", exercise, @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::S1]), slots).with_coordinated_allocation(proof)
  let rule = sample_ok(@tanikun-requirements.Rule::mandatory_courses([design.id, lab.id, exercise.id]))
  let set = sample_ok(@tanikun-requirements.RequirementSet::new(@tanikun-requirements.RequirementSetKey::new(state.profile.program_id, state.profile.advancement_year), [], [], sample_ok(@tanikun-requirements.Rule::all([rule]))))
  PlannerState::new([design, lab, exercise], [phased, left, right], [], state.overrides, state.profile, sample_ok(@tanikun-requirements.RequirementSets::new([set])), [])
}
