///|
type DecodeCourseResult = Result[@tanikun-domain.Course, String]

///|
type DecodeOfferingResult = Result[@tanikun-domain.CourseOffering, String]

///|
type DecodeEnrollmentResult = Result[@tanikun-domain.Enrollment, String]

///|
type DecodeOverrideResult = Result[@tanikun-domain.Override, String]

///|
fn persisted_course_id(id : @tanikun-domain.CourseId) -> PersistedCourseId {
  { namespace_part: id.namespace_part, local_part: id.local_part, }
}

///|
fn decode_course_id(
  dto : PersistedCourseId,
) -> Result[@tanikun-domain.CourseId, String] {
  match @tanikun-domain.CourseId::new(dto.namespace_part, dto.local_part) {
    Ok(value) => Ok(value)
    Err(_) => Err("科目IDが正しくありません")
  }
}

///|
fn persisted_slot(slot : @tanikun-domain.Slot) -> PersistedSlot {
  { day: day_code(slot.day), period: slot.period.value(), }
}

///|
fn decode_slot(dto : PersistedSlot) -> Result[@tanikun-domain.Slot, String] {
  let day = match day_from_code(dto.day) {
    Some(value) => value
    None => return Err("曜日が正しくありません")
  }
  let period = match @tanikun-domain.Period::new(dto.period) {
    Ok(value) => value
    Err(_) => return Err("時限が正しくありません")
  }
  Ok(@tanikun-domain.Slot::new(day, period))
}

///|
fn persisted_slots(slots : Array[@tanikun-domain.Slot]) -> Array[PersistedSlot] {
  let result = []
  for slot in slots {
    result.push(persisted_slot(slot))
  }
  result
}

///|
fn decode_slots(
  slots : Array[PersistedSlot],
) -> Result[Array[@tanikun-domain.Slot], String] {
  let result = []
  for slot in slots {
    match decode_slot(slot) {
      Ok(value) => result.push(value)
      Err(error) => return Err(error)
    }
  }
  Ok(result)
}

///|
fn day_code(day : @tanikun-domain.DayOfWeek) -> String {
  match day {
    @tanikun-domain.DayOfWeek::Monday => "Monday"
    @tanikun-domain.DayOfWeek::Tuesday => "Tuesday"
    @tanikun-domain.DayOfWeek::Wednesday => "Wednesday"
    @tanikun-domain.DayOfWeek::Thursday => "Thursday"
    @tanikun-domain.DayOfWeek::Friday => "Friday"
    @tanikun-domain.DayOfWeek::Saturday => "Saturday"
    @tanikun-domain.DayOfWeek::Sunday => "Sunday"
  }
}

///|
fn day_from_code(value : String) -> @tanikun-domain.DayOfWeek? {
  match value {
    "Monday" => Some(@tanikun-domain.DayOfWeek::Monday)
    "Tuesday" => Some(@tanikun-domain.DayOfWeek::Tuesday)
    "Wednesday" => Some(@tanikun-domain.DayOfWeek::Wednesday)
    "Thursday" => Some(@tanikun-domain.DayOfWeek::Thursday)
    "Friday" => Some(@tanikun-domain.DayOfWeek::Friday)
    "Saturday" => Some(@tanikun-domain.DayOfWeek::Saturday)
    "Sunday" => Some(@tanikun-domain.DayOfWeek::Sunday)
    _ => None
  }
}

///|
fn term_code(term : @tanikun-domain.Term) -> String {
  match term {
    @tanikun-domain.Term::S1 => "S1"
    @tanikun-domain.Term::S2 => "S2"
    @tanikun-domain.Term::A1 => "A1"
    @tanikun-domain.Term::A2 => "A2"
  }
}

///|
fn term_from_code(value : String) -> @tanikun-domain.Term? {
  match value {
    "S1" => Some(@tanikun-domain.Term::S1)
    "S2" => Some(@tanikun-domain.Term::S2)
    "A1" => Some(@tanikun-domain.Term::A1)
    "A2" => Some(@tanikun-domain.Term::A2)
    _ => None
  }
}

