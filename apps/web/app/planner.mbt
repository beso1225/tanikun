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
  MissingRequirementSet
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
/// One field in the custom course form.
pub(all) enum CustomCourseField {
  Name
  Credits
  Year
  Schedule
  Term
  Day
  Period
} derive(Eq)

///|
pub extend CustomCourseField with Eq::{not_equal, equal}

///|
/// The schedule shape selected in the custom course form.
pub(all) enum CustomCourseSchedule {
  Regular
  YearLong
  Intensive
} derive(Eq)

///|
pub extend CustomCourseSchedule with Eq::{not_equal, equal}

///|
/// Editable draft for a custom course and its first offering. The form keeps
/// strings so every field can be validated together on submit.
pub struct CustomCourseDraft {
  name : String
  credits : String
  academic_year : String
  schedule : CustomCourseSchedule
  term : String
  terms : Array[PlannerTerm]
  day : String
  period : String
  editing_course_id : @tanikun-domain.CourseId?
  editing_offering_id : @tanikun-domain.OfferingId?
  return_picker : PickerTarget?
  error_field : CustomCourseField?
  error_message : String
}

///|
/// A field in the override editor.
pub(all) enum OverrideField {
  Name
  Credits
  Slots
  General
} derive(Eq)

///|
pub extend OverrideField with Eq::{not_equal, equal}

///|
/// Editable override values for one offering. Empty text or an empty credit
/// selection removes that override; the master value is shown as the fallback.
pub struct OverrideDraft {
  offering_id : @tanikun-domain.OfferingId
  course_id : @tanikun-domain.CourseId
  name : String
  credits : String
  slots_enabled : Bool
  supports_slots : Bool
  day : @tanikun-domain.DayOfWeek
  period : @tanikun-domain.Period
  error_field : OverrideField?
  error_message : String
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
  requirement_sets : @tanikun-requirements.RequirementSets[
    @tanikun-requirements.Rule,
  ]
  selected_term : PlannerTerm
  selected_offering : @tanikun-domain.OfferingId?
  error : UiError?
  catalogue_query : String
  picker : PickerTarget?
  settings_open : Bool
  override_form : OverrideDraft?
  custom_form : CustomCourseDraft?
  custom_course_ids : Array[@tanikun-domain.CourseId]
  next_custom_course_number : Int
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
    requirement_sets,
    selected_term: S1,
    selected_offering: None,
    error: None,
    catalogue_query: "",
    picker: None,
    settings_open: false,
    override_form: None,
    custom_form: None,
    custom_course_ids: [],
    next_custom_course_number: 1,
    visible_days: 5,
    visible_periods: 6,
    revision: 0,
  }
}

///|
/// Derived credit totals for the planner header. This is never stored in
/// `PlannerState`; it rebuilds the pure evaluation input on demand. The
/// projected value uses the optimistic projection so planned enrollments count.
pub struct PlannerCreditTotals {
  confirmed : @tanikun-domain.Credits
  standard : @tanikun-domain.Credits
  projected : @tanikun-domain.Credits
}

