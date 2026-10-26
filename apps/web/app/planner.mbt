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
    @tanikun-domain.DomainError::EmptyOfferingTerms =>
      "開講学期を指定してください"
    @tanikun-domain.DomainError::DuplicateOfferingTerm(_) =>
      "開講学期が重複しています"
    @tanikun-domain.DomainError::MixedOfferingTerms =>
      "同じセメスターの学期を指定してください"
    @tanikun-domain.DomainError::MissingOfferingSlots =>
      "曜限を指定してください"
    @tanikun-domain.DomainError::UnexpectedOfferingSlots =>
      "この開講では曜限を指定できません"
    @tanikun-domain.DomainError::DuplicateOfferingSlot(_) =>
      "曜限が重複しています"
    @tanikun-domain.DomainError::DuplicateOverride(..) =>
      "同じ上書きが重複しています"
    @tanikun-domain.DomainError::InvalidOverrideCombination(..) =>
      "この属性にはこの値を使えません"
    @tanikun-domain.DomainError::EmptyOverrideText =>
      "上書きの値を入力してください"
    @tanikun-domain.DomainError::EmptyProgramName =>
      "プログラム名を入力してください"
    @tanikun-domain.DomainError::EmptyCategoryName =>
      "区分名を入力してください"
    @tanikun-domain.DomainError::DuplicateCategoryId(_) =>
      "区分IDが重複しています"
    @tanikun-domain.DomainError::UnknownCategory(_) =>
      "区分が見つかりません"
    @tanikun-domain.DomainError::DuplicateCategoryAssignment(_) =>
      "科目の区分が重複しています"
    @tanikun-domain.DomainError::DuplicateRequirementSet(..) =>
      "同じプログラムと年度の要件セットがあります"
    @tanikun-domain.DomainError::EmptyRuleCategories =>
      "区分を指定してください"
    @tanikun-domain.DomainError::DuplicateRuleCategory(_) =>
      "ルールの区分が重複しています"
    @tanikun-domain.DomainError::UnknownRuleCategory(_) =>
      "ルールの区分が見つかりません"
    @tanikun-domain.DomainError::EmptyRuleCourses =>
      "科目を指定してください"
    @tanikun-domain.DomainError::DuplicateRuleCourse(_) =>
      "ルールの科目が重複しています"
    @tanikun-domain.DomainError::UnknownRuleCourse(_) =>
      "ルールの科目が見つかりません"
    @tanikun-domain.DomainError::EmptyRuleChildren =>
      "ルールの子がありません"
    @tanikun-domain.DomainError::InvalidRuleThreshold(_) =>
      "ルールの単位数が正しくありません"
    @tanikun-domain.DomainError::InvalidAtLeastCount(..) =>
      "ルールの個数が子の数と合いません"
    @tanikun-domain.DomainError::DuplicateOfferingId(_) =>
      "開講IDが重複しています"
    @tanikun-domain.DomainError::DuplicateEnrollment(_) =>
      "同じ開講がすでに登録されています"
    @tanikun-domain.DomainError::UnknownOffering(_) =>
      "開講が見つかりません"
    @tanikun-domain.DomainError::UnknownEnrollment(_) =>
      "履修が見つかりません"
    @tanikun-domain.DomainError::UnknownCourse(_) =>
      "科目が見つかりません"
    @tanikun-domain.DomainError::DuplicatePassedCourse(_) =>
      "合格した科目が重複しています"
    @tanikun-domain.DomainError::ProfileRequirementSetMismatch =>
      "プロファイルと要件セットが一致しません"
    @tanikun-domain.DomainError::RetiredCourseEnrollment(_) =>
      "過去科目は履修できません"
    @tanikun-domain.DomainError::NotOfferedEnrollment(_) =>
      "この年度には開講されていません"
    @tanikun-domain.DomainError::PassedSnapshotCourseMismatch(..) =>
      "合格時の科目情報が開講と一致しません"
  }
  UiError::new(target, UiErrorKind::DomainValidation, message)
}

///|
pub(all) enum TimetableError {
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
  catalogue_query : String
  picker : PickerTarget?
  visible_days : Int
  visible_periods : Int
  revision : Int
}

///|
/// Equality drives the Rabbita view refresh. Every state change increments the
/// revision, so the large nested planner state does not need structural Eq.
pub impl Eq for PlannerState with fn equal(self, other) {
  self.revision == other.revision
}

///|
pub extend PlannerState with Eq::{not_equal, equal}

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
    catalogue_query: "",
    picker: None,
    visible_days: 5,
    visible_periods: 6,
    revision: 0,
  }
}

///|
/// The slot or off-grid list that opened the catalogue picker.
pub(all) enum PickerTarget {
  Slot(day~ : @tanikun-domain.DayOfWeek, period~ : Int)
  Intensive
  All
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
  OpenSlotPicker(day~ : @tanikun-domain.DayOfWeek, period~ : Int)
  OpenIntensivePicker
  OpenCataloguePicker
  ClosePicker
  UpdateCatalogueQuery(query~ : String)
  IncreaseVisibleDays
  DecreaseVisibleDays
  IncreaseVisiblePeriods
  DecreaseVisiblePeriods
  DismissError
}