///|
fn semester_code(semester : @tanikun-domain.Semester) -> String {
  match semester {
    @tanikun-domain.Semester::S => "S"
    @tanikun-domain.Semester::A => "A"
    @tanikun-domain.Semester::W => "W"
  }
}

///|
fn semester_from_code(value : String) -> @tanikun-domain.Semester? {
  match value {
    "S" => Some(@tanikun-domain.Semester::S)
    "A" => Some(@tanikun-domain.Semester::A)
    "W" => Some(@tanikun-domain.Semester::W)
    _ => None
  }
}

///|
fn course_status_code(status : @tanikun-domain.CourseStatus) -> String {
  match status {
    @tanikun-domain.CourseStatus::Active => "active"
    @tanikun-domain.CourseStatus::Retired => "retired"
  }
}

///|
fn course_status_from_code(value : String) -> @tanikun-domain.CourseStatus? {
  match value {
    "active" => Some(@tanikun-domain.CourseStatus::Active)
    "retired" => Some(@tanikun-domain.CourseStatus::Retired)
    _ => None
  }
}

///|
fn offering_status_code(status : @tanikun-domain.OfferingStatus) -> String {
  match status {
    @tanikun-domain.OfferingStatus::Offered => "offered"
    @tanikun-domain.OfferingStatus::NotOffered => "not-offered"
  }
}

///|
fn offering_status_from_code(value : String) -> @tanikun-domain.OfferingStatus? {
  match value {
    "offered" => Some(@tanikun-domain.OfferingStatus::Offered)
    "not-offered" => Some(@tanikun-domain.OfferingStatus::NotOffered)
    _ => None
  }
}

///|
fn schedule_code(schedule : @tanikun-domain.OfferingSchedule) -> String {
  match schedule {
    @tanikun-domain.OfferingSchedule::Regular(_) => "regular"
    @tanikun-domain.OfferingSchedule::YearLong => "year-long"
    @tanikun-domain.OfferingSchedule::Intensive(_) => "intensive"
  }
}

///|
fn passing_grade_code(grade : @tanikun-domain.PassingGrade) -> String {
  match grade {
    @tanikun-domain.PassingGrade::ExcellentPlus => "excellent-plus"
    @tanikun-domain.PassingGrade::Excellent => "excellent"
    @tanikun-domain.PassingGrade::Good => "good"
    @tanikun-domain.PassingGrade::Fair => "fair"
    @tanikun-domain.PassingGrade::Pass => "pass"
  }
}

///|
fn passing_grade_from_code(value : String) -> @tanikun-domain.PassingGrade? {
  match value {
    "excellent-plus" => Some(@tanikun-domain.PassingGrade::ExcellentPlus)
    "excellent" => Some(@tanikun-domain.PassingGrade::Excellent)
    "good" => Some(@tanikun-domain.PassingGrade::Good)
    "fair" => Some(@tanikun-domain.PassingGrade::Fair)
    "pass" => Some(@tanikun-domain.PassingGrade::Pass)
    _ => None
  }
}

///|
fn failing_grade_code(grade : @tanikun-domain.FailingGrade) -> String {
  match grade {
    @tanikun-domain.FailingGrade::Fail => "fail"
    @tanikun-domain.FailingGrade::NotPassed => "not-passed"
  }
}

///|
fn failing_grade_from_code(value : String) -> @tanikun-domain.FailingGrade? {
  match value {
    "fail" => Some(@tanikun-domain.FailingGrade::Fail)
    "not-passed" => Some(@tanikun-domain.FailingGrade::NotPassed)
    _ => None
  }
}

///|
fn planner_term_code(term : PlannerTerm) -> String {
  match term {
    S1 => "S1"
    S2 => "S2"
    A1 => "A1"
    A2 => "A2"
    W => "W"
  }
}

///|
fn planner_term_from_code(value : String) -> PlannerTerm? {
  match value {
    "S1" => Some(S1)
    "S2" => Some(S2)
    "A1" => Some(A1)
    "A2" => Some(A2)
    "W" => Some(W)
    _ => None
  }
}

