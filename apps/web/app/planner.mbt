///|
/// The five UI terms. W has no domain `Term`; it is the off-grid winter period.
pub(all) enum PlannerTerm {
  S1
  S2
  A1
  A2
  W
} derive(Eq)

///|
pub extend PlannerTerm with Eq::{not_equal, equal}

///|
pub fn PlannerTerm::values() -> Array[PlannerTerm] {
  [S1, S2, A1, A2, W]
}

///|
pub fn PlannerTerm::semester(self : PlannerTerm) -> @tanikun-domain.Semester {
  match self {
    S1 | S2 => @tanikun-domain.Semester::S
    A1 | A2 => @tanikun-domain.Semester::A
    W => @tanikun-domain.Semester::W
  }
}

///|
pub fn PlannerTerm::term(self : PlannerTerm) -> @tanikun-domain.Term? {
  match self {
    S1 => Some(@tanikun-domain.Term::S1)
    S2 => Some(@tanikun-domain.Term::S2)
    A1 => Some(@tanikun-domain.Term::A1)
    A2 => Some(@tanikun-domain.Term::A2)
    W => None
  }
}

///|
pub fn PlannerTerm::label(self : PlannerTerm) -> String {
  match self {
    S1 => "S1"
    S2 => "S2"
    A1 => "A1"
    A2 => "A2"
    W => "W"
  }
}

///|
pub(all) enum UiErrorTarget {
  General
  Course(course_id~ : @tanikun-domain.CourseId)
  Offering(offering_id~ : @tanikun-domain.OfferingId)
}

///|
pub(all) enum UiErrorKind {
  DomainValidation
  DuplicateEnrollment
  SlotConflict
  NotOfferedInTerm
  UnknownOffering
  UnknownEnrollment
  General
} derive(Eq)

///|
pub extend UiErrorKind with Eq::{not_equal, equal}

///|
pub struct UiError {
  target : UiErrorTarget
  kind : UiErrorKind
  message : String
}

///|
pub fn UiError::new(
  target : UiErrorTarget,
  kind : UiErrorKind,
  message : String,
) -> UiError {
  { target, kind, message, }
}

///|
/// Maps a pure validation error into a UI error without exposing the enum to
/// the view. The target comes from the form or course that produced the error.
pub fn UiError::from_domain(
  error : @tanikun-domain.DomainError,
  target : UiErrorTarget,
) -> UiError {
  let message = match error {
    @tanikun-domain.DomainError::InvalidCredits(_) =>
      "単位数が正しくありません"
    @tanikun-domain.DomainError::InvalidAcademicYear(_) =>
      "年度が正しくありません"
    @tanikun-domain.DomainError::InvalidPeriod(_) =>
      "時限が正しくありません"
    @tanikun-domain.DomainError::EmptyIdField(..) =>
      "IDを入力してください"
    @tanikun-domain.DomainError::ControlCharacterInId(..) =>
      "IDに使用できない文字があります"
    @tanikun-domain.DomainError::EmptyCourseName =>
      "科目名を入力してください"
    @tanikun-domain.DomainError::DuplicateCourseId(_) =>
      "科目IDが重複しています"
    @tanikun-domain.DomainError::DuplicateOfferingId(_) =>
      "開講IDが重複しています"
    @tanikun-domain.DomainError::DuplicateEnrollment(_) =>
      "同じ開講がすでに登録されています"
    @tanikun-domain.DomainError::UnknownCourse(_) =>
      "科目が見つかりません"
    @tanikun-domain.DomainError::UnknownOffering(_) =>
      "開講が見つかりません"
    @tanikun-domain.DomainError::NotOfferedEnrollment(_) =>
      "この年度には開講されていません"
    @tanikun-domain.DomainError::EmptyRuleChildren =>
      "ルールの子がありません"
    _ => "入力内容を確認してください"
  }
  UiError::new(target, UiErrorKind::DomainValidation, message)
}

