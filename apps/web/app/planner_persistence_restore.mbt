///|
fn decode_plan_json(text : String) -> PersistedPlan raise {
  @json.from_json(@json.parse(text))
}

///|
/// Restores source state on top of the supplied requirement-set baseline.
fn restore_planner_state(
  base : PlannerState,
  text : String,
) -> Result[PlannerState, String] {
  let dto = decode_plan_json(text) catch {
    _ => return Err("保存データを読み込めません")
  }
  if dto.version != 1 {
    return Err("未対応の保存データです")
  }
  let catalogue = []
  for item in dto.catalogue {
    match decode_course(item) {
      Ok(value) => catalogue.push(value)
      Err(error) => return Err(error)
    }
  }
  let offerings = []
  for item in dto.offerings {
    match decode_offering(item) {
      Ok(value) => offerings.push(value)
      Err(error) => return Err(error)
    }
  }
  let enrollments = []
  for item in dto.enrollments {
    match decode_enrollment(item) {
      Ok(value) => enrollments.push(value)
      Err(error) => return Err(error)
    }
  }
  let overrides = []
  for item in dto.overrides {
    match decode_override(item) {
      Ok(value) => overrides.push(value)
      Err(error) => return Err(error)
    }
  }
  let overrides = match @tanikun-domain.Overrides::new(overrides) {
    Ok(value) => value
    Err(_) => return Err("上書きが重複しています")
  }
  let program_id = match @tanikun-domain.ProgramId::new(dto.program_id) {
    Ok(value) => value
    Err(_) => return Err("プログラムIDが正しくありません")
  }
  let advancement_year = match
    @tanikun-domain.AcademicYear::new(dto.advancement_year) {
    Ok(value) => value
    Err(_) => return Err("進級年度が正しくありません")
  }
  let profile = @tanikun-domain.AcademicProfile::new(
    program_id, advancement_year,
  )
  let custom_course_ids = []
  for item in dto.custom_course_ids {
    match decode_course_id(item) {
      Ok(value) => custom_course_ids.push(value)
      Err(error) => return Err(error)
    }
  }
  let custom_categories = []
  for item in dto.custom_categories {
    let course = match decode_course_id(item.course) {
      Ok(value) => value
      Err(error) => return Err(error)
    }
    let category = match @tanikun-domain.CategoryId::new(item.category) {
      Ok(value) => value
      Err(_) => return Err("区分IDが正しくありません")
    }
    custom_categories.push((course, category))
  }
  let requirement_set = match
    base.requirement_sets.lookup(profile.program_id, profile.advancement_year) {
    Some(value) => value
    None => return Err("対象の要件セットがありません")
  }
  let course_keys : @hashset.HashSet[String] = @hashset.HashSet([])
  for course in catalogue {
    let key = persistence_course_key(course.id)
    if course_keys.contains(key) {
      return Err("科目IDが重複しています")
    }
    course_keys.add(key)
  }
  let offering_ids : @hashset.HashSet[String] = @hashset.HashSet([])
  for offering in offerings {
    if offering_ids.contains(offering.id.value) {
      return Err("開講IDが重複しています")
    }
    offering_ids.add(offering.id.value)
  }
  let offering_course_keys : @hashset.HashSet[String] = @hashset.HashSet([])
  for offering in offerings {
    let key = persistence_course_key(offering.course_id)
    if !course_keys.contains(key) {
      return Err("開講の科目がありません")
    }
    offering_course_keys.add(key)
  }
  // Preserve the old scan order: at each index, report a missing offering
  // before reporting a later duplicate of that enrollment. Precomputing the
  // duplicated IDs keeps this linear without moving the duplicate error ahead
  // of an earlier missing reference.
  let seen_enrollment_ids : @hashset.HashSet[String] = @hashset.HashSet([])
  let duplicate_enrollment_ids : @hashset.HashSet[String] = @hashset.HashSet([])
  for enrollment in enrollments {
    let id = enrollment.offering_id.value
    if seen_enrollment_ids.contains(id) {
      duplicate_enrollment_ids.add(id)
    } else {
      seen_enrollment_ids.add(id)
    }
  }
  for enrollment in enrollments {
    let id = enrollment.offering_id.value
    if !offering_ids.contains(id) {
      return Err("履修の開講がありません")
    }
    if duplicate_enrollment_ids.contains(id) {
      return Err("履修が重複しています")
    }
  }
  for entry in overrides.entries() {
    match entry.target {
      @tanikun-domain.OverrideTarget::Course(id) =>
        if !course_keys.contains(persistence_course_key(id)) {
          return Err("上書き対象の科目がありません")
        }
      @tanikun-domain.OverrideTarget::Offering(id) =>
        if !offering_ids.contains(id.value) {
          return Err("上書き対象の開講がありません")
        }
    }
  }
  let custom_course_keys : @hashset.HashSet[String] = @hashset.HashSet([])
  for id in custom_course_ids {
    let key = persistence_course_key(id)
    if !course_keys.contains(key) {
      return Err("独自科目IDが catalogue にありません")
    }
    if !offering_course_keys.contains(key) {
      return Err("独自科目の開講がありません")
    }
    custom_course_keys.add(key)
  }
  for course in catalogue {
    if course.id.namespace_part == "user" &&
      !custom_course_keys.contains(persistence_course_key(course.id)) {
      return Err("独自科目が独自科目IDにありません")
    }
  }
  let categories = requirement_set.categories()
  for assignment in custom_categories {
    if !course_keys.contains(persistence_course_key(assignment.0)) {
      return Err("独自区分の科目がありません")
    }
    let mut category_found = false
    for category in categories {
      if category.id == assignment.1 {
        category_found = true
      }
    }
    if !category_found {
      return Err("独自区分の区分がありません")
    }
  }
  let selected_term = match planner_term_from_code(dto.selected_term) {
    Some(value) => value
    None => return Err("選択学期が正しくありません")
  }
  let timetable_year = match
    timetable_year_for_grade(profile, dto.timetable_grade) {
    Some(value) => value
    None => return Err("表示学年が正しくありません")
  }
  if dto.visible_days < 5 || dto.visible_days > 7 {
    return Err("表示日数が正しくありません")
  }
  if dto.visible_periods < 6 || dto.visible_periods > 10 {
    return Err("表示時限が正しくありません")
  }
  if dto.next_custom_course_number < 1 {
    return Err("独自科目の採番が正しくありません")
  }
  let state = PlannerState::new(
    catalogue,
    offerings,
    enrollments,
    overrides,
    profile,
    base.requirement_sets,
    custom_categories,
  )
  Ok({
    ..state,
    timetable_year,
    selected_term,
    visible_days: dto.visible_days,
    visible_periods: dto.visible_periods,
    custom_course_ids,
    next_custom_course_number: dto.next_custom_course_number,
    custom_id_prefix: base.custom_id_prefix,
    revision: 1,
  })
}

///|
/// Index key for a course identity. The namespace length disambiguates the
/// concatenation so different IDs cannot collide.
fn persistence_course_key(id : @tanikun-domain.CourseId) -> String {
  "\{id.namespace_part.length()}:\{id.namespace_part}\{id.local_part}"
}
