///|
/// The four timetable years derived from the profile's advancement year.
pub fn PlannerState::timetable_years(
  self : PlannerState,
) -> Array[TimetableYear] {
  let years : Array[TimetableYear] = []
  for grade in 1..<=4 {
    match timetable_year_for_grade(self.profile, grade) {
      Some(value) => years.push(value)
      None => ()
    }
  }
  years
}

///|
fn apply_profile(
  state : PlannerState,
  profile : @tanikun-domain.AcademicProfile,
) -> PlannerState {
  let error = match state.requirement_sets.lookup_for_profile(profile) {
    Some(_) => None
    None =>
      Some(
        UiError::new(
          UiErrorTarget::General,
          UiErrorKind::MissingRequirementSet,
          "選択したプロファイルの要件セットがありません",
        ),
      )
  }
  let timetable_year = match
    timetable_year_for_grade(profile, state.timetable_year.grade) {
    Some(value) => value
    None => { grade: 3, academic_year: profile.advancement_year, }
  }
  bump({ ..state, profile, timetable_year, error, })
}

///|
fn clear_timetable_selection(state : PlannerState) -> PlannerState {
  {
    ..state,
    selected_offering: None,
    picker: None,
    override_form: None,
    error: None,
  }
}

///|
fn select_grade(state : PlannerState, grade : String) -> PlannerState {
  let grade = match option_int(grade, 1, 4) {
    Some(value) => value
    None =>
      return with_error(
        state,
        UiError::new(
          UiErrorTarget::General,
          UiErrorKind::General,
          "学年が正しくありません",
        ),
      )
  }
  let timetable_year = match timetable_year_for_grade(state.profile, grade) {
    Some(value) => value
    None =>
      return with_error(
        state,
        UiError::new(
          UiErrorTarget::General,
          UiErrorKind::General,
          "学年が正しくありません",
        ),
      )
  }
  bump(clear_timetable_selection({ ..state, timetable_year, }))
}

///|
fn has_year(
  years : Array[@tanikun-domain.AcademicYear],
  year : @tanikun-domain.AcademicYear,
) -> Bool {
  for candidate in years {
    if candidate == year {
      return true
    }
  }
  false
}

///|
fn select_program(state : PlannerState, value : String) -> PlannerState {
  let program = match @tanikun-domain.ProgramId::new(value) {
    Ok(value) => value
    Err(_) =>
      return with_error(
        state,
        UiError::new(
          UiErrorTarget::General,
          UiErrorKind::General,
          "プログラムが正しくありません",
        ),
      )
  }
  let years = state.advancement_years(program)
  if years.is_empty() {
    return with_error(
      state,
      UiError::new(
        UiErrorTarget::General,
        UiErrorKind::MissingRequirementSet,
        "このプログラムの要件セットがありません",
      ),
    )
  }
  let year = if has_year(years, state.profile.advancement_year) {
    state.profile.advancement_year
  } else {
    years[0]
  }
  apply_profile(state, @tanikun-domain.AcademicProfile::new(program, year))
}

///|
fn select_advancement_year(state : PlannerState, year : String) -> PlannerState {
  let year = match option_int(year, 2000, 2100) {
    Some(value) => value
    None =>
      return with_error(
        state,
        UiError::new(
          UiErrorTarget::General,
          UiErrorKind::General,
          "年度が正しくありません",
        ),
      )
  }
  let advancement_year = match @tanikun-domain.AcademicYear::new(year) {
    Ok(value) => value
    Err(_) =>
      return with_error(
        state,
        UiError::new(
          UiErrorTarget::General,
          UiErrorKind::General,
          "年度が正しくありません",
        ),
      )
  }
  apply_profile(
    state,
    @tanikun-domain.AcademicProfile::new(
      state.profile.program_id,
      advancement_year,
    ),
  )
}

///|
