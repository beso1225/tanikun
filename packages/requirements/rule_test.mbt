///|
fn rule_threshold(half_units : Int) -> @tanikun-domain.Credits raise Error {
  expect_ok(@tanikun-domain.Credits::new(half_units))
}

///|
fn rule_scope(
  categories : Array[@tanikun-domain.CategoryId],
  courses : Array[@tanikun-domain.CourseId],
) -> @tanikun-requirements.RuleScope {
  @tanikun-requirements.RuleScope::new(categories, courses)
}

///|
test "category minimum accepts one or more categories" {
  let physics = category_id("physics")
  let math = category_id("math")
  let single = expect_ok(
    @tanikun-requirements.Rule::category_minimum([physics], rule_threshold(4)),
  )
  expect_ok(single.validate(rule_scope([physics], [])))
  let group = expect_ok(
    @tanikun-requirements.Rule::category_minimum(
      [physics, math],
      rule_threshold(6),
    ),
  )
  expect_ok(group.validate(rule_scope([physics, math], [])))
}

///|
test "total minimum and course leaves validate against scope" {
  let total = expect_ok(
    @tanikun-requirements.Rule::total_minimum(rule_threshold(1)),
  )
  expect_ok(total.validate(rule_scope([], [])))

  let mechanics = course_id("PHY101")
  let all_courses = expect_ok(
    @tanikun-requirements.Rule::all_courses_passed([mechanics]),
  )
  expect_ok(all_courses.validate(rule_scope([], [mechanics])))

  let elective = course_id("PHY102")
  let course_set = expect_ok(
    @tanikun-requirements.Rule::course_set_minimum(
      [mechanics, elective],
      rule_threshold(2),
    ),
  )
  expect_ok(course_set.validate(rule_scope([], [mechanics, elective])))
}

///|
test "rule nodes accept non-empty children" {
  let mechanics = course_id("PHY101")
  let total = expect_ok(
    @tanikun-requirements.Rule::total_minimum(rule_threshold(2)),
  )
  let course = expect_ok(
    @tanikun-requirements.Rule::all_courses_passed([mechanics]),
  )
  let all = expect_ok(@tanikun-requirements.Rule::all([total, course]))
  let any = expect_ok(@tanikun-requirements.Rule::any([total, course]))
  let at_least = expect_ok(
    @tanikun-requirements.Rule::at_least(1, [total, course]),
  )
  let scope = rule_scope([], [mechanics])
  expect_ok(all.validate(scope))
  expect_ok(any.validate(scope))
  expect_ok(at_least.validate(scope))
}

///|
test "rule thresholds must be positive" {
  assert_invalid_rule_threshold(
    @tanikun-requirements.Rule::total_minimum(rule_threshold(0)),
    0,
  )
  let physics = category_id("physics")
  assert_invalid_rule_threshold(
    @tanikun-requirements.Rule::category_minimum([physics], rule_threshold(0)),
    0,
  )
  let mechanics = course_id("PHY101")
  assert_invalid_rule_threshold(
    @tanikun-requirements.Rule::course_set_minimum(
      [mechanics],
      rule_threshold(0),
    ),
    0,
  )
}

///|
test "category leaves reject empty and duplicate lists" {
  assert_empty_rule_categories(
    @tanikun-requirements.Rule::category_minimum([], rule_threshold(2)),
  )
  let physics = category_id("physics")
  assert_duplicate_rule_category(
    @tanikun-requirements.Rule::category_minimum(
      [physics, physics],
      rule_threshold(2),
    ),
    physics,
  )
}

///|
test "course leaves reject empty and duplicate lists" {
  assert_empty_rule_courses(@tanikun-requirements.Rule::all_courses_passed([]))
  let mechanics = course_id("PHY101")
  assert_duplicate_rule_course(
    @tanikun-requirements.Rule::all_courses_passed([mechanics, mechanics]),
    mechanics,
  )
  assert_empty_rule_courses(
    @tanikun-requirements.Rule::course_set_minimum([], rule_threshold(2)),
  )
  assert_duplicate_rule_course(
    @tanikun-requirements.Rule::course_set_minimum(
      [mechanics, mechanics],
      rule_threshold(2),
    ),
    mechanics,
  )
}

///|
test "rule nodes reject empty children" {
  assert_empty_rule_children(@tanikun-requirements.Rule::all([]))
  assert_empty_rule_children(@tanikun-requirements.Rule::any([]))
  assert_empty_rule_children(@tanikun-requirements.Rule::at_least(1, []))
}

///|
test "at least counts are bounded by the children" {
  let total = expect_ok(
    @tanikun-requirements.Rule::total_minimum(rule_threshold(2)),
  )
  assert_invalid_at_least_count(
    @tanikun-requirements.Rule::at_least(0, [total]),
    0,
    1,
  )
  assert_invalid_at_least_count(
    @tanikun-requirements.Rule::at_least(2, [total]),
    2,
    1,
  )
  let _ = expect_ok(@tanikun-requirements.Rule::at_least(1, [total]))
}

///|
test "rule validation rejects unknown category and course references" {
  let known_category = category_id("physics")
  let unknown_category = category_id("unknown")
  let category_rule = expect_ok(
    @tanikun-requirements.Rule::category_minimum(
      [known_category, unknown_category],
      rule_threshold(2),
    ),
  )
  assert_unknown_rule_category(
    category_rule.validate(rule_scope([known_category], [])),
    unknown_category,
  )

  let unknown_course = course_id("PHY999")
  let courses_rule = expect_ok(
    @tanikun-requirements.Rule::all_courses_passed([unknown_course]),
  )
  assert_unknown_rule_course(
    courses_rule.validate(rule_scope([], [])),
    unknown_course,
  )

  let elective_rule = expect_ok(
    @tanikun-requirements.Rule::course_set_minimum(
      [unknown_course],
      rule_threshold(2),
    ),
  )
  assert_unknown_rule_course(
    elective_rule.validate(rule_scope([], [])),
    unknown_course,
  )
}

///|
test "rule validation recurses into nodes" {
  let unknown_category = category_id("unknown")
  let nested = expect_ok(
    @tanikun-requirements.Rule::all([
      expect_ok(@tanikun-requirements.Rule::total_minimum(rule_threshold(2))),
      expect_ok(
        @tanikun-requirements.Rule::category_minimum(
          [unknown_category],
          rule_threshold(2),
        ),
      ),
    ]),
  )
  assert_unknown_rule_category(
    nested.validate(rule_scope([], [])),
    unknown_category,
  )
}
