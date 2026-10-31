///|
fn new_custom_course_draft(state : PlannerState) -> CustomCourseDraft {
  let year = state.timetable_year.academic_year.year()
  let term = match state.selected_term.term() {
    Some(value) => value
    None => @tanikun-domain.Term::S1
  }
  let term_label = match term {
    @tanikun-domain.Term::S1 => "S1"
    @tanikun-domain.Term::S2 => "S2"
    @tanikun-domain.Term::A1 => "A1"
    @tanikun-domain.Term::A2 => "A2"
  }
  let base : CustomCourseDraft = {
    name: "",
    credits: "4",
    category: "",
    academic_year: "\{year}",
    schedule: CustomCourseSchedule::Regular,
    term: term_label,
    terms: [planner_term_for_regular(term)],
    day: "1",
    period: "4",
    editing_course_id: None,
    editing_offering_id: None,
    return_picker: state.picker,
    error_field: None,
    error_message: "",
  }
  match state.picker {
    Some(PickerTarget::Slot(day~, period~)) =>
      { ..base, day: custom_day_value(day), period: "\{period}", }
    Some(PickerTarget::Intensive) =>
      {
        ..base,
        schedule: CustomCourseSchedule::Intensive,
        term: custom_semester_value(state.selected_term.semester()),
        terms: [],
      }
    Some(PickerTarget::All) =>
      if state.selected_term == W {
        {
          ..base,
          schedule: CustomCourseSchedule::Intensive,
          term: "W",
          terms: [],
        }
      } else {
        base
      }
    None => base
  }
}

///|
fn update_custom_course_field(
  state : PlannerState,
  field : CustomCourseField,
  value : String,
) -> PlannerState {
  match state.custom_form {
    None => state
    Some(form) => {
      let next = match field {
        Name => { ..form, name: value, }
        Credits => { ..form, credits: value, }
        Category => { ..form, category: value, }
        Year => { ..form, academic_year: value, }
        Schedule => {
          let schedule = match value {
            "year-long" => CustomCourseSchedule::YearLong
            "intensive" => CustomCourseSchedule::Intensive
            _ => CustomCourseSchedule::Regular
          }
          {
            ..form,
            schedule,
            term: if schedule == CustomCourseSchedule::Intensive {
              "S"
            } else {
              "S1"
            },
          }
        }
        Term => { ..form, term: value, }
        Day => { ..form, day: value, }
        Period => { ..form, period: value, }
      }
      bump({
        ..state,
        custom_form: Some({ ..next, error_field: None, error_message: "", }),
        error: None,
      })
    }
  }
}

///|
fn custom_course_error(
  state : PlannerState,
  form : CustomCourseDraft,
  field : CustomCourseField,
  message : String,
) -> PlannerState {
  bump({
    ..state,
    custom_form: Some({
      ..form,
      error_field: Some(field),
      error_message: message,
    }),
  })
}

///|
fn option_int(value : String, min : Int, max : Int) -> Int? {
  let mut current = min
  while current <= max {
    if value == "\{current}" {
      return Some(current)
    }
    current += 1
  }
  None
}

///|
fn custom_day(value : String) -> @tanikun-domain.DayOfWeek? {
  match option_int(value, 0, 6) {
    Some(0) => Some(@tanikun-domain.DayOfWeek::Monday)
    Some(1) => Some(@tanikun-domain.DayOfWeek::Tuesday)
    Some(2) => Some(@tanikun-domain.DayOfWeek::Wednesday)
    Some(3) => Some(@tanikun-domain.DayOfWeek::Thursday)
    Some(4) => Some(@tanikun-domain.DayOfWeek::Friday)
    Some(5) => Some(@tanikun-domain.DayOfWeek::Saturday)
    Some(6) => Some(@tanikun-domain.DayOfWeek::Sunday)
    _ => None
  }
}

///|
fn custom_semester(value : String) -> @tanikun-domain.Semester? {
  match value {
    "S" => Some(@tanikun-domain.Semester::S)
    "A" => Some(@tanikun-domain.Semester::A)
    "W" => Some(@tanikun-domain.Semester::W)
    _ => None
  }
}

///|
fn planner_term_for_regular(term : @tanikun-domain.Term) -> PlannerTerm {
  match term {
    @tanikun-domain.Term::S1 => S1
    @tanikun-domain.Term::S2 => S2
    @tanikun-domain.Term::A1 => A1
    @tanikun-domain.Term::A2 => A2
  }
}