///|
pub(all) enum TimetableError {
  DuplicateEnrollment(offering_id~ : @tanikun-domain.OfferingId)
  SlotConflict(
    offering_id~ : @tanikun-domain.OfferingId,
    slot~ : @tanikun-domain.Slot
  )
  NotOfferedInTerm(offering_id~ : @tanikun-domain.OfferingId)
  UnknownOffering(offering_id~ : @tanikun-domain.OfferingId)
}

///|
pub fn TimetableError::to_ui(self : TimetableError) -> UiError {
  match self {
    DuplicateEnrollment(offering_id~) =>
      UiError::new(
        UiErrorTarget::Offering(offering_id~),
        UiErrorKind::DuplicateEnrollment,
        "同じ開講がすでに登録されています",
      )
    SlotConflict(offering_id~, ..) =>
      UiError::new(
        UiErrorTarget::Offering(offering_id~),
        UiErrorKind::SlotConflict,
        "同じ曜限に別の開講があります",
      )
    NotOfferedInTerm(offering_id~) =>
      UiError::new(
        UiErrorTarget::Offering(offering_id~),
        UiErrorKind::NotOfferedInTerm,
        "選択中の学期には開講されていません",
      )
    UnknownOffering(offering_id~) =>
      UiError::new(
        UiErrorTarget::Offering(offering_id~),
        UiErrorKind::UnknownOffering,
        "開講が見つかりません",
      )
  }
}

///|
/// In-memory Phase 2 planner state. Derived credits and requirements are not
/// stored here; they are computed from this state.
pub struct PlannerState {
  catalogue : Array[@tanikun-domain.Course]
  offerings : Array[@tanikun-domain.CourseOffering]
  enrollments : Array[@tanikun-domain.Enrollment]
  overrides : @tanikun-domain.Overrides
  profile : @tanikun-domain.AcademicProfile
  requirement_set : @tanikun-requirements.RequirementSet[
    @tanikun-requirements.Rule,
  ]
  requirement_sets : @tanikun-requirements.RequirementSets[
    @tanikun-requirements.Rule,
  ]
  selected_term : PlannerTerm
  selected_offering : @tanikun-domain.OfferingId?
  error : UiError?
}

///|
pub fn PlannerState::new(
  catalogue : Array[@tanikun-domain.Course],
  offerings : Array[@tanikun-domain.CourseOffering],
  enrollments : Array[@tanikun-domain.Enrollment],
  overrides : @tanikun-domain.Overrides,
  profile : @tanikun-domain.AcademicProfile,
  requirement_set : @tanikun-requirements.RequirementSet[
    @tanikun-requirements.Rule,
  ],
  requirement_sets : @tanikun-requirements.RequirementSets[
    @tanikun-requirements.Rule,
  ],
) -> PlannerState {
  {
    catalogue: catalogue.copy(),
    offerings: offerings.copy(),
    enrollments: enrollments.copy(),
    overrides,
    profile,
    requirement_set,
    requirement_sets,
    selected_term: S1,
    selected_offering: None,
    error: None,
  }
}

///|
/// Phase 2 messages. Status, custom-data, and override messages arrive with
/// their own issues.
pub(all) enum PlannerMsg {
  SelectTerm(term~ : PlannerTerm)
  SelectOffering(offering_id~ : @tanikun-domain.OfferingId)
  ClearOfferingSelection
  AddOffering(offering_id~ : @tanikun-domain.OfferingId)
  RemoveEnrollment(offering_id~ : @tanikun-domain.OfferingId)
  DismissError
}

///|
pub fn update_planner(state : PlannerState, msg : PlannerMsg) -> PlannerState {
  match msg {
    SelectTerm(term~) => { ..state, selected_term: term, error: None, }
    SelectOffering(offering_id~) =>
      match find_offering(state.offerings, offering_id) {
        Some(_) =>
          { ..state, selected_offering: Some(offering_id), error: None, }
        None =>
          with_error(
            state,
            TimetableError::UnknownOffering(offering_id~).to_ui(),
          )
      }
    ClearOfferingSelection => { ..state, selected_offering: None, error: None, }
    AddOffering(offering_id~) => add_offering(state, offering_id)
    RemoveEnrollment(offering_id~) => remove_enrollment(state, offering_id)
    DismissError => { ..state, error: None, }
  }
}

