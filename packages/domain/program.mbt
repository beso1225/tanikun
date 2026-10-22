///|
/// A stable, non-empty program identifier.
pub struct ProgramId {
  value : String
} derive(Eq)

///|
pub extend ProgramId with Eq::{not_equal, equal}

///|
pub fn ProgramId::new(value : String) -> Result[ProgramId, DomainError] {
  if is_blank(value) {
    Err(DomainError::EmptyIdField(kind=IdKind::Program, field=IdField::Value))
  } else if has_control_character(value) {
    Err(
      DomainError::ControlCharacterInId(
        kind=IdKind::Program,
        field=IdField::Value,
      ),
    )
  } else {
    Ok({ value, })
  }
}

///|
/// A program with a stable identity and a display name.
pub struct Program {
  id : ProgramId
  name : String
}

///|
pub fn Program::new(
  id : ProgramId,
  name : String,
) -> Result[Program, DomainError] {
  match validate_display_name(name, DomainError::EmptyProgramName) {
    Err(error) => Err(error)
    Ok(_) => Ok({ id, name, })
  }
}