///|
fn planner_term_for_semester(
  semester : @tanikun-domain.Semester,
) -> PlannerTerm {
  match semester {
    @tanikun-domain.Semester::S => S1
    @tanikun-domain.Semester::A => A1
    @tanikun-domain.Semester::W => W
  }
}

///|
fn submit_custom_course(state : PlannerState) -> PlannerState {
  let form = match state.custom_form {
    Some(form) => form
    None => return state
  }
  let credits_half_units = match option_int(form.credits, 1, 20) {
    Some(value) => value
    None =>
      return custom_course_error(
        state,
        form,
        Credits,
        "単位数が正しくありません",
      )
  }
  let credits = match @tanikun-domain.Credits::new(credits_half_units) {
    Ok(credits) => credits
    Err(_) =>
      return custom_course_error(
        state,
        form,
        Credits,
        "単位数が正しくありません",
      )
  }
  let year = match option_int(form.academic_year, 2000, 2100) {
    Some(year) => year
    None =>
      return custom_course_error(
        state,
        form,
        Year,
        "年度が正しくありません",
      )
  }
  let academic_year = match @tanikun-domain.AcademicYear::new(year) {
    Ok(value) => value
    Err(_) =>
      return custom_course_error(
        state,
        form,
        Year,
        "年度が正しくありません",
      )
  }
  let editing = form.editing_course_id is Some(_)
  let course_id = match form.editing_course_id {
    Some(id) => id
    None =>
      match
        @tanikun-domain.CourseId::new(
          "user",
          "course-\{state.custom_id_prefix}\{state.next_custom_course_number}",
        ) {
        Ok(id) => id
        Err(_) =>
          return custom_course_error(
            state,
            form,
            Name,
            "科目IDを作成できません",
          )
      }
  }
  let offering_id = match form.editing_offering_id {
    Some(id) => id
    None =>
      match
        @tanikun-domain.OfferingId::new(
          "user-offering-\{state.custom_id_prefix}\{state.next_custom_course_number}",
        ) {
        Ok(id) => id
        Err(_) =>
          return custom_course_error(
            state,
            form,
            Schedule,
            "開講IDを作成できません",
          )
      }
  }
  if editing && !state.is_custom_course(course_id) {
    return custom_course_error(
      state,
      form,
      Schedule,
      "独自科目ではありません",
    )
  }
  if editing && find_offering(state.offerings, offering_id) is None {
    return custom_course_error(
      state,
      form,
      Schedule,
      "開講が見つかりません",
    )
  }
  let category = if form.category.is_empty() {
    None
  } else {
    let found = match state.active_requirement_set() {
      Some(set) => {
        let mut value = None
        for item in set.categories() {
          if item.id.value == form.category {
            value = Some(item.id)
          }
        }
        value
      }
      None => None
    }
    match found {
      Some(value) => Some(value)
      None =>
        return custom_course_error(
          state,
          form,
          Category,
          "区分が正しくありません",
        )
    }
  }
  let course = match
    @tanikun-domain.Course::new(
      course_id,
      form.name,
      credits,
      @tanikun-domain.CourseStatus::Active,
    ) {
    Ok(value) => value
    Err(_) =>
      return custom_course_error(
        state,
        form,
        Name,
        "科目名を入力してください",
      )
  }
  let regular_terms : Array[@tanikun-domain.Term] = []
  for item in form.terms {
    match item {
      S1 => regular_terms.push(@tanikun-domain.Term::S1)
      S2 => regular_terms.push(@tanikun-domain.Term::S2)
      A1 => regular_terms.push(@tanikun-domain.Term::A1)
      A2 => regular_terms.push(@tanikun-domain.Term::A2)
      W => ()
    }
  }
  let schedule = if form.schedule == CustomCourseSchedule::Intensive {
    let semester = match custom_semester(form.term) {
      Some(value) => value
      None =>
        return custom_course_error(
          state,
          form,
          Term,
          "セメスターを選択してください",
        )
    }
    @tanikun-domain.OfferingSchedule::Intensive(semester~)
  } else if form.schedule == CustomCourseSchedule::YearLong {
    @tanikun-domain.OfferingSchedule::YearLong
  } else {
    if regular_terms.is_empty() {
      return custom_course_error(
        state,
        form,
        Term,
        "学期を選択してください",
      )
    }
    let semester = regular_terms[0].semester()
    for term in regular_terms {
      if term.semester() != semester {
        return custom_course_error(
          state,
          form,
          Term,
          "同じセメスターの学期を選んでください",
        )
      }
    }
    @tanikun-domain.OfferingSchedule::Regular(terms=regular_terms)
  }
  let slots = if form.schedule == CustomCourseSchedule::Intensive {
    []
  } else {
    let day = match custom_day(form.day) {
      Some(value) => value
      None =>
        return custom_course_error(
          state,
          form,
          Day,
          "曜日を選択してください",
        )
    }
    let period = match option_int(form.period, 1, 10) {
      Some(value) => value
      None =>
        return custom_course_error(
          state,
          form,
          Period,
          "時限を選択してください",
        )
    }
    let period = match @tanikun-domain.Period::new(period) {
      Ok(value) => value
      Err(_) =>
        return custom_course_error(
          state,
          form,
          Period,
          "時限を選択してください",
        )
    }
    [@tanikun-domain.Slot::new(day, period)]
  }
  let offering = match
    @tanikun-domain.CourseOffering::new(
      offering_id,
      course.id,
      academic_year,
      schedule,
      @tanikun-domain.OfferingStatus::Offered,
      slots,
    ) {
    Ok(value) => value
    Err(_) =>
      return custom_course_error(
        state,
        form,
        Schedule,
        "開講情報が正しくありません",
      )
  }
  if editing && has_enrollment(state.enrollments, offering_id) {
    match find_slot_conflict_excluding(state, offering, offering_id) {
      Some(_) =>
        return custom_course_error(
          state,
          form,
          Schedule,
          "他の履修と曜限が重複しています",
        )
      None => ()
    }
  }
  let selected_term = match offering.schedule() {
    @tanikun-domain.OfferingSchedule::Regular(terms~) =>
      planner_term_for_regular(terms[0])
    @tanikun-domain.OfferingSchedule::YearLong =>
      if state.selected_term == W {
        S1
      } else {
        state.selected_term
      }
    @tanikun-domain.OfferingSchedule::Intensive(semester~) =>
      planner_term_for_semester(semester)
  }
  let catalogue : Array[@tanikun-domain.Course] = []
  let offerings : Array[@tanikun-domain.CourseOffering] = []
  let custom_course_ids = state.custom_course_ids.copy()
  if editing {
    for item in state.catalogue {
      if item.id == course_id {
        catalogue.push(course)
      } else {
        catalogue.push(item)
      }
    }
    for item in state.offerings {
      if item.id == offering_id {
        offerings.push(offering)
      } else {
        offerings.push(item)
      }
    }
  } else {
    for item in state.catalogue {
      catalogue.push(item)
    }
    catalogue.push(course)
    for item in state.offerings {
      offerings.push(item)
    }
    offerings.push(offering)
    custom_course_ids.push(course.id)
  }
  let custom_categories = []
  for item in state.custom_categories {
    if item.0 != course_id {
      custom_categories.push(item)
    }
  }
  match category {
    Some(value) => custom_categories.push((course_id, value))
    None => ()
  }
  bump({
    ..state,
    catalogue,
    offerings,
    selected_term,
    selected_offering: None,
    custom_form: None,
    custom_course_ids,
    custom_categories,
    next_custom_course_number: if editing {
      state.next_custom_course_number
    } else {
      state.next_custom_course_number + 1
    },
    picker: form.return_picker,
    catalogue_query: "",
    error: None,
  })
}