///|
fn persisted_offering(
  offering : @tanikun-domain.CourseOffering,
) -> PersistedOffering {
  let terms = match offering.schedule() {
    @tanikun-domain.OfferingSchedule::Regular(terms~) => {
      let result = []
      for term in terms {
        result.push(term_code(term))
      }
      result
    }
    _ => []
  }
  let semester = match offering.schedule() {
    @tanikun-domain.OfferingSchedule::Intensive(semester~) =>
      semester_code(semester)
    _ => ""
  }
  let phases = []
  for phase in offering.term_slots() {
    phases.push({ term: term_code(phase.0), slots: persisted_slots(phase.1), })
  }
  let allocation = offering.coordinated_allocation
  let coordinated_group = match allocation {
    Some(value) => value.group
    None => ""
  }
  let coordinated_source = match allocation {
    Some(value) => value.source
    None => ""
  }
  {
    id: offering.id.value,
    course_id: persisted_course_id(offering.course_id),
    academic_year: offering.academic_year.year(),
    schedule: schedule_code(offering.schedule()),
    terms,
    semester,
    status: offering_status_code(offering.status),
    slots: persisted_slots(offering.slots()),
    term_slots: phases,
    coordinated_group,
    coordinated_source,
  }
}

///|
fn decode_course(dto : PersistedCourse) -> DecodeCourseResult {
  let id = match decode_course_id(dto.id) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  let credits = match @tanikun-domain.Credits::new(dto.credits) {
    Ok(value) => value
    Err(_) => return Err("単位数が正しくありません")
  }
  let status = match course_status_from_code(dto.status) {
    Some(value) => value
    None => return Err("科目状態が正しくありません")
  }
  match @tanikun-domain.Course::new(id, dto.name, credits, status) {
    Ok(value) => Ok(value)
    Err(_) => Err("科目が正しくありません")
  }
}

///|
fn decode_offering(dto : PersistedOffering) -> DecodeOfferingResult {
  let id = match @tanikun-domain.OfferingId::new(dto.id) {
    Ok(value) => value
    Err(_) => return Err("開講IDが正しくありません")
  }
  let course_id = match decode_course_id(dto.course_id) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  let year = match @tanikun-domain.AcademicYear::new(dto.academic_year) {
    Ok(value) => value
    Err(_) => return Err("年度が正しくありません")
  }
  let status = match offering_status_from_code(dto.status) {
    Some(value) => value
    None => return Err("開講状態が正しくありません")
  }
  let slots = match decode_slots(dto.slots) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  let schedule = match dto.schedule {
    "regular" => {
      let terms = []
      for term in dto.terms {
        match term_from_code(term) {
          Some(value) => terms.push(value)
          None => return Err("学期が正しくありません")
        }
      }
      @tanikun-domain.OfferingSchedule::Regular(terms~)
    }
    "year-long" => @tanikun-domain.OfferingSchedule::YearLong
    "intensive" => {
      let semester = match semester_from_code(dto.semester) {
        Some(value) => value
        None => return Err("セメスターが正しくありません")
      }
      @tanikun-domain.OfferingSchedule::Intensive(semester~)
    }
    _ => return Err("開講形態が正しくありません")
  }
  let offering = match
    @tanikun-domain.CourseOffering::new(
      id, course_id, year, schedule, status, slots,
    ) {
    Ok(value) => value
    Err(_) => return Err("開講情報が正しくありません")
  }
  let phases = []
  for phase in dto.term_slots {
    let term = match term_from_code(phase.term) {
      Some(value) => value
      None => return Err("学期が正しくありません")
    }
    let phase_slots = match decode_slots(phase.slots) {
      Ok(value) => value
      Err(error) => return Err(error)
    }
    phases.push((term, phase_slots))
  }
  let offering = if phases.is_empty() {
    offering
  } else {
    match offering.with_term_slots(phases) {
      Ok(value) => value
      Err(_) => return Err("学期別の授業枠が正しくありません")
    }
  }
  if !dto.coordinated_group.is_empty() || !dto.coordinated_source.is_empty() {
    let allocation = match
      @tanikun-domain.CoordinatedAllocation::new(
        dto.coordinated_group,
        dto.coordinated_source,
      ) {
      Ok(value) => value
      Err(_) => return Err("共用枠の確認元が正しくありません")
    }
    Ok(offering.with_coordinated_allocation(allocation))
  } else {
    Ok(offering)
  }
}

