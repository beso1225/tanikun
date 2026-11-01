///|
/// The persisted source-state schema. UI-only state and all derived values are
/// intentionally absent. The DTOs are public so contract tests can mutate one
/// field at a time; `encode_planner_state` and `decode_planner_state` remain
/// the production API.
pub(all) struct PersistedPlan {
  version : Int
  catalogue : Array[PersistedCourse]
  offerings : Array[PersistedOffering]
  enrollments : Array[PersistedEnrollment]
  overrides : Array[PersistedOverride]
  program_id : String
  advancement_year : Int
  timetable_grade : Int
  selected_term : String
  visible_days : Int
  visible_periods : Int
  custom_course_ids : Array[PersistedCourseId]
  custom_categories : Array[PersistedCategoryAssignment]
  next_custom_course_number : Int
} derive(ToJson, FromJson)

///|
pub extend PersistedPlan with ToJson::{to_json}

///|
pub extend PersistedPlan with @json.FromJson::{from_json}

///|
pub(all) struct PersistedCourseId {
  namespace_part : String
  local_part : String
} derive(ToJson, FromJson, Eq)

///|
pub extend PersistedCourseId with Eq::{not_equal, equal}

///|
pub extend PersistedCourseId with ToJson::{to_json}

///|
pub extend PersistedCourseId with @json.FromJson::{from_json}

///|
pub(all) struct PersistedCourse {
  id : PersistedCourseId
  name : String
  credits : Int
  status : String
} derive(ToJson, FromJson)

///|
pub extend PersistedCourse with ToJson::{to_json}

///|
pub extend PersistedCourse with @json.FromJson::{from_json}

///|
pub(all) struct PersistedSlot {
  day : String
  period : Int
} derive(ToJson, FromJson)

///|
pub extend PersistedSlot with ToJson::{to_json}

///|
pub extend PersistedSlot with @json.FromJson::{from_json}

///|
pub(all) struct PersistedPhase {
  term : String
  slots : Array[PersistedSlot]
} derive(ToJson, FromJson)

///|
pub extend PersistedPhase with ToJson::{to_json}

///|
pub extend PersistedPhase with @json.FromJson::{from_json}

///|
pub(all) struct PersistedOffering {
  id : String
  course_id : PersistedCourseId
  academic_year : Int
  schedule : String
  terms : Array[String]
  semester : String
  status : String
  slots : Array[PersistedSlot]
  term_slots : Array[PersistedPhase]
  coordinated_group : String
  coordinated_source : String
} derive(ToJson, FromJson)

///|
pub extend PersistedOffering with ToJson::{to_json}

///|
pub extend PersistedOffering with @json.FromJson::{from_json}

///|
pub(all) struct PersistedSnapshot {
  course_id : PersistedCourseId
  name : String
  credits : Int
} derive(ToJson, FromJson)

///|
pub extend PersistedSnapshot with ToJson::{to_json}

///|
pub extend PersistedSnapshot with @json.FromJson::{from_json}

///|
pub(all) struct PersistedEnrollment {
  offering_id : String
  status : String
  passing_grade : String
  failing_grade : String
  snapshot : PersistedSnapshot
} derive(ToJson, FromJson)

///|
pub extend PersistedEnrollment with ToJson::{to_json}

///|
pub extend PersistedEnrollment with @json.FromJson::{from_json}

///|
pub(all) struct PersistedOverride {
  target_kind : String
  course_namespace : String
  course_local : String
  offering_id : String
  value_kind : String
  text : String
  credits : Int
  slots : Array[PersistedSlot]
} derive(ToJson, FromJson)

///|
pub extend PersistedOverride with ToJson::{to_json}

///|
pub extend PersistedOverride with @json.FromJson::{from_json}

///|
pub(all) struct PersistedCategoryAssignment {
  course : PersistedCourseId
  category : String
} derive(ToJson, FromJson)

///|
pub extend PersistedCategoryAssignment with ToJson::{to_json}

///|
pub extend PersistedCategoryAssignment with @json.FromJson::{from_json}