///|
fn toggle_custom_term(state : PlannerState, term : PlannerTerm) -> PlannerState {
  match state.custom_form {
    None => state
    Some(form) => {
      let terms : Array[PlannerTerm] = []
      let mut found = false
      for item in form.terms {
        if item == term {
          found = true
        } else {
          terms.push(item)
        }
      }
      if !found {
        terms.push(term)
      }
      bump({
        ..state,
        custom_form: Some({
          ..form,
          terms,
          error_field: None,
          error_message: "",
        }),
        error: None,
      })
    }
  }
}

///|
fn custom_day_value(day : @tanikun-domain.DayOfWeek) -> String {
  match day {
    @tanikun-domain.DayOfWeek::Monday => "0"
    @tanikun-domain.DayOfWeek::Tuesday => "1"
    @tanikun-domain.DayOfWeek::Wednesday => "2"
    @tanikun-domain.DayOfWeek::Thursday => "3"
    @tanikun-domain.DayOfWeek::Friday => "4"
    @tanikun-domain.DayOfWeek::Saturday => "5"
    @tanikun-domain.DayOfWeek::Sunday => "6"
  }
}

///|
fn custom_semester_value(semester : @tanikun-domain.Semester) -> String {
  match semester {
    @tanikun-domain.Semester::S => "S"
    @tanikun-domain.Semester::A => "A"
    @tanikun-domain.Semester::W => "W"
  }
}

