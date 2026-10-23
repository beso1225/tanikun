///|
/// Identifies the aggregate that owns an ID.
///
/// The enum is shared by all ID types added in later Phase 1 issues.
pub(all) enum IdKind {
  Course
  Offering
  Program
  Category
}

///|
/// Identifies the part of an ID that failed validation.
///
/// `Value` is used by single-part IDs such as `OfferingId`.
pub(all) enum IdField {
  Namespace
  Local
  Value
}

///|
/// A typed domain validation failure.
///
/// Phase 1 intentionally uses one flat error type across the domain and
/// requirements packages. Revisit the split when the API error model is
/// designed.
pub(all) enum DomainError {
  InvalidCredits(half_units~ : Int)
  InvalidAcademicYear(year~ : Int)
  InvalidPeriod(value~ : Int)
  EmptyIdField(kind~ : IdKind, field~ : IdField)
  ControlCharacterInId(kind~ : IdKind, field~ : IdField)
  EmptyCourseName
  DuplicateCourseId(id~ : CourseId)
  EmptyOfferingTerms
  DuplicateOfferingTerm(term~ : Term)
  MixedOfferingTerms
  MissingOfferingSlots
  UnexpectedOfferingSlots
  DuplicateOfferingSlot(slot~ : Slot)
  DuplicateOverride(target~ : OverrideTarget, attribute~ : OverrideAttribute)
  InvalidOverrideCombination(
    target~ : OverrideTarget,
    attribute~ : OverrideAttribute
  )
  EmptyOverrideText
  EmptyProgramName
  EmptyCategoryName
  DuplicateCategoryId(id~ : CategoryId)
  UnknownCategory(id~ : CategoryId)
  DuplicateCategoryAssignment(course_id~ : CourseId)
  DuplicateRequirementSet(
    program_id~ : ProgramId,
    advancement_year~ : AcademicYear
  )
  EmptyRuleCategories
  DuplicateRuleCategory(id~ : CategoryId)
  UnknownRuleCategory(id~ : CategoryId)
  EmptyRuleCourses
  DuplicateRuleCourse(course_id~ : CourseId)
  UnknownRuleCourse(course_id~ : CourseId)
  EmptyRuleChildren
  InvalidRuleThreshold(credits~ : Credits)
  InvalidAtLeastCount(count~ : Int, child_count~ : Int)
}
