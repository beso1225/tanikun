///|
/// Identifies the aggregate that owns an ID.
pub(all) enum IdKind {
  Course
  Offering
  Program
  Category
}

///|
/// Identifies the part of an ID that failed validation.
pub(all) enum IdField {
  Namespace
  Local
}

///|
/// A typed domain validation failure.
pub(all) enum DomainError {
  InvalidCredits(half_units~ : Int)
  EmptyIdField(kind~ : IdKind, field~ : IdField)
  ControlCharacterInId(kind~ : IdKind, field~ : IdField)
  EmptyCourseName
  DuplicateCourseId(id~ : CourseId)
}
