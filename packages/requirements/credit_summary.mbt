///|
/// The three projection modes for a value.
pub struct Projection[T] {
  confirmed : T
  standard : T
  optimistic : T
}

///|
/// Total credits and per-category credits.
pub struct CreditSummary {
  total : @tanikun-domain.Credits
  priv by_category : Array[
    (@tanikun-domain.CategoryId, @tanikun-domain.Credits),
  ]
}

///|
/// Returns a copy of the sorted per-category credits.
pub fn CreditSummary::by_category(
  self : CreditSummary,
) -> Array[(@tanikun-domain.CategoryId, @tanikun-domain.Credits)] {
  self.by_category.copy()
}

///|
pub fn CreditSummary::category_credits(
  self : CreditSummary,
  category_id : @tanikun-domain.CategoryId,
) -> @tanikun-domain.Credits? {
  for entry in self.by_category {
    if entry.0 == category_id {
      return Some(entry.1)
    }
  }
  None
}

///|
/// Accumulates confirmed, standard projected, and optimistic projected credits.
pub fn[Rule] credit_summary(
  input : EvaluationInput[Rule],
) -> Result[Projection[CreditSummary], @tanikun-domain.DomainError] {
  if input.profile.program_id != input.requirement_set.key.program_id ||
    input.profile.advancement_year != input.requirement_set.key.advancement_year {
    return Err(@tanikun-domain.DomainError::ProfileRequirementSetMismatch)
  }
  match validate_unique_courses(input.courses) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  match validate_unique_offerings(input.offerings) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  match validate_unique_enrollments(input.enrollments) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }

  let passed_entries : Array[
    (@tanikun-domain.CourseId, @tanikun-domain.Credits),
  ] = []
  let in_progress_entries : Array[
    (@tanikun-domain.CourseId, @tanikun-domain.Credits),
  ] = []
  let planned_entries : Array[
    (@tanikun-domain.CourseId, @tanikun-domain.Credits),
  ] = []

  for enrollment in input.enrollments {
    let offering = match
      find_offering(input.offerings, enrollment.offering_id) {
      Some(offering) => offering
      None =>
        return Err(
          @tanikun-domain.DomainError::UnknownOffering(
            offering_id=enrollment.offering_id,
          ),
        )
    }
    match enrollment.status {
      @tanikun-domain.EnrollmentStatus::Confirmed(
        @tanikun-domain.ConfirmedGrade::Passed(snapshot~, ..)
      ) => {
        if course_in_entries(passed_entries, snapshot.course_id) {
          return Err(
            @tanikun-domain.DomainError::DuplicatePassedCourse(
              course_id=snapshot.course_id,
            ),
          )
        }
        passed_entries.push((snapshot.course_id, snapshot.credits))
      }
      @tanikun-domain.EnrollmentStatus::InProgress => {
        let course = match find_course(input.courses, offering.course_id) {
          Some(course) => course
          None =>
            return Err(
              @tanikun-domain.DomainError::UnknownCourse(
                course_id=offering.course_id,
              ),
            )
        }
        if !course_in_entries(in_progress_entries, course.id) {
          in_progress_entries.push(
            (
              course.id,
              @tanikun-domain.effective_course_credits(course, input.overrides),
            ),
          )
        }
      }
      @tanikun-domain.EnrollmentStatus::Planned => {
        let course = match find_course(input.courses, offering.course_id) {
          Some(course) => course
          None =>
            return Err(
              @tanikun-domain.DomainError::UnknownCourse(
                course_id=offering.course_id,
              ),
            )
        }
        if !course_in_entries(planned_entries, course.id) {
          planned_entries.push(
            (
              course.id,
              @tanikun-domain.effective_course_credits(course, input.overrides),
            ),
          )
        }
      }
      @tanikun-domain.EnrollmentStatus::Confirmed(
        @tanikun-domain.ConfirmedGrade::Failed(_)
      ) => ()
      @tanikun-domain.EnrollmentStatus::Confirmed(
        @tanikun-domain.ConfirmedGrade::NotTaken
      ) => ()
    }
  }

  let standard_entries = passed_entries.copy()
  for entry in in_progress_entries {
    if !course_in_entries(standard_entries, entry.0) {
      standard_entries.push(entry)
    }
  }
  let optimistic_entries = standard_entries.copy()
  for entry in planned_entries {
    if !course_in_entries(optimistic_entries, entry.0) {
      optimistic_entries.push(entry)
    }
  }

  let confirmed = match
    build_credit_summary(input.requirement_set, passed_entries) {
    Ok(summary) => summary
    Err(error) => return Err(error)
  }
  let standard = match
    build_credit_summary(input.requirement_set, standard_entries) {
    Ok(summary) => summary
    Err(error) => return Err(error)
  }
  let optimistic = match
    build_credit_summary(input.requirement_set, optimistic_entries) {
    Ok(summary) => summary
    Err(error) => return Err(error)
  }
  Ok({ confirmed, standard, optimistic, })
}

