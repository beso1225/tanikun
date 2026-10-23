///|
/// The complete pure input for credit accumulation and requirement evaluation.
pub struct EvaluationInput[Rule] {
  priv profile : @tanikun-domain.AcademicProfile
  priv requirement_set : RequirementSet[Rule]
  priv courses : Array[@tanikun-domain.Course]
  priv offerings : Array[@tanikun-domain.CourseOffering]
  priv enrollments : Array[@tanikun-domain.Enrollment]
  priv overrides : @tanikun-domain.Overrides
}

///|
pub fn[Rule] EvaluationInput::new(
  profile : @tanikun-domain.AcademicProfile,
  requirement_set : RequirementSet[Rule],
  courses : Array[@tanikun-domain.Course],
  offerings : Array[@tanikun-domain.CourseOffering],
  enrollments : Array[@tanikun-domain.Enrollment],
  overrides : @tanikun-domain.Overrides,
) -> EvaluationInput[Rule] {
  {
    profile,
    requirement_set,
    courses: courses.copy(),
    offerings: offerings.copy(),
    enrollments: enrollments.copy(),
    overrides,
  }
}
