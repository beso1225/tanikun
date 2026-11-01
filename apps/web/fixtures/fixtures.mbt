///|
fn fixture_error(message : String) -> String {
  "error:\{message}"
}

///|
/// Build a requirement-set baseline for the fixture's program and year. The
/// fixture's custom category IDs become known categories so the real decoder
/// can validate custom assignments.
fn fixture_base(dto : @app.PersistedPlan) -> Result[@app.PlannerState, String] {
  let program = match @tanikun-domain.ProgramId::new(dto.program_id) {
    Ok(value) => value
    Err(_) => return Err("プログラムIDが正しくありません")
  }
  let year = match @tanikun-domain.AcademicYear::new(dto.advancement_year) {
    Ok(value) => value
    Err(_) => return Err("進級年度が正しくありません")
  }
  let categories : Array[@tanikun-requirements.Category] = []
  for assignment in dto.custom_categories {
    let id = match @tanikun-domain.CategoryId::new(assignment.category) {
      Ok(value) => value
      Err(_) => return Err("区分IDが正しくありません")
    }
    if !categories.any(definition => definition.id == id) {
      let definition = match
        @tanikun-requirements.Category::new(id, assignment.category) {
        Ok(value) => value
        Err(_) => return Err("区分が正しくありません")
      }
      categories.push(definition)
    }
  }
  let key = @tanikun-requirements.RequirementSetKey::new(program, year)
  let credits = match @tanikun-domain.Credits::new(1) {
    Ok(value) => value
    Err(_) => return Err("要件ルールが正しくありません")
  }
  let rule = match @tanikun-requirements.Rule::total_minimum(credits) {
    Ok(value) => value
    Err(_) => return Err("要件ルールが正しくありません")
  }
  let no_courses : Array[(@tanikun-domain.CourseId, @tanikun-domain.CategoryId)] = []
  let set : @tanikun-requirements.RequirementSet[@tanikun-requirements.Rule] = match
    @tanikun-requirements.RequirementSet::new(key, categories, no_courses, rule) {
    Ok(value) => value
    Err(_) => return Err("要件セットが正しくありません")
  }
  let sets : @tanikun-requirements.RequirementSets[@tanikun-requirements.Rule] = match
    @tanikun-requirements.RequirementSets::new([set]) {
    Ok(value) => value
    Err(_) => return Err("要件セットが正しくありません")
  }
  Ok(
    @app.PlannerState::new(
      [],
      [],
      [],
      @tanikun-domain.Overrides::empty(),
      @tanikun-domain.AcademicProfile::new(program, year),
      sets,
      [],
    ),
  )
}

///|
/// Test bridge: validate a complete fictional planner source with the real
/// MoonBit decoder. Returns `"ok"` or `"error:<message>"`.
pub fn validate_persisted_source(text : String) -> String {
  let dto : @app.PersistedPlan = @json.from_json(@json.parse(text)) catch {
    _ => return fixture_error("保存データを読み込めません")
  }
  let base = match fixture_base(dto) {
    Ok(value) => value
    Err(message) => return fixture_error(message)
  }
  match @app.decode_planner_state(base, text) {
    Ok(_) => "ok"
    Err(message) => fixture_error(message)
  }
}

///|
/// Test bridge: return the MoonBit-normalized source after validation, or
/// `"error:<message>"` when the document is invalid.
pub fn canonical_persisted_source(text : String) -> String {
  let dto : @app.PersistedPlan = @json.from_json(@json.parse(text)) catch {
    _ => return fixture_error("保存データを読み込めません")
  }
  let base = match fixture_base(dto) {
    Ok(value) => value
    Err(message) => return fixture_error(message)
  }
  match @app.decode_planner_state(base, text) {
    Ok(state) => @app.encode_planner_state(state)
    Err(message) => fixture_error(message)
  }
}
