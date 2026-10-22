///|
/// A passing grade: 優上, 優, 良, 可, or 合.
pub(all) enum PassingGrade {
  ExcellentPlus
  Excellent
  Good
  Fair
  Pass
} derive(Eq)

///|
pub extend PassingGrade with Eq::{not_equal, equal}

///|
/// A failing grade: 不可 or 否.
pub(all) enum FailingGrade {
  Fail
  NotPassed
} derive(Eq)

///|
pub extend FailingGrade with Eq::{not_equal, equal}

///|
/// The outcome of a confirmed enrollment.
pub(all) enum ConfirmedGrade {
  Passed(grade~ : PassingGrade, snapshot~ : PassedCourseSnapshot)
  Failed(grade~ : FailingGrade)
  NotTaken
}

///|
/// Enrollment state. `Confirmed` always carries a `ConfirmedGrade`, so a
/// confirmed enrollment without an outcome is not representable.
pub(all) enum EnrollmentState {
  Planned
  InProgress
  Confirmed(ConfirmedGrade)
}

///|
/// Course data frozen when an enrollment passes.
///
/// The snapshot does not contain a category; categories belong to the
/// requirement set.
pub struct PassedCourseSnapshot {
  course_id : CourseId
  name : String
  credits : Credits
}

///|
pub fn PassedCourseSnapshot::new(
  course_id : CourseId,
  name : String,
  credits : Credits,
) -> Result[PassedCourseSnapshot, DomainError] {
  if is_blank(name) {
    Err(DomainError::EmptyCourseName)
  } else {
    Ok({ course_id, name, credits, })
  }
}

///|
pub fn PassedCourseSnapshot::from_course(
  course : Course,
) -> Result[PassedCourseSnapshot, DomainError] {
  PassedCourseSnapshot::new(course.id, course.name, course.credits)
}

///|
/// An enrollment keyed by its offering.
pub struct Enrollment {
  offering_id : OfferingId
  state : EnrollmentState
}

///|
pub fn Enrollment::new(
  offering_id : OfferingId,
  state : EnrollmentState,
) -> Enrollment {
  { offering_id, state, }
}

///|
pub fn Enrollment::planned(offering_id : OfferingId) -> Enrollment {
  Enrollment::new(offering_id, EnrollmentState::Planned)
}

///|
pub fn Enrollment::in_progress(offering_id : OfferingId) -> Enrollment {
  Enrollment::new(offering_id, EnrollmentState::InProgress)
}

///|
pub fn Enrollment::passed(
  offering_id : OfferingId,
  grade : PassingGrade,
  snapshot : PassedCourseSnapshot,
) -> Enrollment {
  Enrollment::new(
    offering_id,
    EnrollmentState::Confirmed(ConfirmedGrade::Passed(grade~, snapshot~)),
  )
}

///|
pub fn Enrollment::failed(
  offering_id : OfferingId,
  grade : FailingGrade,
) -> Enrollment {
  Enrollment::new(
    offering_id,
    EnrollmentState::Confirmed(ConfirmedGrade::Failed(grade~)),
  )
}

///|
pub fn Enrollment::not_taken(offering_id : OfferingId) -> Enrollment {
  Enrollment::new(
    offering_id,
    EnrollmentState::Confirmed(ConfirmedGrade::NotTaken),
  )
}

///|
pub fn Enrollment::is_confirmed(self : Enrollment) -> Bool {
  match self.state {
    EnrollmentState::Confirmed(_) => true
    _ => false
  }
}

///|
pub fn Enrollment::is_passed(self : Enrollment) -> Bool {
  match self.state {
    EnrollmentState::Confirmed(ConfirmedGrade::Passed(..)) => true
    _ => false
  }
}

///|
pub fn Enrollment::snapshot(self : Enrollment) -> PassedCourseSnapshot? {
  match self.state {
    EnrollmentState::Confirmed(ConfirmedGrade::Passed(snapshot~, ..)) =>
      Some(snapshot)
    _ => None
  }
}