///|
pub fn update_planner(state : PlannerState, msg : PlannerMsg) -> PlannerState {
  match msg {
    SelectTerm(term~) =>
      bump({
        ..state,
        selected_term: term,
        selected_offering: None,
        error: None,
        picker: None,
        catalogue_query: "",
      })
    SelectOffering(offering_id~) =>
      match find_offering(state.offerings, offering_id) {
        Some(_) =>
          bump({ ..state, selected_offering: Some(offering_id), error: None, })
        None =>
          with_error(
            state,
            TimetableError::UnknownOffering(offering_id~).to_ui(),
          )
      }
    ClearOfferingSelection =>
      bump({ ..state, selected_offering: None, error: None, })
    AddOffering(offering_id~) => add_offering(state, offering_id)
    RemoveEnrollment(offering_id~) => remove_enrollment(state, offering_id)
    OpenSlotPicker(day~, period~) =>
      bump({
        ..state,
        picker: Some(PickerTarget::Slot(day~, period~)),
        catalogue_query: "",
      })
    OpenIntensivePicker =>
      bump({
        ..state,
        picker: Some(PickerTarget::Intensive),
        catalogue_query: "",
      })
    OpenCataloguePicker =>
      bump({ ..state, picker: Some(PickerTarget::All), catalogue_query: "", })
    ClosePicker => bump({ ..state, picker: None, catalogue_query: "", })
    UpdateCatalogueQuery(query~) => bump({ ..state, catalogue_query: query, })
    IncreaseVisibleDays =>
      if state.visible_days < 7 {
        bump({ ..state, visible_days: state.visible_days + 1, })
      } else {
        state
      }
    DecreaseVisibleDays =>
      if state.visible_days > 5 {
        bump({ ..state, visible_days: state.visible_days - 1, })
      } else {
        state
      }
    IncreaseVisiblePeriods =>
      if state.visible_periods < 10 {
        bump({ ..state, visible_periods: state.visible_periods + 1, })
      } else {
        state
      }
    DecreaseVisiblePeriods =>
      if state.visible_periods > 6 {
        bump({ ..state, visible_periods: state.visible_periods - 1, })
      } else {
        state
      }
    DismissError => bump({ ..state, error: None, })
  }
}

///|
fn bump(state : PlannerState) -> PlannerState {
  { ..state, revision: state.revision + 1, }
}

///|
fn with_error(state : PlannerState, error : UiError) -> PlannerState {
  bump({ ..state, error: Some(error), })
}