///|
fn with_error(state : PlannerState, error : UiError) -> PlannerState {
  { ..state, error: Some(error), }
}

///|
fn find_offering(
  offerings : Array[@tanikun-domain.CourseOffering],
  id : @tanikun-domain.OfferingId,
) -> @tanikun-domain.CourseOffering? {
  for offering in offerings {
    if offering.id == id {
      return Some(offering)
    }
  }
  None
}

///|
fn has_enrollment(
  enrollments : Array[@tanikun-domain.Enrollment],
  id : @tanikun-domain.OfferingId,
) -> Bool {
  for enrollment in enrollments {
    if enrollment.offering_id == id {
      return true
    }
  }
  false
}

///|
fn term_in_terms(
  term : @tanikun-domain.Term,
  terms : Array[@tanikun-domain.Term],
) -> Bool {
  for candidate in terms {
    if candidate == term {
      return true
    }
  }
  false
}

///|
fn offering_available_in_term(
  offering : @tanikun-domain.CourseOffering,
  planner_term : PlannerTerm,
) -> Bool {
  match offering.schedule() {
    @tanikun-domain.OfferingSchedule::Regular(terms~) =>
      match planner_term.term() {
        Some(term) => term_in_terms(term, terms)
        None => false
      }
    @tanikun-domain.OfferingSchedule::YearLong => planner_term != W
    @tanikun-domain.OfferingSchedule::Intensive(semester~) =>
      semester == planner_term.semester()
  }
}

///|
fn find_slot_conflict(
  state : PlannerState,
  offering : @tanikun-domain.CourseOffering,
) -> @tanikun-domain.Slot? {
  let slots = offering.slots()
  for enrollment in state.enrollments {
    match find_offering(state.offerings, enrollment.offering_id) {
      Some(other) =>
        for slot in slots {
          for other_slot in other.slots() {
            if slot == other_slot {
              return Some(slot)
            }
          }
        }
      None => ()
    }
  }
  None
}

///|
fn add_offering(
  state : PlannerState,
  id : @tanikun-domain.OfferingId,
) -> PlannerState {
  let offering = match find_offering(state.offerings, id) {
    Some(offering) => offering
    None =>
      return with_error(
        state,
        TimetableError::UnknownOffering(offering_id=id).to_ui(),
      )
  }
  if has_enrollment(state.enrollments, id) {
    return with_error(
      state,
      TimetableError::DuplicateEnrollment(offering_id=id).to_ui(),
    )
  }
  if !offering_available_in_term(offering, state.selected_term) {
    return with_error(
      state,
      TimetableError::NotOfferedInTerm(offering_id=id).to_ui(),
    )
  }
  match find_slot_conflict(state, offering) {
    Some(slot) =>
      return with_error(
        state,
        TimetableError::SlotConflict(offering_id=id, slot~).to_ui(),
      )
    None => ()
  }
  let enrollments = state.enrollments.copy()
  enrollments.push(@tanikun-domain.Enrollment::planned(id))
  { ..state, enrollments, selected_offering: None, error: None, }
}

///|
fn remove_enrollment(
  state : PlannerState,
  id : @tanikun-domain.OfferingId,
) -> PlannerState {
  let enrollments : Array[@tanikun-domain.Enrollment] = []
  let mut found = false
  for enrollment in state.enrollments {
    if enrollment.offering_id == id {
      found = true
    } else {
      enrollments.push(enrollment)
    }
  }
  if !found {
    return with_error(
      state,
      UiError::new(
        UiErrorTarget::Offering(offering_id=id),
        UiErrorKind::UnknownEnrollment,
        "履修が見つかりません",
      ),
    )
  }
  { ..state, enrollments, error: None, }
}