///|
fn[Rule] build_credit_summary(
  requirement_set : RequirementSet[Rule],
  entries : Array[(@tanikun-domain.CourseId, @tanikun-domain.Credits)],
) -> Result[CreditSummary, @tanikun-domain.DomainError] {
  let by_category : Array[(@tanikun-domain.CategoryId, @tanikun-domain.Credits)] = []
  for category in requirement_set.categories() {
    by_category.push((category.id, @tanikun-domain.Credits::zero()))
  }
  let mut total = @tanikun-domain.Credits::zero()
  for entry in entries {
    total = total.add(entry.1)
    match requirement_set.category_for(entry.0) {
      Some(category_id) => {
        let mut found = false
        for index in 0..<by_category.length() {
          if by_category[index].0 == category_id {
            by_category[index] = (
              category_id,
              by_category[index].1.add(entry.1),
            )
            found = true
          }
        }
        if !found {
          return Err(
            @tanikun-domain.DomainError::UnknownCategory(id=category_id),
          )
        }
      }
      None => ()
    }
  }
  by_category.sort_by(fn(left, right) { left.0.compare(right.0) })
  Ok({ total, by_category, })
}

///|
fn course_in_entries(
  entries : Array[(@tanikun-domain.CourseId, @tanikun-domain.Credits)],
  course_id : @tanikun-domain.CourseId,
) -> Bool {
  for entry in entries {
    if entry.0 == course_id {
      return true
    }
  }
  false
}

///|
fn find_course(
  courses : Array[@tanikun-domain.Course],
  course_id : @tanikun-domain.CourseId,
) -> @tanikun-domain.Course? {
  for course in courses {
    if course.id == course_id {
      return Some(course)
    }
  }
  None
}

///|
fn find_offering(
  offerings : Array[@tanikun-domain.CourseOffering],
  offering_id : @tanikun-domain.OfferingId,
) -> @tanikun-domain.CourseOffering? {
  for offering in offerings {
    if offering.id == offering_id {
      return Some(offering)
    }
  }
  None
}

///|
fn validate_unique_courses(
  courses : Array[@tanikun-domain.Course],
) -> Result[Unit, @tanikun-domain.DomainError] {
  for index in 0..<courses.length() {
    for other in (index + 1)..<courses.length() {
      if courses[index].id == courses[other].id {
        return Err(
          @tanikun-domain.DomainError::DuplicateCourseId(id=courses[index].id),
        )
      }
    }
  }
  Ok(())
}

///|
fn validate_unique_offerings(
  offerings : Array[@tanikun-domain.CourseOffering],
) -> Result[Unit, @tanikun-domain.DomainError] {
  for index in 0..<offerings.length() {
    for other in (index + 1)..<offerings.length() {
      if offerings[index].id == offerings[other].id {
        return Err(
          @tanikun-domain.DomainError::DuplicateOfferingId(
            id=offerings[index].id,
          ),
        )
      }
    }
  }
  Ok(())
}

///|
fn validate_unique_enrollments(
  enrollments : Array[@tanikun-domain.Enrollment],
) -> Result[Unit, @tanikun-domain.DomainError] {
  for index in 0..<enrollments.length() {
    for other in (index + 1)..<enrollments.length() {
      if enrollments[index].offering_id == enrollments[other].offering_id {
        return Err(
          @tanikun-domain.DomainError::DuplicateEnrollment(
            offering_id=enrollments[index].offering_id,
          ),
        )
      }
    }
  }
  Ok(())
}
