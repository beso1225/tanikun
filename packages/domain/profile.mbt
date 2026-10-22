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
/// The program and advancement year a student's requirements are evaluated
/// against.
pub struct AcademicProfile {
  program_id : ProgramId
  advancement_year : AcademicYear
}

///|
pub fn AcademicProfile::new(
  program_id : ProgramId,
  advancement_year : AcademicYear,
) -> AcademicProfile {
  { program_id, advancement_year, }
}
