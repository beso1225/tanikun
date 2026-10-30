///|
test "mandatory membership projects independently of confirmed pass evidence" {
  let a = course_id("A")
  let b = course_id("B")
  let rule = expect_ok(@tanikun-requirements.Rule::mandatory_courses([a, b]))
  let context = eval_context(
    credit_value(4),
    [],
    [(a, credit_value(0)), (b, credit_value(4)), (b, credit_value(4))],
    [a],
  )
  assert_courses_progress(
    @tanikun-requirements.evaluate_rule(rule, context),
    2,
    2,
  )
  let passed = expect_ok(@tanikun-requirements.Rule::all_courses_passed([a, b]))
  assert_courses_progress(
    @tanikun-requirements.evaluate_rule(passed, context),
    1,
    2,
  )
  assert_true(rule.is_mandatory_courses())
  assert_true(@tanikun-requirements.Rule::mandatory_courses([]) is Err(_))
  assert_true(@tanikun-requirements.Rule::mandatory_courses([a, a]) is Err(_))
  assert_true(
    rule.validate(@tanikun-requirements.RuleScope::new([], [a])) is Err(_),
  )
}

///|
test "mandatory evaluation excludes failed and not-taken courses in all modes" {
  let a = credit_course("A", 4)
  let b = credit_course("B", 4)
  let c = credit_course("C", 4)
  let d = credit_course("D", 4)
  let e = credit_course("E", 4)
  let rule = expect_ok(
    @tanikun-requirements.Rule::mandatory_courses([a.id, b.id, c.id, d.id, e.id]),
  )
  let set = credit_requirement_set_with_rule(
    [],
    [],
    expect_ok(@tanikun-requirements.Rule::all([rule])),
  )
  let offerings = [
    credit_offering("a", a.id),
    credit_offering("b", b.id),
    credit_offering("c", c.id),
    credit_offering("d", d.id),
    credit_offering("e", e.id),
    credit_offering("repeat", c.id),
  ]
  let enrollments = [
    passed_enrollment("a", a, 4),
    in_progress_enrollment("b"),
    planned_enrollment("c"),
    failed_enrollment("d"),
    not_taken_enrollment("e"),
    planned_enrollment("repeat"),
  ]
  let result = expect_ok(
    @tanikun-requirements.evaluate(
      credit_input(
        set,
        [a, b, c, d, e],
        offerings,
        enrollments,
        @tanikun-domain.Overrides::empty(),
      ),
    ),
  )
  assert_courses_progress(result.requirements.confirmed.children()[0], 1, 5)
  assert_courses_progress(result.requirements.standard.children()[0], 2, 5)
  assert_courses_progress(result.requirements.optimistic.children()[0], 3, 5)
  assert_eq(result.credits.optimistic.total.half_units(), 12)
  let reverse = []
  for index in 0..<enrollments.length() {
    reverse.push(enrollments[enrollments.length() - 1 - index])
  }
  let reversed = expect_ok(
    @tanikun-requirements.evaluate(
      credit_input(
        set,
        [e, d, c, b, a],
        offerings,
        reverse,
        @tanikun-domain.Overrides::empty(),
      ),
    ),
  )
  assert_courses_progress(reversed.requirements.optimistic.children()[0], 3, 5)
}
