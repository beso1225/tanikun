///|
pub struct UndoRemoval {
  enrollments : Array[@tanikun-domain.Enrollment]
  revision : Int
}

///|
/// Local persistence status shown in the shell. Persistence remains a Phase 3
/// concern; the planner model only exposes the observable state.
pub(all) enum StorageStatus {
  Loading
  Saving
  Saved
  Unsaved
  LoadFailed
  Failed
} derive(Eq)

///|
pub extend StorageStatus with Eq::{not_equal, equal}

///|
/// In-memory Phase 2 planner state. Derived credits and requirements are not
/// stored here; they are computed from this state.
pub struct PlannerState {
  catalogue : Array[@tanikun-domain.Course]
  offerings : Array[@tanikun-domain.CourseOffering]
  enrollments : Array[@tanikun-domain.Enrollment]
  undo_removal : UndoRemoval?
  overrides : @tanikun-domain.Overrides
  profile : @tanikun-domain.AcademicProfile
  timetable_year : TimetableYear
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
  custom_categories : Array[
    (@tanikun-domain.CourseId, @tanikun-domain.CategoryId),
  ]
  next_custom_course_number : Int
  custom_id_prefix : String
  visible_days : Int
  visible_periods : Int
  storage_status : StorageStatus
  revision : Int
}

///|
/// Equality drives the Rabbita view refresh. Content changes increment the
/// revision; persistence-status changes are included separately, so the large
/// nested planner state does not need structural Eq.
pub impl Eq for PlannerState with fn equal(self, other) {
  self.revision == other.revision && self.storage_status == other.storage_status
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
  custom_categories : Array[
    (@tanikun-domain.CourseId, @tanikun-domain.CategoryId),
  ],
) -> PlannerState {
  {
    catalogue: catalogue.copy(),
    offerings: offerings.copy(),
    enrollments: enrollments.copy(),
    undo_removal: None,
    overrides,
    profile,
    timetable_year: { grade: 3, academic_year: profile.advancement_year, },
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
    custom_categories,
    next_custom_course_number: 1,
    custom_id_prefix: "",
    visible_days: 5,
    visible_periods: 6,
    storage_status: Loading,
    revision: 0,
  }
}

///|
/// Set a fresh browser-session namespace before editing a restored document.
/// The prefix is runtime identity; existing entity IDs remain persisted.
pub fn PlannerState::with_custom_id_prefix(
  self : PlannerState,
  prefix : String,
) -> PlannerState {
  { ..self, custom_id_prefix: prefix, }
}

///|
/// One category row in the planner summary.
