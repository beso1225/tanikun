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
  priv term_slots : Array[(Term, Array[Slot])]
  coordinated_allocation : CoordinatedAllocation?
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
  Ok({
    id,
    course_id,
    academic_year,
    schedule,
    status,
    slots,
    term_slots: [],
    coordinated_allocation: None,
  })
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
/// Replaces the weekly allocation with complete, term-specific phases. The
/// offering ID and enrollment identity stay unchanged. Inputs are copied.
pub fn CourseOffering::with_term_slots(
  self : CourseOffering,
  phases : Array[(Term, Array[Slot])],
) -> Result[CourseOffering, DomainError] {
  let terms = match self.schedule {
    Regular(terms~) => terms
    YearLong => [S1, S2, A1, A2]
    Intensive(_) => return Err(DomainError::UnexpectedOfferingSlots)
  }
  let copied : Array[(Term, Array[Slot])] = []
  let union = []
  for phase in phases {
    if !terms.contains(phase.0) {
      return Err(DomainError::UnexpectedOfferingPhase(term=phase.0))
    }
    if copied.any(other => other.0 == phase.0) {
      return Err(DomainError::DuplicateOfferingTerm(term=phase.0))
    }
    match validate_slots(self.schedule, self.status, phase.1) {
      Err(error) => return Err(error)
      Ok(_) => ()
    }
    copied.push((phase.0, phase.1.copy()))
    for slot in phase.1 {
      if !union.contains(slot) {
        union.push(slot)
      }
    }
  }
  for term in terms {
    if !copied.any(phase => phase.0 == term) {
      return Err(DomainError::MissingOfferingPhase(term~))
    }
  }
  Ok({ ..self, term_slots: copied, slots: union, coordinated_allocation: None, })
}

///|
/// Returns a copy of the allocation in one active term, or no slots outside it.
pub fn CourseOffering::slots_in_term(
  self : CourseOffering,
  term : Term,
) -> Array[Slot] {
  let active = match self.schedule {
    Regular(terms~) => terms.contains(term)
    YearLong => true
    Intensive(_) => return []
  }
  if !active {
    return []
  }
  for phase in self.term_slots {
    if phase.0 == term {
      return phase.1.copy()
    }
  }
  self.slots()
}

///|
/// Attaches source-backed coordination evidence. Callers must verify that the
/// source establishes coordinated, non-simultaneous use of the allocation.
pub fn CourseOffering::with_coordinated_allocation(
  self : CourseOffering,
  allocation : CoordinatedAllocation,
) -> CourseOffering {
  { ..self, coordinated_allocation: Some(allocation), }
}

///|
/// Coordination applies only to distinct offerings in the same academic year.
pub fn CourseOffering::coordinates_with(
  self : CourseOffering,
  other : CourseOffering,
) -> Bool {
  self.id != other.id &&
  self.academic_year == other.academic_year &&
  (match (self.coordinated_allocation, other.coordinated_allocation) {
    (Some(a), Some(b)) => a.group == b.group && a.source == b.source
    _ => false
  })
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
