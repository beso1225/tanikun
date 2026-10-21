///|
/// Whether a course is still part of the active master.
///
/// Retired courses stay in the catalog so historical enrollments keep a
/// resolvable ID.
pub(all) enum CourseStatus {
  Active
  Retired
}

///|
/// A course. Categories are owned by requirement sets, not by the course.
pub struct Course {
  id : CourseId
  name : String
  credits : Credits
  status : CourseStatus
}

///|
pub fn Course::new(
  id : CourseId,
  name : String,
  credits : Credits,
  status : CourseStatus,
) -> Result[Course, DomainError] {
  if name.trim().is_empty() {
    Err(DomainError::EmptyCourseName)
  } else {
    Ok({ id, name, credits, status, })
  }
}

///|
/// Replaces the display name while preserving the stable course ID.
pub fn Course::rename(
  self : Course,
  name : String,
) -> Result[Course, DomainError] {
  if name.trim().is_empty() {
    Err(DomainError::EmptyCourseName)
  } else {
    Ok({ ..self, name, })
  }
}
