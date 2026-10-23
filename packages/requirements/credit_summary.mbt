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
///
/// Phase 1 note: this function performs the fail-fast validation it needs
/// inline. The collecting `validate(input)` API in #16 will share these rules;
/// keep their ordering conventions aligned when it lands.
pub fn credit_summary(
  input : EvaluationInput[Rule],
) -> Result[Projection[CreditSummary], @tanikun-domain.DomainError] {
  if input.profile.program_id != input.requirement_set.key.program_id ||
    input.profile.advancement_year != input.requirement_set.key.advancement_year {
    return Err(@tanikun-domain.DomainError::ProfileRequirementSetMismatch)
  }
  let courses = match validate_unique_courses(input.courses) {
    Ok(courses) => courses
    Err(error) => return Err(error)
  }
  let offerings = match validate_unique_offerings(input.offerings) {
    Ok(offerings) => offerings
    Err(error) => return Err(error)
  }
  let enrollments = match validate_unique_enrollments(input.enrollments) {
    Ok(enrollments) => enrollments
    Err(error) => return Err(error)
  }
  let unknown_courses : Array[@tanikun-domain.CourseId] = []
  let unknown_offerings : Array[@tanikun-domain.OfferingId] = []
  let retired_courses : Array[@tanikun-domain.CourseId] = []
  let not_offered_offerings : Array[@tanikun-domain.OfferingId] = []
  let snapshot_mismatches : Array[
    (
      @tanikun-domain.OfferingId,
      @tanikun-domain.CourseId,
      @tanikun-domain.CourseId,
    ),
  ] = []

  for offering in offerings {
    match find_course(courses, offering.course_id) {
      Some(_) => ()
      None => unknown_courses.push(offering.course_id)
    }
  }

  let override_entries = input.overrides.entries()
  sort_override_entries(override_entries)
  for entry in override_entries {
    match entry.target {
      @tanikun-domain.OverrideTarget::Course(course_id) =>
        match find_course(courses, course_id) {
          Some(_) => ()
          None => unknown_courses.push(course_id)
        }
      @tanikun-domain.OverrideTarget::Offering(offering_id) =>
        match find_offering(offerings, offering_id) {
          Some(_) => ()
          None => unknown_offerings.push(offering_id)
        }
    }
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

  for enrollment in enrollments {
    match find_offering(offerings, enrollment.offering_id) {
      None => unknown_offerings.push(enrollment.offering_id)
      Some(offering) =>
        match enrollment.status {
          @tanikun-domain.EnrollmentStatus::Confirmed(
            @tanikun-domain.ConfirmedGrade::Passed(snapshot~, ..)
          ) =>
            // A snapshot is taken from the offering's course at pass time, so
            // a mismatch means corrupted history rather than a valid state.
            if snapshot.course_id != offering.course_id {
              snapshot_mismatches.push(
                (offering.id, snapshot.course_id, offering.course_id),
              )
            } else {
              passed_entries.push((snapshot.course_id, snapshot.credits))
            }
          _ =>
            match find_course(courses, offering.course_id) {
              None => unknown_courses.push(offering.course_id)
              Some(course) =>
                match course.status {
                  @tanikun-domain.CourseStatus::Retired =>
                    retired_courses.push(course.id)
                  @tanikun-domain.CourseStatus::Active =>
                    match offering.status {
                      @tanikun-domain.OfferingStatus::NotOffered =>
                        not_offered_offerings.push(offering.id)
                      @tanikun-domain.OfferingStatus::Offered =>
                        match enrollment.status {
                          @tanikun-domain.EnrollmentStatus::InProgress =>
                            if !course_in_entries(
                                in_progress_entries,
                                course.id,
                              ) {
                              in_progress_entries.push(
                                (
                                  course.id,
                                  @tanikun-domain.effective_course_credits(
                                    course,
                                    input.overrides,
                                  ),
                                ),
                              )
                            }
                          @tanikun-domain.EnrollmentStatus::Planned =>
                            if !course_in_entries(planned_entries, course.id) {
                              planned_entries.push(
                                (
                                  course.id,
                                  @tanikun-domain.effective_course_credits(
                                    course,
                                    input.overrides,
                                  ),
                                ),
                              )
                            }
                          _ => ()
                        }
                    }
                }
            }
        }
    }
  }

  unknown_courses.sort_by(fn(left, right) { left.compare(right) })
  unknown_offerings.sort_by(fn(left, right) { left.compare(right) })
  retired_courses.sort_by(fn(left, right) { left.compare(right) })
  not_offered_offerings.sort_by(fn(left, right) { left.compare(right) })
  snapshot_mismatches.sort_by(fn(left, right) { left.0.compare(right.0) })

  if !unknown_courses.is_empty() {
    return Err(
      @tanikun-domain.DomainError::UnknownCourse(course_id=unknown_courses[0]),
    )
  }
  if !unknown_offerings.is_empty() {
    return Err(
      @tanikun-domain.DomainError::UnknownOffering(
        offering_id=unknown_offerings[0],
      ),
    )
  }
  if !retired_courses.is_empty() {
    return Err(
      @tanikun-domain.DomainError::RetiredCourseEnrollment(
        course_id=retired_courses[0],
      ),
    )
  }
  if !not_offered_offerings.is_empty() {
    return Err(
      @tanikun-domain.DomainError::NotOfferedEnrollment(
        offering_id=not_offered_offerings[0],
      ),
    )
  }
  if !snapshot_mismatches.is_empty() {
    let mismatch = snapshot_mismatches[0]
    return Err(
      @tanikun-domain.DomainError::PassedSnapshotCourseMismatch(
        offering_id=mismatch.0,
        snapshot_course_id=mismatch.1,
        offering_course_id=mismatch.2,
      ),
    )
  }

  passed_entries.sort_by(fn(left, right) { left.0.compare(right.0) })
  for index in 1..<passed_entries.length() {
    if passed_entries[index - 1].0 == passed_entries[index].0 {
      return Err(
        @tanikun-domain.DomainError::DuplicatePassedCourse(
          course_id=passed_entries[index].0,
        ),
      )
    }
  }

  match validate_requirement_rule(input.requirement_set, courses) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  match validate_slot_overrides(override_entries, offerings, input.overrides) {
    Err(error) => return Err(error)
    Ok(_) => ()
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

  // Re-aggregation is deliberate: the nested projection entries are small and
  // one summary builder per mode keeps the accumulation readable.
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
fn build_credit_summary(
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
) -> Result[Array[@tanikun-domain.Course], @tanikun-domain.DomainError] {
  let sorted = courses.copy()
  sorted.sort_by(fn(left, right) { left.id.compare(right.id) })
  for index in 1..<sorted.length() {
    if sorted[index - 1].id == sorted[index].id {
      return Err(
        @tanikun-domain.DomainError::DuplicateCourseId(id=sorted[index].id),
      )
    }
  }
  Ok(sorted)
}

///|
fn validate_unique_offerings(
  offerings : Array[@tanikun-domain.CourseOffering],
) -> Result[Array[@tanikun-domain.CourseOffering], @tanikun-domain.DomainError] {
  let sorted = offerings.copy()
  sorted.sort_by(fn(left, right) { left.id.compare(right.id) })
  for index in 1..<sorted.length() {
    if sorted[index - 1].id == sorted[index].id {
      return Err(
        @tanikun-domain.DomainError::DuplicateOfferingId(id=sorted[index].id),
      )
    }
  }
  Ok(sorted)
}

///|
fn validate_unique_enrollments(
  enrollments : Array[@tanikun-domain.Enrollment],
) -> Result[Array[@tanikun-domain.Enrollment], @tanikun-domain.DomainError] {
  let sorted = enrollments.copy()
  sorted.sort_by(fn(left, right) { left.offering_id.compare(right.offering_id) })
  for index in 1..<sorted.length() {
    if sorted[index - 1].offering_id == sorted[index].offering_id {
      return Err(
        @tanikun-domain.DomainError::DuplicateEnrollment(
          offering_id=sorted[index].offering_id,
        ),
      )
    }
  }
  Ok(sorted)
}

///|
fn sort_override_entries(entries : Array[@tanikun-domain.Override]) -> Unit {
  entries.sort_by(fn(left, right) {
    let target_order = left.target.compare(right.target)
    if target_order != 0 {
      target_order
    } else {
      left.attribute.compare(right.attribute)
    }
  })
}

///|
fn validate_slot_overrides(
  entries : Array[@tanikun-domain.Override],
  offerings : Array[@tanikun-domain.CourseOffering],
  overrides : @tanikun-domain.Overrides,
) -> Result[Unit, @tanikun-domain.DomainError] {
  for entry in entries {
    match entry.target {
      @tanikun-domain.OverrideTarget::Course(_) => ()
      @tanikun-domain.OverrideTarget::Offering(offering_id) =>
        match entry.attribute {
          @tanikun-domain.OverrideAttribute::Slots => {
            let offering = match find_offering(offerings, offering_id) {
              Some(offering) => offering
              None =>
                return Err(
                  @tanikun-domain.DomainError::UnknownOffering(offering_id~),
                )
            }
            match @tanikun-domain.effective_slots(offering, overrides) {
              Ok(_) => ()
              Err(error) => return Err(error)
            }
          }
          _ => ()
        }
    }
  }
  Ok(())
}

///|
fn validate_requirement_rule(
  requirement_set : RequirementSet[Rule],
  courses : Array[@tanikun-domain.Course],
) -> Result[Unit, @tanikun-domain.DomainError] {
  let categories : Array[@tanikun-domain.CategoryId] = []
  for category in requirement_set.categories() {
    categories.push(category.id)
  }
  let course_ids : Array[@tanikun-domain.CourseId] = []
  for course in courses {
    course_ids.push(course.id)
  }
  requirement_set.rule().validate(RuleScope::new(categories, course_ids))
}