///|
pub fn PlannerState::credit_totals(
  self : PlannerState,
) -> Result[PlannerCreditTotals, @tanikun-domain.DomainError] {
  let input = match self.evaluation_input() {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  match @tanikun-requirements.credit_summary(input) {
    Ok(projection) =>
      Ok({
        confirmed: projection.confirmed.total,
        standard: projection.standard.total,
        projected: projection.optimistic.total,
      })
    Err(error) => Err(error)
  }
}

///|
/// A one-line requirement result for the selected profile.
pub struct RequirementSummary {
  satisfaction : @tanikun-requirements.Satisfaction
}

///|
pub fn RequirementSummary::label(self : RequirementSummary) -> String {
  match self.satisfaction {
    @tanikun-requirements.Satisfaction::Satisfied => "充足"
    @tanikun-requirements.Satisfaction::Partial => "部分充足"
    @tanikun-requirements.Satisfaction::Unsatisfied => "未充足"
  }
}

///|
/// Looks up the active requirement set from the profile and the available sets.
pub fn PlannerState::active_requirement_set(
  self : PlannerState,
) -> @tanikun-requirements.RequirementSet[@tanikun-requirements.Rule]? {
  self.requirement_sets.lookup_for_profile(self.profile)
}

///|
fn PlannerState::evaluation_input(
  self : PlannerState,
) -> Result[
  @tanikun-requirements.EvaluationInput[@tanikun-requirements.Rule],
  @tanikun-domain.DomainError,
] {
  let requirement_set = match self.active_requirement_set() {
    Some(value) => value
    None =>
      return Err(@tanikun-domain.DomainError::ProfileRequirementSetMismatch)
  }
  Ok(
    @tanikun-requirements.EvaluationInput::new(
      self.profile,
      requirement_set,
      self.catalogue,
      self.offerings,
      self.enrollments,
      self.overrides,
    ),
  )
}

///|
/// Evaluates the current planner state against the active requirement set.
pub fn PlannerState::requirement_summary(
  self : PlannerState,
) -> Result[RequirementSummary, @tanikun-domain.DomainError] {
  let input = match self.evaluation_input() {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  match @tanikun-requirements.evaluate(input) {
    Ok(evaluation) =>
      Ok({ satisfaction: evaluation.requirements.optimistic.satisfaction, })
    Err(error) => Err(error)
  }
}

///|
/// Available program IDs, in requirement-set order.
pub fn PlannerState::program_ids(
  self : PlannerState,
) -> Array[@tanikun-domain.ProgramId] {
  let programs : Array[@tanikun-domain.ProgramId] = []
  for key in self.requirement_sets.keys() {
    let mut seen = false
    for program in programs {
      if program == key.program_id {
        seen = true
      }
    }
    if !seen {
      programs.push(key.program_id)
    }
  }
  let mut current_seen = false
  for program in programs {
    if program == self.profile.program_id {
      current_seen = true
    }
  }
  if !current_seen {
    programs.push(self.profile.program_id)
  }
  programs
}

///|
/// Available advancement years for a program, in requirement-set order.
pub fn PlannerState::advancement_years(
  self : PlannerState,
  program_id : @tanikun-domain.ProgramId,
) -> Array[@tanikun-domain.AcademicYear] {
  let years : Array[@tanikun-domain.AcademicYear] = []
  for key in self.requirement_sets.keys() {
    if key.program_id == program_id {
      let mut seen = false
      for year in years {
        if year == key.advancement_year {
          seen = true
        }
      }
      if !seen {
        years.push(key.advancement_year)
      }
    }
  }
  if self.profile.program_id == program_id {
    let mut seen = false
    for year in years {
      if year == self.profile.advancement_year {
        seen = true
      }
    }
    if !seen {
      years.push(self.profile.advancement_year)
    }
  }
  years
}

///|
/// A status the user can apply to an existing enrollment.
pub(all) enum EnrollmentStatusTarget {
  Planned
  InProgress
  Passed(grade~ : @tanikun-domain.PassingGrade)
  Failed(grade~ : @tanikun-domain.FailingGrade)
  NotTaken
}

///|
/// Returns the enrollment for an offering, if it is enrolled.
pub fn PlannerState::enrollment_for(
  self : PlannerState,
  offering_id : @tanikun-domain.OfferingId,
) -> @tanikun-domain.Enrollment? {
  find_enrollment(self.enrollments, offering_id)
}

///|
/// Returns the current status for an offering, if it is enrolled.
pub fn PlannerState::enrollment_status(
  self : PlannerState,
  offering_id : @tanikun-domain.OfferingId,
) -> @tanikun-domain.EnrollmentStatus? {
  for enrollment in self.enrollments {
    if enrollment.offering_id == offering_id {
      return Some(enrollment.status)
    }
  }
  None
}

///|
/// Whether this course was created in the user namespace.
pub fn PlannerState::is_custom_course(
  self : PlannerState,
  course_id : @tanikun-domain.CourseId,
) -> Bool {
  for id in self.custom_course_ids {
    if id == course_id {
      return true
    }
  }
  false
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
  UpdateEnrollmentStatus(
    offering_id~ : @tanikun-domain.OfferingId,
    target~ : EnrollmentStatusTarget
  )
  SelectProgram(program_id~ : String)
  SelectAdvancementYear(year~ : String)
  OpenSettings
  CloseSettings
  OpenOverrideEditor(offering_id~ : @tanikun-domain.OfferingId)
  CloseOverrideEditor
  UpdateOverrideField(field~ : OverrideField, value~ : String)
  UpdateOverrideDay(value~ : String)
  UpdateOverridePeriod(value~ : String)
  ToggleOverrideSlots
  RemoveAllOverrides
  SubmitOverride
  OpenCustomCourseForm
  CloseCustomCourseForm
  UpdateCustomCourseField(field~ : CustomCourseField, value~ : String)
  ToggleCustomTerm(term~ : PlannerTerm)
  OpenEditCustomCourse(offering_id~ : @tanikun-domain.OfferingId)
  DeleteCustomCourse(course_id~ : @tanikun-domain.CourseId)
  SubmitCustomCourse
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
    UpdateEnrollmentStatus(offering_id~, target~) =>
      update_enrollment_status(state, offering_id, target)
    SelectProgram(program_id~) => select_program(state, program_id)
    SelectAdvancementYear(year~) => select_advancement_year(state, year)
    OpenSettings =>
      bump({
        ..state,
        settings_open: true,
        picker: None,
        selected_offering: None,
        override_form: None,
        custom_form: None,
        error: None,
      })
    CloseSettings => bump({ ..state, settings_open: false, error: None, })
    OpenOverrideEditor(offering_id~) => open_override_editor(state, offering_id)
    CloseOverrideEditor =>
      match state.override_form {
        Some(form) =>
          bump({
            ..state,
            override_form: None,
            selected_offering: Some(form.offering_id),
            error: None,
          })
        None => state
      }
    UpdateOverrideField(field~, value~) =>
      update_override_field(state, field, value)
    UpdateOverrideDay(value~) => update_override_day(state, value)
    UpdateOverridePeriod(value~) => update_override_period(state, value)
    ToggleOverrideSlots => toggle_override_slots(state)
    RemoveAllOverrides => remove_all_overrides(state)
    SubmitOverride => submit_override(state)
    OpenCustomCourseForm =>
      bump({
        ..state,
        custom_form: Some(new_custom_course_draft(state)),
        picker: None,
        selected_offering: None,
        override_form: None,
        error: None,
      })
    CloseCustomCourseForm => {
      let picker = match state.custom_form {
        Some(form) => form.return_picker
        None => None
      }
      bump({ ..state, custom_form: None, picker, error: None, })
    }
    UpdateCustomCourseField(field~, value~) =>
      update_custom_course_field(state, field, value)
    ToggleCustomTerm(term~) => toggle_custom_term(state, term)
    OpenEditCustomCourse(offering_id~) =>
      open_edit_custom_course(state, offering_id)
    DeleteCustomCourse(course_id~) => delete_custom_course(state, course_id)
    SubmitCustomCourse => submit_custom_course(state)
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
fn find_slot_conflict_with_overrides(
  state : PlannerState,
  offering : @tanikun-domain.CourseOffering,
  overrides : @tanikun-domain.Overrides,
  excluded_offering : @tanikun-domain.OfferingId?,
) -> @tanikun-domain.Slot? {
  let slots = effective_slots_or(offering, overrides)
  for planner_term in PlannerTerm::values() {
    if offering_occupies_term(offering, planner_term) {
      for enrollment in state.enrollments {
        let excluded = match excluded_offering {
          Some(id) => enrollment.offering_id == id
          None => false
        }
        if !excluded {
          match find_offering(state.offerings, enrollment.offering_id) {
            Some(other) =>
              if offering_occupies_term(other, planner_term) {
                for slot in slots {
                  for other_slot in effective_slots_or(other, overrides) {
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
  }
  None
}

///|
fn find_slot_conflict(
  state : PlannerState,
  offering : @tanikun-domain.CourseOffering,
) -> @tanikun-domain.Slot? {
  find_slot_conflict_with_overrides(state, offering, state.overrides, None)
}

///|
fn update_enrollment_status(
  state : PlannerState,
  id : @tanikun-domain.OfferingId,
  target : EnrollmentStatusTarget,
) -> PlannerState {
  let current = state.enrollment_status(id)
  if current is None {
    return with_error(
      state,
      UiError::new(
        UiErrorTarget::Offering(offering_id=id),
        UiErrorKind::UnknownEnrollment,
        "履修が見つかりません",
      ),
    )
  }
  let offering = match find_offering(state.offerings, id) {
    Some(offering) => offering
    None =>
      return with_error(
        state,
        TimetableError::UnknownOffering(offering_id=id).to_ui(),
      )
  }
  let course = match find_course(state.catalogue, offering.course_id) {
    Some(course) => course
    None =>
      return with_error(
        state,
        UiError::new(
          UiErrorTarget::Course(course_id=offering.course_id),
          UiErrorKind::DomainValidation,
          "科目が見つかりません",
        ),
      )
  }
  let status = match target {
    Planned => @tanikun-domain.EnrollmentStatus::Planned
    InProgress => @tanikun-domain.EnrollmentStatus::InProgress
    NotTaken =>
      @tanikun-domain.EnrollmentStatus::Confirmed(
        @tanikun-domain.ConfirmedGrade::NotTaken,
      )
    Failed(grade~) =>
      @tanikun-domain.EnrollmentStatus::Confirmed(
        @tanikun-domain.ConfirmedGrade::Failed(grade~),
      )
    Passed(grade~) => {
      let snapshot = match current {
        Some(
          @tanikun-domain.EnrollmentStatus::Confirmed(
            @tanikun-domain.ConfirmedGrade::Passed(snapshot~, ..)
          )
        ) => snapshot
        _ =>
          match
            @tanikun-domain.PassedCourseSnapshot::from_course(
              course,
              state.overrides,
            ) {
            Ok(snapshot) => snapshot
            Err(error) =>
              return with_error(
                state,
                UiError::from_domain(
                  error,
                  UiErrorTarget::Offering(offering_id=id),
                ),
              )
          }
      }
      @tanikun-domain.EnrollmentStatus::Confirmed(
        @tanikun-domain.ConfirmedGrade::Passed(grade~, snapshot~),
      )
    }
  }
  let enrollments : Array[@tanikun-domain.Enrollment] = []
  for enrollment in state.enrollments {
    if enrollment.offering_id == id {
      enrollments.push(@tanikun-domain.Enrollment::new(id, status))
    } else {
      enrollments.push(enrollment)
    }
  }
  bump({ ..state, enrollments, error: None, })
}

///|
fn find_enrollment(
  enrollments : Array[@tanikun-domain.Enrollment],
  id : @tanikun-domain.OfferingId,
) -> @tanikun-domain.Enrollment? {
  for enrollment in enrollments {
    if enrollment.offering_id == id {
      return Some(enrollment)
    }
  }
  None
}

///|
fn effective_slots_or(
  offering : @tanikun-domain.CourseOffering,
  overrides : @tanikun-domain.Overrides,
) -> Array[@tanikun-domain.Slot] {
  match @tanikun-domain.effective_slots(offering, overrides) {
    Ok(slots) => slots
    Err(_) => offering.slots()
  }
}

///|
fn override_supports_slots(offering : @tanikun-domain.CourseOffering) -> Bool {
  match offering.schedule() {
    @tanikun-domain.OfferingSchedule::Intensive(_) => false
    _ => true
  }
}

///|
fn default_override_slot(
  offering : @tanikun-domain.CourseOffering,
) -> (String, String) {
  let slots = offering.slots()
  if slots.is_empty() {
    ("1", "4")
  } else {
    (custom_day_value(slots[0].day), "\{slots[0].period.value()}")
  }
}

///|
fn open_override_editor(
  state : PlannerState,
  offering_id : @tanikun-domain.OfferingId,
) -> PlannerState {
  let offering = match find_offering(state.offerings, offering_id) {
    Some(value) => value
    None =>
      return with_error(
        state,
        TimetableError::UnknownOffering(offering_id~).to_ui(),
      )
  }
  let course = match find_course(state.catalogue, offering.course_id) {
    Some(value) => value
    None =>
      return with_error(
        state,
        UiError::new(
          UiErrorTarget::Course(course_id=offering.course_id),
          UiErrorKind::DomainValidation,
          "科目が見つかりません",
        ),
      )
  }
  let name = match
    state.overrides.find(
      @tanikun-domain.OverrideTarget::Course(course.id),
      @tanikun-domain.OverrideAttribute::DisplayName,
    ) {
    Some(entry) =>
      match entry.text() {
        Some(value) => value
        None => ""
      }
    None => ""
  }
  let credits = match
    state.overrides.find(
      @tanikun-domain.OverrideTarget::Course(course.id),
      @tanikun-domain.OverrideAttribute::Credits,
    ) {
    Some(entry) =>
      match entry.credits() {
        Some(value) => "\{value.half_units()}"
        None => ""
      }
    None => ""
  }
  let (default_day, default_period) = default_override_slot(offering)
  let default_day = match custom_day(default_day) {
    Some(value) => value
    None => @tanikun-domain.DayOfWeek::Monday
  }
  let default_period = match option_int(default_period, 1, 10) {
    Some(value) =>
      match @tanikun-domain.Period::new(value) {
        Ok(period) => period
        Err(_) =>
          return with_error(
            state,
            UiError::new(
              UiErrorTarget::Offering(offering_id=offering.id),
              UiErrorKind::DomainValidation,
              "時限が正しくありません",
            ),
          )
      }
    None =>
      return with_error(
        state,
        UiError::new(
          UiErrorTarget::Offering(offering_id=offering.id),
          UiErrorKind::DomainValidation,
          "時限が正しくありません",
        ),
      )
  }
  let (slots_enabled, day, period) = match
    state.overrides.find(
      @tanikun-domain.OverrideTarget::Offering(offering.id),
      @tanikun-domain.OverrideAttribute::Slots,
    ) {
    Some(entry) =>
      match entry.slots() {
        Some(slots) =>
          if slots.is_empty() {
            (false, default_day, default_period)
          } else {
            (true, slots[0].day, slots[0].period)
          }
        None => (false, default_day, default_period)
      }
    None => (false, default_day, default_period)
  }
  let form : OverrideDraft = {
    offering_id: offering.id,
    course_id: course.id,
    name,
    credits,
    slots_enabled,
    supports_slots: override_supports_slots(offering),
    day,
    period,
    error_field: None,
    error_message: "",
  }
  bump({
    ..state,
    override_form: Some(form),
    selected_offering: None,
    picker: None,
    custom_form: None,
    settings_open: false,
    error: None,
  })
}

///|
fn update_override_field(
  state : PlannerState,
  field : OverrideField,
  value : String,
) -> PlannerState {
  match state.override_form {
    None => state
    Some(form) => {
      let next = match field {
        Name => { ..form, name: value, }
        Credits => { ..form, credits: value, }
        _ => form
      }
      bump({
        ..state,
        override_form: Some({ ..next, error_field: None, error_message: "", }),
        error: None,
      })
    }
  }
}

///|
fn update_override_day(state : PlannerState, value : String) -> PlannerState {
  let day = match custom_day(value) {
    Some(value) => value
    None => return state
  }
  match state.override_form {
    None => state
    Some(form) =>
      bump({
        ..state,
        override_form: Some({
          ..form,
          day,
          error_field: None,
          error_message: "",
        }),
        error: None,
      })
  }
}

///|
fn update_override_period(state : PlannerState, value : String) -> PlannerState {
  let period = match option_int(value, 1, 10) {
    Some(value) => value
    None => return state
  }
  let period = match @tanikun-domain.Period::new(period) {
    Ok(value) => value
    Err(_) => return state
  }
  match state.override_form {
    None => state
    Some(form) =>
      bump({
        ..state,
        override_form: Some({
          ..form,
          period,
          error_field: None,
          error_message: "",
        }),
        error: None,
      })
  }
}

///|
fn toggle_override_slots(state : PlannerState) -> PlannerState {
  match state.override_form {
    None => state
    Some(form) =>
      if !form.supports_slots {
        state
      } else {
        bump({
          ..state,
          override_form: Some({
            ..form,
            slots_enabled: !form.slots_enabled,
            error_field: None,
            error_message: "",
          }),
          error: None,
        })
      }
  }
}

///|
fn override_form_error(
  state : PlannerState,
  form : OverrideDraft,
  field : OverrideField,
  message : String,
) -> PlannerState {
  bump({
    ..state,
    override_form: Some({
      ..form,
      error_field: Some(field),
      error_message: message,
    }),
  })
}

///|
fn override_entry_kept(
  entry : @tanikun-domain.Override,
  form : OverrideDraft,
) -> Bool {
  match entry.target {
    @tanikun-domain.OverrideTarget::Course(course_id) =>
      if course_id == form.course_id {
        match entry.attribute {
          @tanikun-domain.OverrideAttribute::DisplayName => false
          @tanikun-domain.OverrideAttribute::Credits => false
          @tanikun-domain.OverrideAttribute::Slots => true
        }
      } else {
        true
      }
    @tanikun-domain.OverrideTarget::Offering(offering_id) =>
      if offering_id == form.offering_id {
        match entry.attribute {
          @tanikun-domain.OverrideAttribute::Slots => false
          _ => true
        }
      } else {
        true
      }
  }
}

///|
fn remove_all_overrides(state : PlannerState) -> PlannerState {
  match state.override_form {
    None => state
    Some(form) => {
      let entries : Array[@tanikun-domain.Override] = []
      for entry in state.overrides.entries() {
        if override_entry_kept(entry, form) {
          entries.push(entry)
        }
      }
      let overrides = match @tanikun-domain.Overrides::new(entries) {
        Ok(value) => value
        Err(error) =>
          return override_form_error(
            state,
            form,
            General,
            UiError::from_domain(
              error,
              UiErrorTarget::Offering(offering_id=form.offering_id),
            ).message,
          )
      }
      bump({
        ..state,
        overrides,
        override_form: None,
        selected_offering: Some(form.offering_id),
        error: None,
      })
    }
  }
}

///|
fn submit_override(state : PlannerState) -> PlannerState {
  let form = match state.override_form {
    Some(value) => value
    None => return state
  }
  let offering = match find_offering(state.offerings, form.offering_id) {
    Some(value) => value
    None =>
      return override_form_error(
        state,
        form,
        General,
        "開講が見つかりません",
      )
  }
  let entries : Array[@tanikun-domain.Override] = []
  for entry in state.overrides.entries() {
    if override_entry_kept(entry, form) {
      entries.push(entry)
    }
  }
  if !form.name.is_empty() {
    match
      @tanikun-domain.Override::new(
        @tanikun-domain.OverrideTarget::Course(form.course_id),
        @tanikun-domain.OverrideAttribute::DisplayName,
        @tanikun-domain.OverrideValue::Text(form.name),
      ) {
      Ok(value) => entries.push(value)
      Err(error) =>
        return override_form_error(
          state,
          form,
          Name,
          UiError::from_domain(
            error,
            UiErrorTarget::Course(course_id=form.course_id),
          ).message,
        )
    }
  }
  if !form.credits.is_empty() {
    let half_units = match option_int(form.credits, 1, 20) {
      Some(value) => value
      None =>
        return override_form_error(
          state,
          form,
          Credits,
          "単位数が正しくありません",
        )
    }
    let credits = match @tanikun-domain.Credits::new(half_units) {
      Ok(value) => value
      Err(_) =>
        return override_form_error(
          state,
          form,
          Credits,
          "単位数が正しくありません",
        )
    }
    match
      @tanikun-domain.Override::new(
        @tanikun-domain.OverrideTarget::Course(form.course_id),
        @tanikun-domain.OverrideAttribute::Credits,
        @tanikun-domain.OverrideValue::Credits(credits),
      ) {
      Ok(value) => entries.push(value)
      Err(error) =>
        return override_form_error(
          state,
          form,
          Credits,
          UiError::from_domain(
            error,
            UiErrorTarget::Course(course_id=form.course_id),
          ).message,
        )
    }
  }
  if form.slots_enabled {
    if !form.supports_slots {
      return override_form_error(
        state,
        form,
        Slots,
        "この開講では曜限を変更できません",
      )
    }
    let day = form.day
    let period = form.period
    match
      @tanikun-domain.Override::new(
        @tanikun-domain.OverrideTarget::Offering(form.offering_id),
        @tanikun-domain.OverrideAttribute::Slots,
        @tanikun-domain.OverrideValue::Slots([
          @tanikun-domain.Slot::new(day, period),
        ]),
      ) {
      Ok(value) => entries.push(value)
      Err(error) =>
        return override_form_error(
          state,
          form,
          Slots,
          UiError::from_domain(
            error,
            UiErrorTarget::Offering(offering_id=form.offering_id),
          ).message,
        )
    }
  }
  let overrides = match @tanikun-domain.Overrides::new(entries) {
    Ok(value) => value
    Err(error) =>
      return override_form_error(
        state,
        form,
        General,
        UiError::from_domain(
          error,
          UiErrorTarget::Offering(offering_id=form.offering_id),
        ).message,
      )
  }
  match @tanikun-domain.effective_slots(offering, overrides) {
    Ok(_) => ()
    Err(error) =>
      return override_form_error(
        state,
        form,
        Slots,
        UiError::from_domain(
          error,
          UiErrorTarget::Offering(offering_id=form.offering_id),
        ).message,
      )
  }
  if has_enrollment(state.enrollments, form.offering_id) {
    match
      find_slot_conflict_with_overrides(
        state,
        offering,
        overrides,
        Some(form.offering_id),
      ) {
      Some(_) =>
        return override_form_error(
          state,
          form,
          Slots,
          "他の履修と曜限が重複しています",
        )
      None => ()
    }
  }
  bump({
    ..state,
    overrides,
    override_form: None,
    selected_offering: Some(form.offering_id),
    error: None,
  })
}

///|
fn apply_profile(
  state : PlannerState,
  profile : @tanikun-domain.AcademicProfile,
) -> PlannerState {
  let error = match state.requirement_sets.lookup_for_profile(profile) {
    Some(_) => None
    None =>
      Some(
        UiError::new(
          UiErrorTarget::General,
          UiErrorKind::MissingRequirementSet,
          "選択したプロファイルの要件セットがありません",
        ),
      )
  }
  bump({ ..state, profile, error, })
}

///|
fn has_year(
  years : Array[@tanikun-domain.AcademicYear],
  year : @tanikun-domain.AcademicYear,
) -> Bool {
  for candidate in years {
    if candidate == year {
      return true
    }
  }
  false
}

///|
fn select_program(state : PlannerState, value : String) -> PlannerState {
  let program = match @tanikun-domain.ProgramId::new(value) {
    Ok(value) => value
    Err(_) =>
      return with_error(
        state,
        UiError::new(
          UiErrorTarget::General,
          UiErrorKind::General,
          "プログラムが正しくありません",
        ),
      )
  }
  let years = state.advancement_years(program)
  if years.is_empty() {
    return with_error(
      state,
      UiError::new(
        UiErrorTarget::General,
        UiErrorKind::MissingRequirementSet,
        "このプログラムの要件セットがありません",
      ),
    )
  }
  let year = if has_year(years, state.profile.advancement_year) {
    state.profile.advancement_year
  } else {
    years[0]
  }
  apply_profile(state, @tanikun-domain.AcademicProfile::new(program, year))
}

///|
fn select_advancement_year(state : PlannerState, year : String) -> PlannerState {
  let year = match option_int(year, 2000, 2100) {
    Some(value) => value
    None =>
      return with_error(
        state,
        UiError::new(
          UiErrorTarget::General,
          UiErrorKind::General,
          "年度が正しくありません",
        ),
      )
  }
  let advancement_year = match @tanikun-domain.AcademicYear::new(year) {
    Ok(value) => value
    Err(_) =>
      return with_error(
        state,
        UiError::new(
          UiErrorTarget::General,
          UiErrorKind::General,
          "年度が正しくありません",
        ),
      )
  }
  apply_profile(
    state,
    @tanikun-domain.AcademicProfile::new(
      state.profile.program_id,
      advancement_year,
    ),
  )
}

///|
fn new_custom_course_draft(state : PlannerState) -> CustomCourseDraft {
  let year = state.profile.advancement_year.year()
  let term = match state.selected_term.term() {
    Some(value) => value
    None => @tanikun-domain.Term::S1
  }
  let term_label = match term {
    @tanikun-domain.Term::S1 => "S1"
    @tanikun-domain.Term::S2 => "S2"
    @tanikun-domain.Term::A1 => "A1"
    @tanikun-domain.Term::A2 => "A2"
  }
  let base : CustomCourseDraft = {
    name: "",
    credits: "4",
    academic_year: "\{year}",
    schedule: CustomCourseSchedule::Regular,
    term: term_label,
    terms: [planner_term_for_regular(term)],
    day: "1",
    period: "4",
    editing_course_id: None,
    editing_offering_id: None,
    return_picker: state.picker,
    error_field: None,
    error_message: "",
  }
  match state.picker {
    Some(PickerTarget::Slot(day~, period~)) =>
      { ..base, day: custom_day_value(day), period: "\{period}", }
    Some(PickerTarget::Intensive) =>
      {
        ..base,
        schedule: CustomCourseSchedule::Intensive,
        term: custom_semester_value(state.selected_term.semester()),
        terms: [],
      }
    Some(PickerTarget::All) =>
      if state.selected_term == W {
        {
          ..base,
          schedule: CustomCourseSchedule::Intensive,
          term: "W",
          terms: [],
        }
      } else {
        base
      }
    None => base
  }
}

///|
fn update_custom_course_field(
  state : PlannerState,
  field : CustomCourseField,
  value : String,
) -> PlannerState {
  match state.custom_form {
    None => state
    Some(form) => {
      let next = match field {
        Name => { ..form, name: value, }
        Credits => { ..form, credits: value, }
        Year => { ..form, academic_year: value, }
        Schedule => {
          let schedule = match value {
            "year-long" => CustomCourseSchedule::YearLong
            "intensive" => CustomCourseSchedule::Intensive
            _ => CustomCourseSchedule::Regular
          }
          {
            ..form,
            schedule,
            term: if schedule == CustomCourseSchedule::Intensive {
              "S"
            } else {
              "S1"
            },
          }
        }
        Term => { ..form, term: value, }
        Day => { ..form, day: value, }
        Period => { ..form, period: value, }
      }
      bump({
        ..state,
        custom_form: Some({ ..next, error_field: None, error_message: "", }),
        error: None,
      })
    }
  }
}

///|
fn custom_course_error(
  state : PlannerState,
  form : CustomCourseDraft,
  field : CustomCourseField,
  message : String,
) -> PlannerState {
  bump({
    ..state,
    custom_form: Some({
      ..form,
      error_field: Some(field),
      error_message: message,
    }),
  })
}

///|
fn option_int(value : String, min : Int, max : Int) -> Int? {
  let mut current = min
  while current <= max {
    if value == "\{current}" {
      return Some(current)
    }
    current += 1
  }
  None
}

///|
fn custom_day(value : String) -> @tanikun-domain.DayOfWeek? {
  match option_int(value, 0, 6) {
    Some(0) => Some(@tanikun-domain.DayOfWeek::Monday)
    Some(1) => Some(@tanikun-domain.DayOfWeek::Tuesday)
    Some(2) => Some(@tanikun-domain.DayOfWeek::Wednesday)
    Some(3) => Some(@tanikun-domain.DayOfWeek::Thursday)
    Some(4) => Some(@tanikun-domain.DayOfWeek::Friday)
    Some(5) => Some(@tanikun-domain.DayOfWeek::Saturday)
    Some(6) => Some(@tanikun-domain.DayOfWeek::Sunday)
    _ => None
  }
}

///|
fn custom_semester(value : String) -> @tanikun-domain.Semester? {
  match value {
    "S" => Some(@tanikun-domain.Semester::S)
    "A" => Some(@tanikun-domain.Semester::A)
    "W" => Some(@tanikun-domain.Semester::W)
    _ => None
  }
}

///|
fn planner_term_for_regular(term : @tanikun-domain.Term) -> PlannerTerm {
  match term {
    @tanikun-domain.Term::S1 => S1
    @tanikun-domain.Term::S2 => S2
    @tanikun-domain.Term::A1 => A1
    @tanikun-domain.Term::A2 => A2
  }
}

///|
fn planner_term_for_semester(
  semester : @tanikun-domain.Semester,
) -> PlannerTerm {
  match semester {
    @tanikun-domain.Semester::S => S1
    @tanikun-domain.Semester::A => A1
    @tanikun-domain.Semester::W => W
  }
}

///|
fn submit_custom_course(state : PlannerState) -> PlannerState {
  let form = match state.custom_form {
    Some(form) => form
    None => return state
  }
  let credits_half_units = match option_int(form.credits, 1, 20) {
    Some(value) => value
    None =>
      return custom_course_error(
        state,
        form,
        Credits,
        "単位数が正しくありません",
      )
  }
  let credits = match @tanikun-domain.Credits::new(credits_half_units) {
    Ok(credits) => credits
    Err(_) =>
      return custom_course_error(
        state,
        form,
        Credits,
        "単位数が正しくありません",
      )
  }
  let year = match option_int(form.academic_year, 2000, 2100) {
    Some(year) => year
    None =>
      return custom_course_error(
        state,
        form,
        Year,
        "年度が正しくありません",
      )
  }
  let academic_year = match @tanikun-domain.AcademicYear::new(year) {
    Ok(value) => value
    Err(_) =>
      return custom_course_error(
        state,
        form,
        Year,
        "年度が正しくありません",
      )
  }
  let editing = form.editing_course_id is Some(_)
  let course_id = match form.editing_course_id {
    Some(id) => id
    None =>
      match
        @tanikun-domain.CourseId::new(
          "user",
          "course-\{state.next_custom_course_number}",
        ) {
        Ok(id) => id
        Err(_) =>
          return custom_course_error(
            state,
            form,
            Name,
            "科目IDを作成できません",
          )
      }
  }
  let offering_id = match form.editing_offering_id {
    Some(id) => id
    None =>
      match
        @tanikun-domain.OfferingId::new(
          "user-offering-\{state.next_custom_course_number}",
        ) {
        Ok(id) => id
        Err(_) =>
          return custom_course_error(
            state,
            form,
            Schedule,
            "開講IDを作成できません",
          )
      }
  }
  if editing && !state.is_custom_course(course_id) {
    return custom_course_error(
      state,
      form,
      Schedule,
      "独自科目ではありません",
    )
  }
  if editing && find_offering(state.offerings, offering_id) is None {
    return custom_course_error(
      state,
      form,
      Schedule,
      "開講が見つかりません",
    )
  }
  let course = match
    @tanikun-domain.Course::new(
      course_id,
      form.name,
      credits,
      @tanikun-domain.CourseStatus::Active,
    ) {
    Ok(value) => value
    Err(_) =>
      return custom_course_error(
        state,
        form,
        Name,
        "科目名を入力してください",
      )
  }
  let regular_terms : Array[@tanikun-domain.Term] = []
  for item in form.terms {
    match item {
      S1 => regular_terms.push(@tanikun-domain.Term::S1)
      S2 => regular_terms.push(@tanikun-domain.Term::S2)
      A1 => regular_terms.push(@tanikun-domain.Term::A1)
      A2 => regular_terms.push(@tanikun-domain.Term::A2)
      W => ()
    }
  }
  let schedule = if form.schedule == CustomCourseSchedule::Intensive {
    let semester = match custom_semester(form.term) {
      Some(value) => value
      None =>
        return custom_course_error(
          state,
          form,
          Term,
          "セメスターを選択してください",
        )
    }
    @tanikun-domain.OfferingSchedule::Intensive(semester~)
  } else if form.schedule == CustomCourseSchedule::YearLong {
    @tanikun-domain.OfferingSchedule::YearLong
  } else {
    if regular_terms.is_empty() {
      return custom_course_error(
        state,
        form,
        Term,
        "学期を選択してください",
      )
    }
    let semester = regular_terms[0].semester()
    for term in regular_terms {
      if term.semester() != semester {
        return custom_course_error(
          state,
          form,
          Term,
          "同じセメスターの学期を選んでください",
        )
      }
    }
    @tanikun-domain.OfferingSchedule::Regular(terms=regular_terms)
  }
  let slots = if form.schedule == CustomCourseSchedule::Intensive {
    []
  } else {
    let day = match custom_day(form.day) {
      Some(value) => value
      None =>
        return custom_course_error(
          state,
          form,
          Day,
          "曜日を選択してください",
        )
    }
    let period = match option_int(form.period, 1, 10) {
      Some(value) => value
      None =>
        return custom_course_error(
          state,
          form,
          Period,
          "時限を選択してください",
        )
    }
    let period = match @tanikun-domain.Period::new(period) {
      Ok(value) => value
      Err(_) =>
        return custom_course_error(
          state,
          form,
          Period,
          "時限を選択してください",
        )
    }
    [@tanikun-domain.Slot::new(day, period)]
  }
  let offering = match
    @tanikun-domain.CourseOffering::new(
      offering_id,
      course.id,
      academic_year,
      schedule,
      @tanikun-domain.OfferingStatus::Offered,
      slots,
    ) {
    Ok(value) => value
    Err(_) =>
      return custom_course_error(
        state,
        form,
        Schedule,
        "開講情報が正しくありません",
      )
  }
  if editing && has_enrollment(state.enrollments, offering_id) {
    match find_slot_conflict_excluding(state, offering, offering_id) {
      Some(_) =>
        return custom_course_error(
          state,
          form,
          Schedule,
          "他の履修と曜限が重複しています",
        )
      None => ()
    }
  }
  let selected_term = match offering.schedule() {
    @tanikun-domain.OfferingSchedule::Regular(terms~) =>
      planner_term_for_regular(terms[0])
    @tanikun-domain.OfferingSchedule::YearLong =>
      if state.selected_term == W {
        S1
      } else {
        state.selected_term
      }
    @tanikun-domain.OfferingSchedule::Intensive(semester~) =>
      planner_term_for_semester(semester)
  }
  let catalogue : Array[@tanikun-domain.Course] = []
  let offerings : Array[@tanikun-domain.CourseOffering] = []
  let custom_course_ids = state.custom_course_ids.copy()
  if editing {
    for item in state.catalogue {
      if item.id == course_id {
        catalogue.push(course)
      } else {
        catalogue.push(item)
      }
    }
    for item in state.offerings {
      if item.id == offering_id {
        offerings.push(offering)
      } else {
        offerings.push(item)
      }
    }
  } else {
    for item in state.catalogue {
      catalogue.push(item)
    }
    catalogue.push(course)
    for item in state.offerings {
      offerings.push(item)
    }
    offerings.push(offering)
    custom_course_ids.push(course.id)
  }
  bump({
    ..state,
    catalogue,
    offerings,
    selected_term,
    selected_offering: None,
    custom_form: None,
    custom_course_ids,
    next_custom_course_number: if editing {
      state.next_custom_course_number
    } else {
      state.next_custom_course_number + 1
    },
    picker: form.return_picker,
    catalogue_query: "",
    error: None,
  })
}

///|
fn toggle_custom_term(state : PlannerState, term : PlannerTerm) -> PlannerState {
  match state.custom_form {
    None => state
    Some(form) => {
      let terms : Array[PlannerTerm] = []
      let mut found = false
      for item in form.terms {
        if item == term {
          found = true
        } else {
          terms.push(item)
        }
      }
      if !found {
        terms.push(term)
      }
      bump({
        ..state,
        custom_form: Some({
          ..form,
          terms,
          error_field: None,
          error_message: "",
        }),
        error: None,
      })
    }
  }
}

///|
fn custom_day_value(day : @tanikun-domain.DayOfWeek) -> String {
  match day {
    @tanikun-domain.DayOfWeek::Monday => "0"
    @tanikun-domain.DayOfWeek::Tuesday => "1"
    @tanikun-domain.DayOfWeek::Wednesday => "2"
    @tanikun-domain.DayOfWeek::Thursday => "3"
    @tanikun-domain.DayOfWeek::Friday => "4"
    @tanikun-domain.DayOfWeek::Saturday => "5"
    @tanikun-domain.DayOfWeek::Sunday => "6"
  }
}

///|
fn custom_semester_value(semester : @tanikun-domain.Semester) -> String {
  match semester {
    @tanikun-domain.Semester::S => "S"
    @tanikun-domain.Semester::A => "A"
    @tanikun-domain.Semester::W => "W"
  }
}

///|
fn open_edit_custom_course(
  state : PlannerState,
  offering_id : @tanikun-domain.OfferingId,
) -> PlannerState {
  let offering = match find_offering(state.offerings, offering_id) {
    Some(value) => value
    None =>
      return with_error(
        state,
        TimetableError::UnknownOffering(offering_id~).to_ui(),
      )
  }
  if !state.is_custom_course(offering.course_id) {
    return with_error(
      state,
      UiError::new(
        UiErrorTarget::Course(course_id=offering.course_id),
        UiErrorKind::General,
        "独自科目ではありません",
      ),
    )
  }
  let course = match find_course(state.catalogue, offering.course_id) {
    Some(value) => value
    None =>
      return with_error(
        state,
        UiError::new(
          UiErrorTarget::Course(course_id=offering.course_id),
          UiErrorKind::DomainValidation,
          "科目が見つかりません",
        ),
      )
  }
  let (schedule, term, terms) = match offering.schedule() {
    @tanikun-domain.OfferingSchedule::Regular(terms=domain_terms) => {
      let selected : Array[PlannerTerm] = []
      for item in domain_terms {
        selected.push(planner_term_for_regular(item))
      }
      (CustomCourseSchedule::Regular, "S1", selected)
    }
    @tanikun-domain.OfferingSchedule::YearLong =>
      (CustomCourseSchedule::YearLong, "S1", [])
    @tanikun-domain.OfferingSchedule::Intensive(semester~) =>
      (CustomCourseSchedule::Intensive, custom_semester_value(semester), [])
  }
  let slots = offering.slots()
  let (day, period) = if slots.is_empty() {
    ("1", "4")
  } else {
    (custom_day_value(slots[0].day), "\{slots[0].period.value()}")
  }
  let form : CustomCourseDraft = {
    name: course.name,
    credits: "\{course.credits.half_units()}",
    academic_year: "\{offering.academic_year.year()}",
    schedule,
    term,
    terms,
    day,
    period,
    editing_course_id: Some(course.id),
    editing_offering_id: Some(offering.id),
    return_picker: state.picker,
    error_field: None,
    error_message: "",
  }
  bump({
    ..state,
    custom_form: Some(form),
    selected_offering: None,
    picker: None,
    error: None,
  })
}

///|
fn delete_custom_course(
  state : PlannerState,
  course_id : @tanikun-domain.CourseId,
) -> PlannerState {
  if !state.is_custom_course(course_id) {
    return with_error(
      state,
      UiError::new(
        UiErrorTarget::Course(course_id~),
        UiErrorKind::General,
        "独自科目ではありません",
      ),
    )
  }
  let offerings : Array[@tanikun-domain.CourseOffering] = []
  for offering in state.offerings {
    if offering.course_id != course_id {
      offerings.push(offering)
    }
  }
  for enrollment in state.enrollments {
    for offering in state.offerings {
      if offering.course_id == course_id &&
        offering.id == enrollment.offering_id {
        return with_error(
          state,
          UiError::new(
            UiErrorTarget::Course(course_id~),
            UiErrorKind::General,
            "履修中の独自科目は削除できません",
          ),
        )
      }
    }
  }
  let catalogue : Array[@tanikun-domain.Course] = []
  for course in state.catalogue {
    if course.id != course_id {
      catalogue.push(course)
    }
  }
  let custom_course_ids : Array[@tanikun-domain.CourseId] = []
  for id in state.custom_course_ids {
    if id != course_id {
      custom_course_ids.push(id)
    }
  }
  let picker = match state.custom_form {
    Some(form) => form.return_picker
    None => None
  }
  bump({
    ..state,
    catalogue,
    offerings,
    custom_course_ids,
    selected_offering: None,
    custom_form: None,
    picker,
    error: None,
  })
}

///|
fn find_slot_conflict_excluding(
  state : PlannerState,
  offering : @tanikun-domain.CourseOffering,
  excluded_offering : @tanikun-domain.OfferingId,
) -> @tanikun-domain.Slot? {
  find_slot_conflict_with_overrides(
    state,
    offering,
    state.overrides,
    Some(excluded_offering),
  )
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
  status : @tanikun-domain.EnrollmentStatus
}

///|
/// One offering shown in the catalogue for the selected term.
pub struct CatalogueEntry {
  offering_id : @tanikun-domain.OfferingId
  course_id : @tanikun-domain.CourseId
  course_name : String
  credits : @tanikun-domain.Credits
  schedule : @tanikun-domain.OfferingSchedule
  slots : Array[@tanikun-domain.Slot]
  enrolled : Bool
  custom : Bool
}

///|
/// One intensive offering in the selected term's off-grid list.
pub struct OffGridEntry {
  offering_id : @tanikun-domain.OfferingId
  course_name : String
  credits : @tanikun-domain.Credits
  status : @tanikun-domain.EnrollmentStatus
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
/// Effective values for the course detail popup.
pub struct OfferingDisplay {
  name : String
  credits : @tanikun-domain.Credits
  slots : Array[@tanikun-domain.Slot]
}

///|
pub fn PlannerState::offering_display(
  self : PlannerState,
  offering_id : @tanikun-domain.OfferingId,
) -> OfferingDisplay? {
  let offering = match find_offering(self.offerings, offering_id) {
    Some(value) => value
    None => return None
  }
  let course = match find_course(self.catalogue, offering.course_id) {
    Some(value) => value
    None => return None
  }
  let (name, credits) = match self.enrollment_for(offering_id) {
    Some(enrollment) =>
      (
        @tanikun-domain.effective_name(enrollment, course, self.overrides),
        @tanikun-domain.effective_credits(enrollment, course, self.overrides),
      )
    None =>
      (
        @tanikun-domain.effective_course_name(course, self.overrides),
        @tanikun-domain.effective_course_credits(course, self.overrides),
      )
  }
  Some({ name, credits, slots: effective_slots_or(offering, self.overrides), })
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
        Some(course) => {
          let name = @tanikun-domain.effective_course_name(
            course,
            self.overrides,
          )
          if self.catalogue_query.is_empty() ||
            name.contains(self.catalogue_query) {
            entries.push({
              offering_id: offering.id,
              course_id: course.id,
              course_name: name,
              credits: @tanikun-domain.effective_course_credits(
                course,
                self.overrides,
              ),
              schedule: offering.schedule(),
              slots: effective_slots_or(offering, self.overrides),
              enrolled: has_enrollment(self.enrollments, offering.id),
              custom: self.is_custom_course(course.id),
            })
          }
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
              for slot in effective_slots_or(offering, self.overrides) {
                blocks.push({
                  offering_id: offering.id,
                  course_name: @tanikun-domain.effective_name(
                    enrollment,
                    course,
                    self.overrides,
                  ),
                  day: slot.day,
                  period: slot.period,
                  status: enrollment.status,
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
                    course_name: @tanikun-domain.effective_name(
                      enrollment,
                      course,
                      self.overrides,
                    ),
                    credits: @tanikun-domain.effective_credits(
                      enrollment,
                      course,
                      self.overrides,
                    ),
                    status: enrollment.status,
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
