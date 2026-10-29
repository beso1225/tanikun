///|
fn open_override_editor(
  state : PlannerState,
  offering_id : @tanikun-domain.OfferingId,
) -> PlannerState {
  let offering = match find_offering(state.offerings, offering_id) {
    Some(value) => value
    None =>
      return with_error(
        state,
        TimetableError::UnknownOffering(offering_id~).to_ui(),
      )
  }
  let course = match find_course(state.catalogue, offering.course_id) {
    Some(value) => value
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
  let name = match
    state.overrides.find(
      @tanikun-domain.OverrideTarget::Course(course.id),
      @tanikun-domain.OverrideAttribute::DisplayName,
    ) {
    Some(entry) =>
      match entry.text() {
        Some(value) => value
        None => ""
      }
    None => ""
  }
  let credits = match
    state.overrides.find(
      @tanikun-domain.OverrideTarget::Course(course.id),
      @tanikun-domain.OverrideAttribute::Credits,
    ) {
    Some(entry) =>
      match entry.credits() {
        Some(value) => "\{value.half_units()}"
        None => ""
      }
    None => ""
  }
  let (default_day, default_period) = default_override_slot(offering)
  let default_day = match custom_day(default_day) {
    Some(value) => value
    None => @tanikun-domain.DayOfWeek::Monday
  }
  let default_period = match option_int(default_period, 1, 10) {
    Some(value) =>
      match @tanikun-domain.Period::new(value) {
        Ok(period) => period
        Err(_) =>
          return with_error(
            state,
            UiError::new(
              UiErrorTarget::Offering(offering_id=offering.id),
              UiErrorKind::DomainValidation,
              "時限が正しくありません",
            ),
          )
      }
    None =>
      return with_error(
        state,
        UiError::new(
          UiErrorTarget::Offering(offering_id=offering.id),
          UiErrorKind::DomainValidation,
          "時限が正しくありません",
        ),
      )
  }
  let (slots_enabled, day, period) = match
    state.overrides.find(
      @tanikun-domain.OverrideTarget::Offering(offering.id),
      @tanikun-domain.OverrideAttribute::Slots,
    ) {
    Some(entry) =>
      match entry.slots() {
        Some(slots) =>
          if slots.is_empty() {
            (false, default_day, default_period)
          } else {
            (true, slots[0].day, slots[0].period)
          }
        None => (false, default_day, default_period)
      }
    None => (false, default_day, default_period)
  }
  let form : OverrideDraft = {
    offering_id: offering.id,
    course_id: course.id,
    name,
    credits,
    slots_enabled,
    supports_slots: override_supports_slots(offering),
    day,
    period,
    error_field: None,
    error_message: "",
  }
  bump({
    ..state,
    override_form: Some(form),
    selected_offering: None,
    picker: None,
    custom_form: None,
    settings_open: false,
    error: None,
  })
}

///|
fn update_override_field(
  state : PlannerState,
  field : OverrideField,
  value : String,
) -> PlannerState {
  match state.override_form {
    None => state
    Some(form) => {
      let next = match field {
        Name => { ..form, name: value, }
        Credits => { ..form, credits: value, }
        _ => form
      }
      bump({
        ..state,
        override_form: Some({ ..next, error_field: None, error_message: "", }),
        error: None,
      })
    }
  }
}

///|
fn update_override_day(state : PlannerState, value : String) -> PlannerState {
  let day = match custom_day(value) {
    Some(value) => value
    None => return state
  }
  match state.override_form {
    None => state
    Some(form) =>
      bump({
        ..state,
        override_form: Some({
          ..form,
          day,
          error_field: None,
          error_message: "",
        }),
        error: None,
      })
  }
}

///|
fn update_override_period(state : PlannerState, value : String) -> PlannerState {
  let period = match option_int(value, 1, 10) {
    Some(value) => value
    None => return state
  }
  let period = match @tanikun-domain.Period::new(period) {
    Ok(value) => value
    Err(_) => return state
  }
  match state.override_form {
    None => state
    Some(form) =>
      bump({
        ..state,
        override_form: Some({
          ..form,
          period,
          error_field: None,
          error_message: "",
        }),
        error: None,
      })
  }
}

///|
fn toggle_override_slots(state : PlannerState) -> PlannerState {
  match state.override_form {
    None => state
    Some(form) =>
      if !form.supports_slots {
        state
      } else {
        bump({
          ..state,
          override_form: Some({
            ..form,
            slots_enabled: !form.slots_enabled,
            error_field: None,
            error_message: "",
          }),
          error: None,
        })
      }
  }
}

///|
fn override_form_error(
  state : PlannerState,
  form : OverrideDraft,
  field : OverrideField,
  message : String,
) -> PlannerState {
  bump({
    ..state,
    override_form: Some({
      ..form,
      error_field: Some(field),
      error_message: message,
    }),
  })
}

///|
fn override_entry_kept(
  entry : @tanikun-domain.Override,
  form : OverrideDraft,
) -> Bool {
  match entry.target {
    @tanikun-domain.OverrideTarget::Course(course_id) =>
      if course_id == form.course_id {
        match entry.attribute {
          @tanikun-domain.OverrideAttribute::DisplayName => false
          @tanikun-domain.OverrideAttribute::Credits => false
          @tanikun-domain.OverrideAttribute::Slots => true
        }
      } else {
        true
      }
    @tanikun-domain.OverrideTarget::Offering(offering_id) =>
      if offering_id == form.offering_id {
        match entry.attribute {
          @tanikun-domain.OverrideAttribute::Slots => false
          _ => true
        }
      } else {
        true
      }
  }
}

///|
fn remove_all_overrides(state : PlannerState) -> PlannerState {
  match state.override_form {
    None => state
    Some(form) => {
      let entries : Array[@tanikun-domain.Override] = []
      for entry in state.overrides.entries() {
        if override_entry_kept(entry, form) {
          entries.push(entry)
        }
      }
      let overrides = match @tanikun-domain.Overrides::new(entries) {
        Ok(value) => value
        Err(error) =>
          return override_form_error(
            state,
            form,
            General,
            UiError::from_domain(
              error,
              UiErrorTarget::Offering(offering_id=form.offering_id),
            ).message,
          )
      }
      bump({
        ..state,
        overrides,
        override_form: None,
        selected_offering: Some(form.offering_id),
        error: None,
      })
    }
  }
}

///|
fn submit_override(state : PlannerState) -> PlannerState {
  let form = match state.override_form {
    Some(value) => value
    None => return state
  }
  let offering = match find_offering(state.offerings, form.offering_id) {
    Some(value) => value
    None =>
      return override_form_error(
        state,
        form,
        General,
        "開講が見つかりません",
      )
  }
  let entries : Array[@tanikun-domain.Override] = []
  for entry in state.overrides.entries() {
    if override_entry_kept(entry, form) {
      entries.push(entry)
    }
  }
  if !form.name.is_empty() {
    match
      @tanikun-domain.Override::new(
        @tanikun-domain.OverrideTarget::Course(form.course_id),
        @tanikun-domain.OverrideAttribute::DisplayName,
        @tanikun-domain.OverrideValue::Text(form.name),
      ) {
      Ok(value) => entries.push(value)
      Err(error) =>
        return override_form_error(
          state,
          form,
          Name,
          UiError::from_domain(
            error,
            UiErrorTarget::Course(course_id=form.course_id),
          ).message,
        )
    }
  }
  if !form.credits.is_empty() {
    let half_units = match option_int(form.credits, 1, 20) {
      Some(value) => value
      None =>
        return override_form_error(
          state,
          form,
          Credits,
          "単位数が正しくありません",
        )
    }
    let credits = match @tanikun-domain.Credits::new(half_units) {
      Ok(value) => value
      Err(_) =>
        return override_form_error(
          state,
          form,
          Credits,
          "単位数が正しくありません",
        )
    }
    match
      @tanikun-domain.Override::new(
        @tanikun-domain.OverrideTarget::Course(form.course_id),
        @tanikun-domain.OverrideAttribute::Credits,
        @tanikun-domain.OverrideValue::Credits(credits),
      ) {
      Ok(value) => entries.push(value)
      Err(error) =>
        return override_form_error(
          state,
          form,
          Credits,
          UiError::from_domain(
            error,
            UiErrorTarget::Course(course_id=form.course_id),
          ).message,
        )
    }
  }
  if form.slots_enabled {
    if !form.supports_slots {
      return override_form_error(
        state,
        form,
        Slots,
        "この開講では曜限を変更できません",
      )
    }
    let day = form.day
    let period = form.period
    match
      @tanikun-domain.Override::new(
        @tanikun-domain.OverrideTarget::Offering(form.offering_id),
        @tanikun-domain.OverrideAttribute::Slots,
        @tanikun-domain.OverrideValue::Slots([
          @tanikun-domain.Slot::new(day, period),
        ]),
      ) {
      Ok(value) => entries.push(value)
      Err(error) =>
        return override_form_error(
          state,
          form,
          Slots,
          UiError::from_domain(
            error,
            UiErrorTarget::Offering(offering_id=form.offering_id),
          ).message,
        )
    }
  }
  let overrides = match @tanikun-domain.Overrides::new(entries) {
    Ok(value) => value
    Err(error) =>
      return override_form_error(
        state,
        form,
        General,
        UiError::from_domain(
          error,
          UiErrorTarget::Offering(offering_id=form.offering_id),
        ).message,
      )
  }
  match @tanikun-domain.effective_slots(offering, overrides) {
    Ok(_) => ()
    Err(error) =>
      return override_form_error(
        state,
        form,
        Slots,
        UiError::from_domain(
          error,
          UiErrorTarget::Offering(offering_id=form.offering_id),
        ).message,
      )
  }
  let passed = state.enrollment_is_passed(form.offering_id)
  if !passed && has_enrollment(state.enrollments, form.offering_id) {
    match
      find_slot_conflict_with_overrides(
        state,
        offering,
        overrides,
        Some(form.offering_id),
      ) {
      Some(_) =>
        return override_form_error(
          state,
          form,
          Slots,
          "他の履修と曜限が重複しています",
        )
      None => ()
    }
  }
  bump({
    ..state,
    overrides,
    override_form: None,
    selected_offering: Some(form.offering_id),
    error: None,
  })
}

///|