///|
fn open_edit_custom_course(
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
  if !state.is_custom_course(offering.course_id) {
    return with_error(
      state,
      UiError::new(
        UiErrorTarget::Course(course_id=offering.course_id),
        UiErrorKind::General,
        "独自科目ではありません",
      ),
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
  let (schedule, term, terms) = match offering.schedule() {
    @tanikun-domain.OfferingSchedule::Regular(terms=domain_terms) => {
      let selected : Array[PlannerTerm] = []
      for item in domain_terms {
        selected.push(planner_term_for_regular(item))
      }
      (CustomCourseSchedule::Regular, "S1", selected)
    }
    @tanikun-domain.OfferingSchedule::YearLong =>
      (CustomCourseSchedule::YearLong, "S1", [])
    @tanikun-domain.OfferingSchedule::Intensive(semester~) =>
      (CustomCourseSchedule::Intensive, custom_semester_value(semester), [])
  }
  let slots = offering.slots()
  let (day, period) = if slots.is_empty() {
    ("1", "4")
  } else {
    (custom_day_value(slots[0].day), "\{slots[0].period.value()}")
  }
  let form : CustomCourseDraft = {
    name: course.name,
    credits: "\{course.credits.half_units()}",
    category: match state.category_id_for_course(course.id) {
      Some(value) => value.value
      None => ""
    },
    academic_year: "\{offering.academic_year.year()}",
    schedule,
    term,
    terms,
    day,
    period,
    editing_course_id: Some(course.id),
    editing_offering_id: Some(offering.id),
    return_picker: state.picker,
    error_field: None,
    error_message: "",
  }
  bump({
    ..state,
    custom_form: Some(form),
    selected_offering: None,
    picker: None,
    error: None,
  })
}

///|
fn delete_custom_course(
  state : PlannerState,
  course_id : @tanikun-domain.CourseId,
) -> PlannerState {
  if !state.is_custom_course(course_id) {
    return with_error(
      state,
      UiError::new(
        UiErrorTarget::Course(course_id~),
        UiErrorKind::General,
        "独自科目ではありません",
      ),
    )
  }
  let offerings : Array[@tanikun-domain.CourseOffering] = []
  for offering in state.offerings {
    if offering.course_id != course_id {
      offerings.push(offering)
    }
  }
  for enrollment in state.enrollments {
    for offering in state.offerings {
      if offering.course_id == course_id &&
        offering.id == enrollment.offering_id {
        return with_error(
          state,
          UiError::new(
            UiErrorTarget::Course(course_id~),
            UiErrorKind::General,
            "履修中の独自科目は削除できません",
          ),
        )
      }
    }
  }
  let catalogue : Array[@tanikun-domain.Course] = []
  for course in state.catalogue {
    if course.id != course_id {
      catalogue.push(course)
    }
  }
  let custom_course_ids : Array[@tanikun-domain.CourseId] = []
  for id in state.custom_course_ids {
    if id != course_id {
      custom_course_ids.push(id)
    }
  }
  let custom_categories = []
  for item in state.custom_categories {
    if item.0 != course_id {
      custom_categories.push(item)
    }
  }
  let entries = state.overrides
    .entries()
    .filter(entry => {
      match entry.target {
        @tanikun-domain.OverrideTarget::Course(id) => id != course_id
        @tanikun-domain.OverrideTarget::Offering(id) =>
          !state.offerings.any(offering => {
            offering.course_id == course_id && offering.id == id
          })
      }
    })
  let overrides = match @tanikun-domain.Overrides::new(entries) {
    Ok(value) => value
    Err(error) =>
      return with_error(
        state,
        UiError::from_domain(error, UiErrorTarget::Course(course_id~)),
      )
  }
  let picker = match state.custom_form {
    Some(form) => form.return_picker
    None => None
  }
  bump({
    ..state,
    catalogue,
    offerings,
    overrides,
    custom_course_ids,
    custom_categories,
    selected_offering: None,
    custom_form: None,
    picker,
    error: None,
  })
}

///|
