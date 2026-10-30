///|
/// One scheduled course block in the selected term.
pub struct ScheduledBlock {
  offering_id : @tanikun-domain.OfferingId
  course_name : String
  category_name : String
  credits : @tanikun-domain.Credits
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
  category_name : String
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
  category_name : String
  credits : @tanikun-domain.Credits
  status : @tanikun-domain.EnrollmentStatus
  winter : Bool
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
  category_name : String
  slots : Array[@tanikun-domain.Slot]
}

///|
pub fn PlannerState::offering_display(
  self : PlannerState,
  offering_id : @tanikun-domain.OfferingId,
) -> OfferingDisplay? {
  self.offering_display_with(offering_id, self.category_names())
}

///|
pub fn PlannerState::offering_display_with(
  self : PlannerState,
  offering_id : @tanikun-domain.OfferingId,
  categories : CategoryNames,
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
  let slots = enrollment_slots_in_term(
    self,
    offering,
    self.overrides,
    self.selected_term,
  )
  Some({
    name,
    credits,
    category_name: categories.name_for(offering.course_id),
    slots,
  })
}

///|
pub fn PlannerState::catalogue_entries(
  self : PlannerState,
  term : PlannerTerm,
) -> Array[CatalogueEntry] {
  self.catalogue_entries_with(term, self.category_names())
}

///|
pub fn PlannerState::catalogue_entries_with(
  self : PlannerState,
  term : PlannerTerm,
  categories : CategoryNames,
) -> Array[CatalogueEntry] {
  let entries : Array[CatalogueEntry] = []
  for offering in self.offerings {
    if offering.academic_year == self.timetable_year.academic_year &&
      offering_displayed_in_term(offering, term) &&
      offering.status == @tanikun-domain.OfferingStatus::Offered {
      match find_course(self.catalogue, offering.course_id) {
        Some(course) => {
          let enrollment = self.enrollment_for(offering.id)
          let (name, credits, slots) = match enrollment {
            Some(value) =>
              if value.is_passed() {
                (
                  @tanikun-domain.effective_name(value, course, self.overrides),
                  @tanikun-domain.effective_credits(
                    value,
                    course,
                    self.overrides,
                  ),
                  enrollment_slots_in_term(self, offering, self.overrides, term),
                )
              } else {
                (
                  @tanikun-domain.effective_course_name(course, self.overrides),
                  @tanikun-domain.effective_course_credits(
                    course,
                    self.overrides,
                  ),
                  enrollment_slots_in_term(self, offering, self.overrides, term),
                )
              }
            None =>
              (
                @tanikun-domain.effective_course_name(course, self.overrides),
                @tanikun-domain.effective_course_credits(course, self.overrides),
                enrollment_slots_in_term(self, offering, self.overrides, term),
              )
          }
          if self.catalogue_query.is_empty() ||
            name.contains(self.catalogue_query) {
            entries.push({
              offering_id: offering.id,
              course_id: course.id,
              course_name: name,
              category_name: categories.name_for(course.id),
              credits,
              schedule: offering.schedule(),
              slots,
              enrolled: enrollment is Some(_),
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
  self.picker_entries_with(self.category_names())
}

///|
pub fn PlannerState::picker_entries_with(
  self : PlannerState,
  categories : CategoryNames,
) -> Array[CatalogueEntry] {
  let entries : Array[CatalogueEntry] = []
  let base = self.catalogue_entries_with(self.selected_term, categories)
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
  self.scheduled_blocks_with(term, self.category_names())
}

///|
pub fn PlannerState::scheduled_blocks_with(
  self : PlannerState,
  term : PlannerTerm,
  categories : CategoryNames,
) -> Array[ScheduledBlock] {
  let blocks : Array[ScheduledBlock] = []
  for enrollment in self.enrollments {
    match find_offering(self.offerings, enrollment.offering_id) {
      Some(offering) =>
        if offering.academic_year == self.timetable_year.academic_year &&
          offering_occupies_term(offering, term) {
          match find_course(self.catalogue, offering.course_id) {
            Some(course) => {
              let slots = enrollment_slots_in_term(
                self,
                offering,
                self.overrides,
                term,
              )
              for slot in slots {
                blocks.push({
                  offering_id: offering.id,
                  course_name: @tanikun-domain.effective_name(
                    enrollment,
                    course,
                    self.overrides,
                  ),
                  category_name: categories.name_for(course.id),
                  credits: @tanikun-domain.effective_credits(
                    enrollment,
                    course,
                    self.overrides,
                  ),
                  day: slot.day,
                  period: slot.period,
                  status: enrollment.status,
                })
              }
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
  self.off_grid_entries_with(term, self.category_names())
}

///|
pub fn PlannerState::off_grid_entries_with(
  self : PlannerState,
  term : PlannerTerm,
  categories : CategoryNames,
) -> Array[OffGridEntry] {
  let entries : Array[OffGridEntry] = []
  for enrollment in self.enrollments {
    match find_offering(self.offerings, enrollment.offering_id) {
      Some(offering) =>
        if offering.academic_year == self.timetable_year.academic_year &&
          offering_displayed_in_term(offering, term) {
          match offering.schedule() {
            @tanikun-domain.OfferingSchedule::Intensive(semester~) =>
              match find_course(self.catalogue, offering.course_id) {
                Some(course) =>
                  entries.push({
                    offering_id: offering.id,
                    course_name: @tanikun-domain.effective_name(
                      enrollment,
                      course,
                      self.overrides,
                    ),
                    category_name: categories.name_for(course.id),
                    credits: @tanikun-domain.effective_credits(
                      enrollment,
                      course,
                      self.overrides,
                    ),
                    status: enrollment.status,
                    winter: semester == @tanikun-domain.Semester::W,
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
