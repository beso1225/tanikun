///|
/// Evidence that offerings use a common allocation on coordinated meeting dates.
/// This is a source assertion, not an inference from matching printed slots.
pub struct CoordinatedAllocation {
  group : String
  source : String
}

///|
pub fn CoordinatedAllocation::new(
  group : String,
  source : String,
) -> Result[CoordinatedAllocation, DomainError] {
  for text in [group, source] {
    if has_control_character(text) {
      return Err(DomainError::InvalidAllocationEvidence)
    }
    match validate_display_name(text, DomainError::InvalidAllocationEvidence) {
      Err(error) => return Err(error)
      Ok(_) => ()
    }
  }
  Ok({ group, source, })
}
