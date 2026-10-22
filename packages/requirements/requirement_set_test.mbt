///|
fn program_id(value : String) -> @tanikun-domain.ProgramId raise Error {
  expect_ok(@tanikun-domain.ProgramId::new(value))
}

///|
fn academic_year(value : Int) -> @tanikun-domain.AcademicYear raise Error {
  expect_ok(@tanikun-domain.AcademicYear::new(value))
}

///|
fn requirement_set(
  key : @tanikun-requirements.RequirementSetKey,
  categories : Array[@tanikun-requirements.Category],
  assignments : Array[(@tanikun-domain.CourseId, @tanikun-domain.CategoryId)],
  rule : String,
) -> Result[
  @tanikun-requirements.RequirementSet[String],
  @tanikun-domain.DomainError,
] {
  @tanikun-requirements.RequirementSet::new(key, categories, assignments, rule)
}

///|
test "requirement set stores its key, categories, table, and rule" {
  let program = program_id("applied-physics")
  let year = academic_year(2026)
  let key = @tanikun-requirements.RequirementSetKey::new(program, year)
  let physics = category("physics", "Physics")
  let mechanics = course_id("PHY101")
  let set = expect_ok(
    requirement_set(key, [physics], [(mechanics, physics.id)], "rule-1"),
  )
  assert_true(set.key == key)
  assert_eq(set.categories().length(), 1)
  assert_same_category_id(expect_some(set.category_for(mechanics)), physics.id)
  assert_eq(set.rule(), "rule-1")
}

///|
test "requirement set rejects duplicate category ids" {
  let key = @tanikun-requirements.RequirementSetKey::new(
    program_id("applied-physics"),
    academic_year(2026),
  )
  let first = category("physics", "Physics")
  let second = category("physics", "Physics II")
  assert_duplicate_category_id(
    requirement_set(key, [first, second], [], "rule-1"),
    first.id,
  )
}

///|
test "same course can have different categories in different programs" {
  let mechanics = course_id("PHY101")
  let core = category("core", "Core")
  let elective = category("elective", "Elective")
  let first_key = @tanikun-requirements.RequirementSetKey::new(
    program_id("applied-physics"),
    academic_year(2026),
  )
  let second_key = @tanikun-requirements.RequirementSetKey::new(
    program_id("physics"),
    academic_year(2026),
  )
  let first = expect_ok(
    requirement_set(first_key, [core], [(mechanics, core.id)], "rule-a"),
  )
  let second = expect_ok(
    requirement_set(
      second_key,
      [elective],
      [(mechanics, elective.id)],
      "rule-b",
    ),
  )
  assert_same_category_id(expect_some(first.category_for(mechanics)), core.id)
  assert_same_category_id(
    expect_some(second.category_for(mechanics)),
    elective.id,
  )
}

///|
test "uncategorized courses remain valid" {
  let physics = category("physics", "Physics")
  let mechanics = course_id("PHY101")
  let statistics = course_id("STAT101")
  let key = @tanikun-requirements.RequirementSetKey::new(
    program_id("applied-physics"),
    academic_year(2026),
  )
  let set = expect_ok(
    requirement_set(key, [physics], [(mechanics, physics.id)], "rule-1"),
  )
  match set.category_for(statistics) {
    None => ()
    Some(_) => fail("expected the course to remain uncategorized")
  }
}

///|
test "requirement sets are looked up by program and advancement year" {
  let program = program_id("applied-physics")
  let year = academic_year(2026)
  let physics = category("physics", "Physics")
  let mechanics = course_id("PHY101")
  let key = @tanikun-requirements.RequirementSetKey::new(program, year)
  let set = expect_ok(
    requirement_set(key, [physics], [(mechanics, physics.id)], "rule-1"),
  )
  let sets = expect_ok(@tanikun-requirements.RequirementSets::new([set]))
  assert_eq(sets.len(), 1)
  match sets.lookup(program, year) {
    Some(found) => assert_eq(found.rule(), "rule-1")
    None => fail("expected a requirement set")
  }
  let profile = @tanikun-domain.AcademicProfile::new(program, year)
  match sets.lookup_for_profile(profile) {
    Some(found) => assert_eq(found.rule(), "rule-1")
    None => fail("expected a profile requirement set")
  }
  match sets.lookup(program_id("physics"), year) {
    None => ()
    Some(_) => fail("expected no requirement set for another program")
  }
}

///|
test "duplicate requirement set keys are rejected" {
  let program = program_id("applied-physics")
  let year = academic_year(2026)
  let key = @tanikun-requirements.RequirementSetKey::new(program, year)
  let physics = category("physics", "Physics")
  let mechanics = course_id("PHY101")
  let first = expect_ok(
    requirement_set(key, [physics], [(mechanics, physics.id)], "rule-a"),
  )
  let second = expect_ok(requirement_set(key, [physics], [], "rule-b"))
  assert_duplicate_requirement_set(
    @tanikun-requirements.RequirementSets::new([first, second]),
    program,
    year,
  )
}