///|
fn persisted_enrollment(
  enrollment : @tanikun-domain.Enrollment,
) -> PersistedEnrollment {
  let (status, passing, failing, snapshot) = match enrollment.status {
    @tanikun-domain.EnrollmentStatus::Planned =>
      (
        "planned",
        "",
        "",
        {
          course_id: { namespace_part: "", local_part: "", },
          name: "",
          credits: 0,
        },
      )
    @tanikun-domain.EnrollmentStatus::InProgress =>
      (
        "in-progress",
        "",
        "",
        {
          course_id: { namespace_part: "", local_part: "", },
          name: "",
          credits: 0,
        },
      )
    @tanikun-domain.EnrollmentStatus::Confirmed(grade) =>
      match grade {
        @tanikun-domain.ConfirmedGrade::Passed(grade~, snapshot~) =>
          (
            "passed",
            passing_grade_code(grade),
            "",
            {
              course_id: persisted_course_id(snapshot.course_id),
              name: snapshot.name,
              credits: snapshot.credits.half_units(),
            },
          )
        @tanikun-domain.ConfirmedGrade::Failed(grade~) =>
          (
            "failed",
            "",
            failing_grade_code(grade),
            {
              course_id: { namespace_part: "", local_part: "", },
              name: "",
              credits: 0,
            },
          )
        @tanikun-domain.ConfirmedGrade::NotTaken =>
          (
            "not-taken",
            "",
            "",
            {
              course_id: { namespace_part: "", local_part: "", },
              name: "",
              credits: 0,
            },
          )
      }
  }
  {
    offering_id: enrollment.offering_id.value,
    status,
    passing_grade: passing,
    failing_grade: failing,
    snapshot,
  }
}

///|
fn decode_enrollment(dto : PersistedEnrollment) -> DecodeEnrollmentResult {
  let offering_id = match @tanikun-domain.OfferingId::new(dto.offering_id) {
    Ok(value) => value
    Err(_) => return Err("開講IDが正しくありません")
  }
  let status = match dto.status {
    "planned" => @tanikun-domain.EnrollmentStatus::Planned
    "in-progress" => @tanikun-domain.EnrollmentStatus::InProgress
    "passed" => {
      let grade = match passing_grade_from_code(dto.passing_grade) {
        Some(value) => value
        None => return Err("成績が正しくありません")
      }
      let course_id = match decode_course_id(dto.snapshot.course_id) {
        Ok(value) => value
        Err(error) => return Err(error)
      }
      let credits = match @tanikun-domain.Credits::new(dto.snapshot.credits) {
        Ok(value) => value
        Err(_) => return Err("単位数が正しくありません")
      }
      let snapshot = match
        @tanikun-domain.PassedCourseSnapshot::new(
          course_id,
          dto.snapshot.name,
          credits,
        ) {
        Ok(value) => value
        Err(_) =>
          return Err(
            "合格時スナップショットが正しくありません",
          )
      }
      @tanikun-domain.EnrollmentStatus::Confirmed(
        @tanikun-domain.ConfirmedGrade::Passed(grade~, snapshot~),
      )
    }
    "failed" => {
      let grade = match failing_grade_from_code(dto.failing_grade) {
        Some(value) => value
        None => return Err("成績が正しくありません")
      }
      @tanikun-domain.EnrollmentStatus::Confirmed(
        @tanikun-domain.ConfirmedGrade::Failed(grade~),
      )
    }
    "not-taken" =>
      @tanikun-domain.EnrollmentStatus::Confirmed(
        @tanikun-domain.ConfirmedGrade::NotTaken,
      )
    _ => return Err("履修状態が正しくありません")
  }
  Ok(@tanikun-domain.Enrollment::new(offering_id, status))
}

