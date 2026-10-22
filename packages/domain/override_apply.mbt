///|
/// Returns the effective display name of a course.
pub fn effective_course_name(course : Course, overrides : Overrides) -> String {
  match
    overrides.find(
      OverrideTarget::Course(course.id),
      OverrideAttribute::DisplayName,
    ) {
    Some(entry) =>
      match entry.text() {
        Some(text) => text
        None => course.name
      }
    None => course.name
  }
}

///|
/// Returns the effective course credits for non-passed enrollments.
pub fn effective_course_credits(
  course : Course,
  overrides : Overrides,
) -> Credits {
  match
    overrides.find(
      OverrideTarget::Course(course.id),
      OverrideAttribute::Credits,
    ) {
    Some(entry) =>
      match entry.credits() {
        Some(credits) => credits
        None => course.credits
      }
    None => course.credits
  }
}

///|
/// Returns the name for an enrollment, preferring the frozen snapshot after a
/// pass.
pub fn effective_name(
  enrollment : Enrollment,
  course : Course,
  overrides : Overrides,
) -> String {
  match enrollment.snapshot() {
    Some(snapshot) => snapshot.name
    None => effective_course_name(course, overrides)
  }
}

///|
/// Returns the credits for an enrollment, preferring the frozen snapshot after
/// a pass.
pub fn effective_credits(
  enrollment : Enrollment,
  course : Course,
  overrides : Overrides,
) -> Credits {
  match enrollment.snapshot() {
    Some(snapshot) => snapshot.credits
    None => effective_course_credits(course, overrides)
  }
}

///|
/// Returns the effective slots of an offering, validating a slot override
/// against the offering's schedule and status.
pub fn effective_slots(
  offering : CourseOffering,
  overrides : Overrides,
) -> Result[Array[Slot], DomainError] {
  match
    overrides.find(
      OverrideTarget::Offering(offering.id),
      OverrideAttribute::Slots,
    ) {
    Some(entry) =>
      match entry.slots() {
        Some(slots) =>
          match
            CourseOffering::new(
              offering.id,
              offering.course_id,
              offering.academic_year,
              offering.schedule(),
              offering.status,
              slots,
            ) {
            Ok(updated) => Ok(updated.slots())
            Err(error) => Err(error)
          }
        None => Ok(offering.slots())
      }
    None => Ok(offering.slots())
  }
}
