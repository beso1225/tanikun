///|
/// A passing grade: 優上, 優, 良, 可, or 合.
pub(all) enum PassingGrade {
  ExcellentPlus // 優上
  Excellent // 優
  Good // 良
  Fair // 可
  Pass // 合
} derive(Eq)

///|
pub extend PassingGrade with Eq::{not_equal, equal}

///|
/// A failing grade: 不可 or 否.
pub(all) enum FailingGrade {
  Fail // 不可
  NotPassed // 否
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
/// Enrollment status. `Confirmed` always carries a `ConfirmedGrade`, so a
/// confirmed enrollment without an outcome is not representable.
pub(all) enum EnrollmentStatus {
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
  status : EnrollmentStatus
}

///|
pub fn Enrollment::new(
  offering_id : OfferingId,
  status : EnrollmentStatus,
) -> Enrollment {
  { offering_id, status, }
}

///|
pub fn Enrollment::planned(offering_id : OfferingId) -> Enrollment {
  Enrollment::new(offering_id, EnrollmentStatus::Planned)
}

///|
pub fn Enrollment::in_progress(offering_id : OfferingId) -> Enrollment {
  Enrollment::new(offering_id, EnrollmentStatus::InProgress)
}

///|
pub fn Enrollment::passed(
  offering_id : OfferingId,
  grade : PassingGrade,
  snapshot : PassedCourseSnapshot,
) -> Enrollment {
  Enrollment::new(
    offering_id,
    EnrollmentStatus::Confirmed(ConfirmedGrade::Passed(grade~, snapshot~)),
  )
}

///|
pub fn Enrollment::failed(
  offering_id : OfferingId,
  grade : FailingGrade,
) -> Enrollment {
  Enrollment::new(
    offering_id,
    EnrollmentStatus::Confirmed(ConfirmedGrade::Failed(grade~)),
  )
}

///|
pub fn Enrollment::not_taken(offering_id : OfferingId) -> Enrollment {
  Enrollment::new(
    offering_id,
    EnrollmentStatus::Confirmed(ConfirmedGrade::NotTaken),
  )
}

///|
pub fn Enrollment::is_confirmed(self : Enrollment) -> Bool {
  match self.status {
    EnrollmentStatus::Confirmed(_) => true
    _ => false
  }
}

///|
pub fn Enrollment::is_passed(self : Enrollment) -> Bool {
  match self.status {
    EnrollmentStatus::Confirmed(ConfirmedGrade::Passed(..)) => true
    _ => false
  }
}

///|
pub fn Enrollment::snapshot(self : Enrollment) -> PassedCourseSnapshot? {
  match self.status {
    EnrollmentStatus::Confirmed(ConfirmedGrade::Passed(snapshot~, ..)) =>
      Some(snapshot)
    _ => None
  }
}
