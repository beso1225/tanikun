///|
/// Replaces one enrollment and validates the resulting dataset.
///
/// The input is immutable: the previous entry is removed, the corrected entry
/// is appended, and a new `EvaluationInput` is returned only after validation.
/// Only an explicit correction can introduce a regenerated passed snapshot.
pub fn correct_enrollment(
  input : EvaluationInput[Rule],
  previous_offering : @tanikun-domain.OfferingId,
  corrected : @tanikun-domain.Enrollment,
) -> Result[EvaluationInput[Rule], @tanikun-domain.DomainError] {
  let enrollments : Array[@tanikun-domain.Enrollment] = []
  let mut found = false
  for enrollment in input.enrollments() {
    if enrollment.offering_id == previous_offering {
      found = true
    } else {
      enrollments.push(enrollment)
    }
  }
  if !found {
    return Err(
      @tanikun-domain.DomainError::UnknownEnrollment(
        offering_id=previous_offering,
      ),
    )
  }
  enrollments.push(corrected)
  let updated = EvaluationInput::new(
    input.profile(),
    input.requirement_set(),
    input.courses(),
    input.offerings(),
    enrollments,
    input.overrides(),
  )
  match accumulate_credits(updated) {
    Ok(_) => Ok(updated)
    Err(error) => Err(error)
  }
}