///|
fn persisted_override(entry : @tanikun-domain.Override) -> PersistedOverride {
  let (target_kind, course_namespace, course_local, offering_id) = match
    entry.target {
    @tanikun-domain.OverrideTarget::Course(id) =>
      ("course", id.namespace_part, id.local_part, "")
    @tanikun-domain.OverrideTarget::Offering(id) =>
      ("offering", "", "", id.value)
  }
  let value_kind = match entry.attribute {
    @tanikun-domain.OverrideAttribute::DisplayName => "text"
    @tanikun-domain.OverrideAttribute::Credits => "credits"
    @tanikun-domain.OverrideAttribute::Slots => "slots"
  }
  let text = match entry.text() {
    Some(value) => value
    None => ""
  }
  let credits = match entry.credits() {
    Some(value) => value.half_units()
    None => 0
  }
  let slots = match entry.slots() {
    Some(value) => persisted_slots(value)
    None => []
  }
  {
    target_kind,
    course_namespace,
    course_local,
    offering_id,
    value_kind,
    text,
    credits,
    slots,
  }
}

///|
fn decode_override(dto : PersistedOverride) -> DecodeOverrideResult {
  let target = match dto.target_kind {
    "course" => {
      let id = match
        @tanikun-domain.CourseId::new(dto.course_namespace, dto.course_local) {
        Ok(value) => value
        Err(_) => return Err("科目IDが正しくありません")
      }
      @tanikun-domain.OverrideTarget::Course(id)
    }
    "offering" => {
      let id = match @tanikun-domain.OfferingId::new(dto.offering_id) {
        Ok(value) => value
        Err(_) => return Err("開講IDが正しくありません")
      }
      @tanikun-domain.OverrideTarget::Offering(id)
    }
    _ => return Err("上書き対象が正しくありません")
  }
  let (attribute, value) = match dto.value_kind {
    "text" =>
      (
        @tanikun-domain.OverrideAttribute::DisplayName,
        @tanikun-domain.OverrideValue::Text(dto.text),
      )
    "credits" => {
      let credits = match @tanikun-domain.Credits::new(dto.credits) {
        Ok(value) => value
        Err(_) => return Err("単位数が正しくありません")
      }
      (
        @tanikun-domain.OverrideAttribute::Credits,
        @tanikun-domain.OverrideValue::Credits(credits),
      )
    }
    "slots" => {
      let slots = match decode_slots(dto.slots) {
        Ok(value) => value
        Err(error) => return Err(error)
      }
      (
        @tanikun-domain.OverrideAttribute::Slots,
        @tanikun-domain.OverrideValue::Slots(slots),
      )
    }
    _ => return Err("上書き値が正しくありません")
  }
  match @tanikun-domain.Override::new(target, attribute, value) {
    Ok(value) => Ok(value)
    Err(_) => Err("上書きが正しくありません")
  }
}

///|
fn persisted_plan(state : PlannerState) -> PersistedPlan {
  let catalogue = []
  for course in state.catalogue {
    catalogue.push({
      id: persisted_course_id(course.id),
      name: course.name,
      credits: course.credits.half_units(),
      status: course_status_code(course.status),
    })
  }
  let offerings = []
  for offering in state.offerings {
    offerings.push(persisted_offering(offering))
  }
  let enrollments = []
  for enrollment in state.enrollments {
    enrollments.push(persisted_enrollment(enrollment))
  }
  let overrides = []
  for entry in state.overrides.entries() {
    overrides.push(persisted_override(entry))
  }
  let custom_ids = []
  for id in state.custom_course_ids {
    custom_ids.push(persisted_course_id(id))
  }
  let custom_categories = []
  for assignment in state.custom_categories {
    custom_categories.push({
      course: persisted_course_id(assignment.0),
      category: assignment.1.value,
    })
  }
  {
    version: 1,
    catalogue,
    offerings,
    enrollments,
    overrides,
    program_id: state.profile.program_id.value,
    advancement_year: state.profile.advancement_year.year(),
    timetable_grade: state.timetable_year.grade,
    selected_term: planner_term_code(state.selected_term),
    visible_days: state.visible_days,
    visible_periods: state.visible_periods,
    custom_course_ids: custom_ids,
    custom_categories,
    next_custom_course_number: state.next_custom_course_number,
  }
}
