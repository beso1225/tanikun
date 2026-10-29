///|
pub(all) enum CustomCourseField {
  Name
  Credits
  Category
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
  category : String
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
/// The timetable grade and academic year selected in the shell. The mapping is
/// anchored at the profile's advancement year, which is the year the student
/// enters the third year: grade 3 is the advancement year, grade 2 the year
/// before, grade 1 two years before, and grade 4 one year after.
pub struct TimetableYear {
  grade : Int
  academic_year : @tanikun-domain.AcademicYear
}

///|
fn year_for_grade(
  profile : @tanikun-domain.AcademicProfile,
  grade : Int,
) -> @tanikun-domain.AcademicYear? {
  if grade < 1 || grade > 4 {
    return None
  }
  let year = profile.advancement_year.year() + grade - 3
  match @tanikun-domain.AcademicYear::new(year) {
    Ok(value) => Some(value)
    Err(_) => None
  }
}

///|
fn timetable_year_for_grade(
  profile : @tanikun-domain.AcademicProfile,
  grade : Int,
) -> TimetableYear? {
  match year_for_grade(profile, grade) {
    Some(academic_year) => Some({ grade, academic_year, })
    None => None
  }
}

///|
/// The enrollment list captured immediately before a removal.
