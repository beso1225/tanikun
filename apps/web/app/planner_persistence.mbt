///|
/// Encodes only source planner state. Derived values and transient UI state are
/// intentionally excluded.
pub fn encode_planner_state(state : PlannerState) -> String {
  persisted_plan(state).to_json().stringify()
}

///|
/// Restores source state on top of the supplied requirement-set baseline.
pub fn decode_planner_state(
  base : PlannerState,
  text : String,
) -> Result[PlannerState, String] {
  restore_planner_state(base, text)
}
