///|
fn category_id(value : String) -> @tanikun-domain.CategoryId raise Error {
  expect_ok(@tanikun-domain.CategoryId::new(value))
}

///|
fn category(
  id : String,
  name : String,
) -> @tanikun-requirements.Category raise Error {
  expect_ok(@tanikun-requirements.Category::new(category_id(id), name))
}

///|
fn course_id(local_part : String) -> @tanikun-domain.CourseId raise Error {
  expect_ok(@tanikun-domain.CourseId::new("master", local_part))
}

///|
test "category table maps courses and leaves others uncategorized" {
  let physics = category("physics", "Physics")
  let math = category("math", "Mathematics")
  let mechanics = course_id("PHY101")
  let analysis = course_id("MATH101")
  let missing = course_id("PHY999")
  let table = expect_ok(
    @tanikun-requirements.CategoryTable::new(
      [(mechanics, physics.id), (analysis, math.id)],
      [physics, math],
    ),
  )
  assert_eq(table.len(), 2)
  assert_same_category_id(expect_some(table.lookup(mechanics)), physics.id)
  assert_same_category_id(expect_some(table.lookup(analysis)), math.id)
  match table.lookup(missing) {
    None => ()
    Some(_) => fail("expected an uncategorized course")
  }
}

///|
test "category table rejects duplicate course assignments" {
  let physics = category("physics", "Physics")
  let mechanics = course_id("PHY101")
  assert_duplicate_category_assignment(
    @tanikun-requirements.CategoryTable::new(
      [(mechanics, physics.id), (mechanics, physics.id)],
      [physics],
    ),
    mechanics,
  )
}

///|
test "category table rejects unknown categories" {
  let physics = category("physics", "Physics")
  let unknown = category_id("unknown")
  let mechanics = course_id("PHY101")
  assert_unknown_category(
    @tanikun-requirements.CategoryTable::new([(mechanics, unknown)], [physics]),
    unknown,
  )
}
