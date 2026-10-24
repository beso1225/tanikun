///|
/// Replaces one enrollment and validates the resulting dataset.
///
/// The input is validated first, so a correction cannot repair an already
/// invalid dataset. The input is immutable: one previous entry is removed, the
/// corrected entry is appended, and a new `EvaluationInput` is returned only
/// after validation. `corrected` may reference a different offering, in which
/// case the enrollment is effectively moved; appending also means enrollment
/// order can change. Only an explicit correction can introduce a regenerated
/// passed snapshot.
pub fn correct_enrollment(
  input : EvaluationInput[Rule],
  previous_offering : @tanikun-domain.OfferingId,
  corrected : @tanikun-domain.Enrollment,
) -> Result[EvaluationInput[Rule], @tanikun-domain.DomainError] {
  match accumulate_credits(input) {
    Ok(_) => ()
    Err(error) => return Err(error)
  }
  let enrollments : Array[@tanikun-domain.Enrollment] = []
  let mut found = false
  for enrollment in input.enrollments() {
    if !found && enrollment.offering_id == previous_offering {
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
