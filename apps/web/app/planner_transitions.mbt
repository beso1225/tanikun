///|
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
/// Whether the offering's enrollment is passed.
pub fn PlannerState::enrollment_is_passed(
  self : PlannerState,
  offering_id : @tanikun-domain.OfferingId,
) -> Bool {
  match find_enrollment(self.enrollments, offering_id) {
    Some(enrollment) => enrollment.is_passed()
    None => false
  }
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
  UndoEnrollmentRemoval
  UpdateEnrollmentStatus(
    offering_id~ : @tanikun-domain.OfferingId,
    target~ : EnrollmentStatusTarget
  )
  SelectProgram(program_id~ : String)
  SelectAdvancementYear(year~ : String)
  SelectGrade(grade~ : String)
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
  Hydrate(text~ : String)
  StorageStatusChanged(status~ : StorageStatus, revision~ : Int)
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
    UndoEnrollmentRemoval => undo_enrollment_removal(state)
    UpdateEnrollmentStatus(offering_id~, target~) =>
      update_enrollment_status(state, offering_id, target)
    SelectProgram(program_id~) => select_program(state, program_id)
    SelectAdvancementYear(year~) => select_advancement_year(state, year)
    SelectGrade(grade~) => select_grade(state, grade)
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
    Hydrate(text~) =>
      match decode_planner_state(state, text) {
        Ok(value) => { ..value, storage_status: Saved, }
        Err(_) =>
          bump({
            ..state,
            storage_status: Failed,
            error: Some(
              UiError::new(
                General,
                General,
                "保存データを読み込めません",
              ),
            ),
          })
      }
    StorageStatusChanged(status~, revision~) =>
      if revision == state.revision {
        { ..state, storage_status: status, }
      } else {
        state
      }
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
fn offering_displayed_in_term(
  offering : @tanikun-domain.CourseOffering,
  planner_term : PlannerTerm,
) -> Bool {
  match offering.schedule() {
    @tanikun-domain.OfferingSchedule::Intensive(semester~) =>
      semester == planner_term.semester() ||
      (
        (planner_term == A1 || planner_term == A2) &&
        semester == @tanikun-domain.Semester::W
      )
    _ => offering_occupies_term(offering, planner_term)
  }
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
  for planner_term in PlannerTerm::values() {
    if offering_occupies_term(offering, planner_term) {
      let slots = enrollment_slots_in_term(
        state, offering, overrides, planner_term,
      )
      for enrollment in state.enrollments {
        let excluded = match excluded_offering {
          Some(id) => enrollment.offering_id == id
          None => false
        }
        if !excluded {
          match find_offering(state.offerings, enrollment.offering_id) {
            Some(other) =>
              if other.academic_year == offering.academic_year &&
                offering_occupies_term(other, planner_term) {
                let other_slots = enrollment_slots_in_term(
                  state, other, overrides, planner_term,
                )
                let coordinated = match planner_term.term() {
                  Some(term) =>
                    offering.coordinates_with(other) &&
                    slots == offering.slots_in_term(term) &&
                    other_slots == other.slots_in_term(term)
                  None => false
                }
                for slot in slots {
                  for other_slot in other_slots {
                    if slot == other_slot && !coordinated {
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
/// The same allocation path serves rendering and conflict checks. Passed
/// enrollments use the offering's stored phase, ignoring later slot overrides.
fn enrollment_slots_in_term(
  state : PlannerState,
  offering : @tanikun-domain.CourseOffering,
  overrides : @tanikun-domain.Overrides,
  planner_term : PlannerTerm,
) -> Array[@tanikun-domain.Slot] {
  let term = match planner_term.term() {
    Some(term) => term
    None => return []
  }
  if state.enrollment_is_passed(offering.id) {
    return offering.slots_in_term(term)
  }
  match @tanikun-domain.effective_slots_in_term(offering, overrides, term) {
    Ok(slots) => slots
    Err(_) => offering.slots_in_term(term)
  }
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
  if offering.academic_year != state.timetable_year.academic_year {
    return with_error(
      state,
      UiError::new(
        UiErrorTarget::Offering(offering_id=id),
        UiErrorKind::DifferentAcademicYear,
        "選択した年度の開講ではありません",
      ),
    )
  }
  if !offering_displayed_in_term(offering, state.selected_term) {
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
  bump({
    ..state,
    enrollments,
    undo_removal: Some({
      enrollments: state.enrollments.copy(),
      revision: state.revision + 1,
    }),
    selected_offering: None,
    error: None,
  })
}

///|
fn undo_enrollment_removal(state : PlannerState) -> PlannerState {
  match state.undo_removal {
    None => state
    Some(undo) =>
      if undo.revision != state.revision {
        bump({ ..state, undo_removal: None, error: None, })
      } else {
        bump({
          ..state,
          enrollments: undo.enrollments.copy(),
          undo_removal: None,
          selected_offering: None,
          error: None,
        })
      }
  }
}

///|
pub fn PlannerState::undo_available(self : PlannerState) -> Bool {
  match self.undo_removal {
    Some(undo) => undo.revision == self.revision
    None => false
  }
}