///|
pub fn find_offering(
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
fn offering_occupies_term(
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
  for planner_term in PlannerTerm::values() {
    if offering_occupies_term(offering, planner_term) {
      for enrollment in state.enrollments {
        match find_offering(state.offerings, enrollment.offering_id) {
          Some(other) =>
            if offering_occupies_term(other, planner_term) {
              for slot in slots {
                for other_slot in other.slots() {
                  if slot == other_slot {
                    return Some(slot)
                  }
                }
              }
            }
          None => ()
        }
      }
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
  // A repeated UI action on an already-enrolled offering is a deliberate
  // no-op, not a duplicate-enrollment error.
  if has_enrollment(state.enrollments, id) {
    return state
  }
  if !offering_occupies_term(offering, state.selected_term) {
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
  let picker = match state.picker {
    Some(PickerTarget::Slot(..)) => None
    _ => state.picker
  }
  bump({ ..state, enrollments, selected_offering: None, picker, error: None, })
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
    return bump({ ..state, selected_offering: None, error: None, })
  }
  bump({ ..state, enrollments, selected_offering: None, error: None, })
}

///|
/// One scheduled course block in the selected term.
pub struct ScheduledBlock {
  offering_id : @tanikun-domain.OfferingId
  course_name : String
  day : @tanikun-domain.DayOfWeek
  period : @tanikun-domain.Period
}

///|
/// One offering shown in the catalogue for the selected term.
pub struct CatalogueEntry {
  offering_id : @tanikun-domain.OfferingId
  course_name : String
  credits : @tanikun-domain.Credits
  schedule : @tanikun-domain.OfferingSchedule
  slots : Array[@tanikun-domain.Slot]
  enrolled : Bool
}

///|
/// One intensive offering in the selected term's off-grid list.
pub struct OffGridEntry {
  offering_id : @tanikun-domain.OfferingId
  course_name : String
  credits : @tanikun-domain.Credits
}

///|
pub fn find_course(
  catalogue : Array[@tanikun-domain.Course],
  id : @tanikun-domain.CourseId,
) -> @tanikun-domain.Course? {
  for course in catalogue {
    if course.id == id {
      return Some(course)
    }
  }
  None
}

///|
pub fn PlannerState::catalogue_entries(
  self : PlannerState,
  term : PlannerTerm,
) -> Array[CatalogueEntry] {
  let entries : Array[CatalogueEntry] = []
  for offering in self.offerings {
    if offering_occupies_term(offering, term) &&
      offering.status == @tanikun-domain.OfferingStatus::Offered {
      match find_course(self.catalogue, offering.course_id) {
        Some(course) =>
          if self.catalogue_query.is_empty() ||
            course.name.contains(self.catalogue_query) {
            entries.push({
              offering_id: offering.id,
              course_name: course.name,
              credits: course.credits,
              schedule: offering.schedule(),
              slots: offering.slots(),
              enrolled: has_enrollment(self.enrollments, offering.id),
            })
          }
        None => ()
      }
    }
  }
  entries
}

///|
pub fn PlannerState::picker_entries(
  self : PlannerState,
) -> Array[CatalogueEntry] {
  let entries : Array[CatalogueEntry] = []
  let base = self.catalogue_entries(self.selected_term)
  for entry in base {
    let matches = match self.picker {
      Some(PickerTarget::Slot(day~, period~)) => {
        let mut found = false
        for slot in entry.slots {
          if slot.day == day && slot.period.value() == period {
            found = true
          }
        }
        found
      }
      Some(PickerTarget::Intensive) =>
        match entry.schedule {
          @tanikun-domain.OfferingSchedule::Intensive(_) => true
          _ => false
        }
      Some(PickerTarget::All) => true
      None => false
    }
    if matches {
      entries.push(entry)
    }
  }
  entries
}

///|
pub fn PlannerState::scheduled_blocks(
  self : PlannerState,
  term : PlannerTerm,
) -> Array[ScheduledBlock] {
  let blocks : Array[ScheduledBlock] = []
  for enrollment in self.enrollments {
    match find_offering(self.offerings, enrollment.offering_id) {
      Some(offering) =>
        if offering_occupies_term(offering, term) {
          match find_course(self.catalogue, offering.course_id) {
            Some(course) =>
              for slot in offering.slots() {
                blocks.push({
                  offering_id: offering.id,
                  course_name: course.name,
                  day: slot.day,
                  period: slot.period,
                })
              }
            None => ()
          }
        }
      None => ()
    }
  }
  blocks
}

///|
pub fn PlannerState::off_grid_entries(
  self : PlannerState,
  term : PlannerTerm,
) -> Array[OffGridEntry] {
  let entries : Array[OffGridEntry] = []
  for enrollment in self.enrollments {
    match find_offering(self.offerings, enrollment.offering_id) {
      Some(offering) =>
        if offering_occupies_term(offering, term) {
          match offering.schedule() {
            @tanikun-domain.OfferingSchedule::Intensive(_) =>
              match find_course(self.catalogue, offering.course_id) {
                Some(course) =>
                  entries.push({
                    offering_id: offering.id,
                    course_name: course.name,
                    credits: course.credits,
                  })
                None => ()
              }
            _ => ()
          }
        }
      None => ()
    }
  }
  entries
}

///|
pub fn PlannerState::visible_day_values(
  self : PlannerState,
) -> Array[@tanikun-domain.DayOfWeek] {
  let days = [
    @tanikun-domain.DayOfWeek::Monday,
    @tanikun-domain.DayOfWeek::Tuesday,
    @tanikun-domain.DayOfWeek::Wednesday,
    @tanikun-domain.DayOfWeek::Thursday,
    @tanikun-domain.DayOfWeek::Friday,
    @tanikun-domain.DayOfWeek::Saturday,
    @tanikun-domain.DayOfWeek::Sunday,
  ]
  let visible : Array[@tanikun-domain.DayOfWeek] = []
  for index in 0..<self.visible_days {
    visible.push(days[index])
  }
  visible
}

///|
pub fn PlannerState::visible_period_values(self : PlannerState) -> Array[Int] {
  let periods : Array[Int] = []
  for period in 1..<=self.visible_periods {
    periods.push(period)
  }
  periods
}

///|
pub fn PlannerState::is_visible_slot(
  self : PlannerState,
  day : @tanikun-domain.DayOfWeek,
  period : @tanikun-domain.Period,
) -> Bool {
  day_rank(day) < self.visible_days && period.value <= self.visible_periods
}

///|
fn day_rank(day : @tanikun-domain.DayOfWeek) -> Int {
  match day {
    @tanikun-domain.DayOfWeek::Monday => 0
    @tanikun-domain.DayOfWeek::Tuesday => 1
    @tanikun-domain.DayOfWeek::Wednesday => 2
    @tanikun-domain.DayOfWeek::Thursday => 3
    @tanikun-domain.DayOfWeek::Friday => 4
    @tanikun-domain.DayOfWeek::Saturday => 5
    @tanikun-domain.DayOfWeek::Sunday => 6
  }
}

///|
/// Counts scheduled blocks outside the current visible range.
pub fn PlannerState::hidden_scheduled_block_count(
  self : PlannerState,
  term : PlannerTerm,
) -> Int {
  let mut count = 0
  for block in self.scheduled_blocks(term) {
    if !self.is_visible_slot(block.day, block.period) {
      count = count + 1
    }
  }
  count
}
