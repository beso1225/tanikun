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
