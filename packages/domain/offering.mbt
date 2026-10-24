///|
/// A stable, non-empty offering identifier.
pub struct OfferingId {
  value : String
} derive(Eq)

///|
pub extend OfferingId with Eq::{not_equal, equal}

///|
pub impl Compare for OfferingId with fn compare(self, other) {
  compare_code_units(self.value, other.value)
}

///|
pub extend OfferingId with Compare::{op_lt, op_le, op_ge, compare, op_gt}

///|
pub fn OfferingId::new(value : String) -> Result[OfferingId, DomainError] {
  match validate_single_id(value, IdKind::Offering) {
    Err(error) => Err(error)
    Ok(_) => Ok({ value, })
  }
}

///|
/// The shape of an offering. W only appears as an intensive semester.
pub(all) enum OfferingSchedule {
  Regular(terms~ : Array[Term])
  YearLong
  Intensive(semester~ : Semester)
}

///|
/// Whether the course is actually offered in the recorded academic year.
pub(all) enum OfferingStatus {
  Offered
  NotOffered
} derive(Eq)

///|
pub extend OfferingStatus with Eq::{not_equal, equal}

///|
/// A course offering with an explicit academic year, schedule, status, and
/// timetable slots.
///
/// `new` validates the schedule and slots together. The schedule and slots
/// getters return copies so callers cannot mutate the validated state.
pub struct CourseOffering {
  id : OfferingId
  course_id : CourseId
  academic_year : AcademicYear
  priv schedule : OfferingSchedule
  status : OfferingStatus
  priv slots : Array[Slot]
}

///|
pub fn CourseOffering::new(
  id : OfferingId,
  course_id : CourseId,
  academic_year : AcademicYear,
  schedule : OfferingSchedule,
  status : OfferingStatus,
  slots : Array[Slot],
) -> Result[CourseOffering, DomainError] {
  let schedule = match schedule {
    Regular(terms~) => Regular(terms=terms.copy())
    YearLong => YearLong
    Intensive(semester~) => Intensive(semester~)
  }
  let slots = slots.copy()
  let terms_result = match schedule {
    Regular(terms~) => validate_regular_terms(terms)
    _ => Ok(())
  }
  match terms_result {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  match validate_slots(schedule, status, slots) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  Ok({ id, course_id, academic_year, schedule, status, slots, })
}

///|
/// Returns a copy of the offering schedule.
pub fn CourseOffering::schedule(self : CourseOffering) -> OfferingSchedule {
  match self.schedule {
    Regular(terms~) => Regular(terms=terms.copy())
    YearLong => YearLong
    Intensive(semester~) => Intensive(semester~)
  }
}

///|
/// Returns a copy of the offering's slots.
pub fn CourseOffering::slots(self : CourseOffering) -> Array[Slot] {
  self.slots.copy()
}

///|
fn validate_regular_terms(terms : Array[Term]) -> Result[Unit, DomainError] {
  if terms.is_empty() {
    return Err(DomainError::EmptyOfferingTerms)
  }
  for index in 0..<terms.length() {
    for other in (index + 1)..<terms.length() {
      if terms[index] == terms[other] {
        return Err(DomainError::DuplicateOfferingTerm(term=terms[index]))
      }
    }
  }
  let semester = terms[0].semester()
  for term in terms {
    if term.semester() != semester {
      return Err(DomainError::MixedOfferingTerms)
    }
  }
  Ok(())
}

///|
fn validate_slots(
  schedule : OfferingSchedule,
  status : OfferingStatus,
  slots : Array[Slot],
) -> Result[Unit, DomainError] {
  match status {
    NotOffered =>
      if !slots.is_empty() {
        return Err(DomainError::UnexpectedOfferingSlots)
      }
    Offered =>
      match schedule {
        Intensive(_) =>
          if !slots.is_empty() {
            return Err(DomainError::UnexpectedOfferingSlots)
          }
        _ =>
          if slots.is_empty() {
            return Err(DomainError::MissingOfferingSlots)
          }
      }
  }
  for index in 0..<slots.length() {
    for other in (index + 1)..<slots.length() {
      if slots[index] == slots[other] {
        return Err(DomainError::DuplicateOfferingSlot(slot=slots[index]))
      }
    }
  }
  Ok(())
}
