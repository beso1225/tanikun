///|
fn eval_context(
  total : @tanikun-domain.Credits,
  by_category : Array[(@tanikun-domain.CategoryId, @tanikun-domain.Credits)],
  by_course : Array[(@tanikun-domain.CourseId, @tanikun-domain.Credits)],
  passed_courses : Array[@tanikun-domain.CourseId],
) -> @tanikun-requirements.RuleContext {
  @tanikun-requirements.RuleContext::new(
    total, by_category, by_course, passed_courses,
  )
}

///|
fn assert_satisfaction(
  result : @tanikun-requirements.RuleResult,
  expected : @tanikun-requirements.Satisfaction,
) -> Unit raise Error {
  assert_true(result.satisfaction == expected)
}

///|
fn assert_credits_progress(
  result : @tanikun-requirements.RuleResult,
  expected_achieved : Int,
  expected_required : Int,
) -> Unit raise Error {
  match result.progress {
    @tanikun-requirements.Progress::Credits(achieved~, required~) => {
      assert_eq(achieved.half_units(), expected_achieved)
      assert_eq(required.half_units(), expected_required)
    }
    _ => fail("expected Credits progress")
  }
}

///|
fn assert_courses_progress(
  result : @tanikun-requirements.RuleResult,
  expected_passed : Int,
  expected_total : Int,
) -> Unit raise Error {
  match result.progress {
    @tanikun-requirements.Progress::Courses(passed~, total~) => {
      assert_eq(passed, expected_passed)
      assert_eq(total, expected_total)
    }
    _ => fail("expected Courses progress")
  }
}

///|
fn assert_children_progress(
  result : @tanikun-requirements.RuleResult,
  expected_satisfied : Int,
  expected_partial : Int,
  expected_total : Int,
) -> Unit raise Error {
  match result.progress {
    @tanikun-requirements.Progress::Children(satisfied~, partial~, total~) => {
      assert_eq(satisfied, expected_satisfied)
      assert_eq(partial, expected_partial)
      assert_eq(total, expected_total)
    }
    _ => fail("expected Children progress")
  }
}

///|
fn assert_rule_result_equal(
  actual : @tanikun-requirements.RuleResult,
  expected : @tanikun-requirements.RuleResult,
) -> Unit raise Error {
  assert_true(actual.satisfaction == expected.satisfaction)
  match (actual.progress, expected.progress) {
    (
      @tanikun-requirements.Progress::Credits(
        achieved=actual_achieved,
        required=actual_required
      ),
      @tanikun-requirements.Progress::Credits(
        achieved=expected_achieved,
        required=expected_required
      ),
    ) => {
      assert_eq(actual_achieved.half_units(), expected_achieved.half_units())
      assert_eq(actual_required.half_units(), expected_required.half_units())
    }
    (
      @tanikun-requirements.Progress::Courses(
        passed=actual_passed,
        total=actual_total
      ),
      @tanikun-requirements.Progress::Courses(
        passed=expected_passed,
        total=expected_total
      ),
    ) => {
      assert_eq(actual_passed, expected_passed)
      assert_eq(actual_total, expected_total)
    }
    (
      @tanikun-requirements.Progress::Children(
        satisfied=actual_satisfied,
        partial=actual_partial,
        total=actual_total
      ),
      @tanikun-requirements.Progress::Children(
        satisfied=expected_satisfied,
        partial=expected_partial,
        total=expected_total
      ),
    ) => {
      assert_eq(actual_satisfied, expected_satisfied)
      assert_eq(actual_partial, expected_partial)
      assert_eq(actual_total, expected_total)
    }
    _ => fail("progress shapes differ")
  }
  let actual_children = actual.children()
  let expected_children = expected.children()
  assert_eq(actual_children.length(), expected_children.length())
  for index in 0..<actual_children.length() {
    assert_rule_result_equal(actual_children[index], expected_children[index])
  }
}

///|
test "total minimum reports unsatisfied, partial, and satisfied" {
  let rule = expect_ok(
    @tanikun-requirements.Rule::total_minimum(credit_value(4)),
  )
  let unsatisfied = @tanikun-requirements.evaluate_rule(
    rule,
    eval_context(@tanikun-domain.Credits::zero(), [], [], []),
  )
  assert_satisfaction(
    unsatisfied,
    @tanikun-requirements.Satisfaction::Unsatisfied,
  )
  assert_credits_progress(unsatisfied, 0, 4)

  let partial = @tanikun-requirements.evaluate_rule(
    rule,
    eval_context(credit_value(2), [], [], []),
  )
  assert_satisfaction(partial, @tanikun-requirements.Satisfaction::Partial)
  assert_credits_progress(partial, 2, 4)

  let satisfied = @tanikun-requirements.evaluate_rule(
    rule,
    eval_context(credit_value(4), [], [], []),
  )
  assert_satisfaction(satisfied, @tanikun-requirements.Satisfaction::Satisfied)
  assert_credits_progress(satisfied, 4, 4)
  assert_eq(satisfied.children().length(), 0)
}

///|
test "category and course-set leaves sum their references" {
  let core = category_id("core")
  let elective = category_id("elective")
  let category_rule = expect_ok(
    @tanikun-requirements.Rule::category_minimum(
      [core, elective],
      credit_value(8),
    ),
  )
  let category_context = eval_context(
    @tanikun-domain.Credits::zero(),
    [(core, credit_value(4)), (elective, credit_value(2))],
    [],
    [],
  )
  let category_partial = @tanikun-requirements.evaluate_rule(
    category_rule, category_context,
  )
  assert_satisfaction(
    category_partial,
    @tanikun-requirements.Satisfaction::Partial,
  )
  assert_credits_progress(category_partial, 6, 8)

  let mechanics = course_id("PHY101")
  let thermodynamics = course_id("PHY102")
  let course_rule = expect_ok(
    @tanikun-requirements.Rule::course_set_minimum(
      [mechanics, thermodynamics],
      credit_value(8),
    ),
  )
  let course_context = eval_context(
    @tanikun-domain.Credits::zero(),
    [],
    [(mechanics, credit_value(4)), (thermodynamics, credit_value(2))],
    [],
  )
  let course_partial = @tanikun-requirements.evaluate_rule(
    course_rule, course_context,
  )
  assert_satisfaction(
    course_partial,
    @tanikun-requirements.Satisfaction::Partial,
  )
  assert_credits_progress(course_partial, 6, 8)
}

///|
test "all-courses-passed reports course progress" {
  let mechanics = course_id("PHY101")
  let thermodynamics = course_id("PHY102")
  let rule = expect_ok(
    @tanikun-requirements.Rule::all_courses_passed([mechanics, thermodynamics]),
  )
  let none = @tanikun-requirements.evaluate_rule(
    rule,
    eval_context(@tanikun-domain.Credits::zero(), [], [], []),
  )
  assert_satisfaction(none, @tanikun-requirements.Satisfaction::Unsatisfied)
  assert_courses_progress(none, 0, 2)

  let some = @tanikun-requirements.evaluate_rule(
    rule,
    eval_context(@tanikun-domain.Credits::zero(), [], [], [mechanics]),
  )
  assert_satisfaction(some, @tanikun-requirements.Satisfaction::Partial)
  assert_courses_progress(some, 1, 2)

  let all = @tanikun-requirements.evaluate_rule(
    rule,
    eval_context(@tanikun-domain.Credits::zero(), [], [], [
      thermodynamics, mechanics,
    ]),
  )
  assert_satisfaction(all, @tanikun-requirements.Satisfaction::Satisfied)
  assert_courses_progress(all, 2, 2)
}

///|
test "all, any, and at-least follow their truth tables" {
  let core = category_id("core")
  let elective = category_id("elective")
  let empty = category_id("empty")
  let context = eval_context(
    @tanikun-domain.Credits::zero(),
    [
      (core, credit_value(4)),
      (elective, credit_value(2)),
      (empty, @tanikun-domain.Credits::zero()),
    ],
    [],
    [],
  )
  let satisfied = expect_ok(
    @tanikun-requirements.Rule::category_minimum([core], credit_value(2)),
  )
  let partial = expect_ok(
    @tanikun-requirements.Rule::category_minimum([elective], credit_value(4)),
  )
  let unsatisfied = expect_ok(
    @tanikun-requirements.Rule::category_minimum([empty], credit_value(2)),
  )

  let all_satisfied = @tanikun-requirements.evaluate_rule(
    expect_ok(@tanikun-requirements.Rule::all([satisfied, satisfied])),
    context,
  )
  assert_satisfaction(
    all_satisfied,
    @tanikun-requirements.Satisfaction::Satisfied,
  )
  assert_children_progress(all_satisfied, 2, 0, 2)

  let all_unsatisfied = @tanikun-requirements.evaluate_rule(
    expect_ok(@tanikun-requirements.Rule::all([unsatisfied, unsatisfied])),
    context,
  )
  assert_satisfaction(
    all_unsatisfied,
    @tanikun-requirements.Satisfaction::Unsatisfied,
  )
  assert_children_progress(all_unsatisfied, 0, 0, 2)

  let all_partial = @tanikun-requirements.evaluate_rule(
    expect_ok(@tanikun-requirements.Rule::all([satisfied, partial])),
    context,
  )
  assert_satisfaction(all_partial, @tanikun-requirements.Satisfaction::Partial)
  assert_children_progress(all_partial, 1, 1, 2)

  let any_partial = @tanikun-requirements.evaluate_rule(
    expect_ok(@tanikun-requirements.Rule::any([unsatisfied, partial])),
    context,
  )
  assert_satisfaction(any_partial, @tanikun-requirements.Satisfaction::Partial)
  assert_children_progress(any_partial, 0, 1, 2)

  let any_unsatisfied = @tanikun-requirements.evaluate_rule(
    expect_ok(@tanikun-requirements.Rule::any([unsatisfied, unsatisfied])),
    context,
  )
  assert_satisfaction(
    any_unsatisfied,
    @tanikun-requirements.Satisfaction::Unsatisfied,
  )

  let any_satisfied = @tanikun-requirements.evaluate_rule(
    expect_ok(@tanikun-requirements.Rule::any([partial, satisfied])),
    context,
  )
  assert_satisfaction(
    any_satisfied,
    @tanikun-requirements.Satisfaction::Satisfied,
  )

  let at_least_partial = @tanikun-requirements.evaluate_rule(
    expect_ok(
      @tanikun-requirements.Rule::at_least(2, [satisfied, partial, unsatisfied]),
    ),
    context,
  )
  assert_satisfaction(
    at_least_partial,
    @tanikun-requirements.Satisfaction::Partial,
  )
  assert_children_progress(at_least_partial, 1, 1, 3)

  let at_least_satisfied = @tanikun-requirements.evaluate_rule(
    expect_ok(
      @tanikun-requirements.Rule::at_least(2, [
        satisfied, satisfied, unsatisfied,
      ]),
    ),
    context,
  )
  assert_satisfaction(
    at_least_satisfied,
    @tanikun-requirements.Satisfaction::Satisfied,
  )

  let at_least_unsatisfied = @tanikun-requirements.evaluate_rule(
    expect_ok(
      @tanikun-requirements.Rule::at_least(2, [
        partial, unsatisfied, unsatisfied,
      ]),
    ),
    context,
  )
  assert_satisfaction(
    at_least_unsatisfied,
    @tanikun-requirements.Satisfaction::Unsatisfied,
  )
}

///|
test "evaluation projects credits and requirements separately" {
  let core = category("core", "Core")
  let passed = credit_course("PHY101", 4)
  let in_progress = credit_course("PHY102", 6)
  let planned = credit_course("PHY103", 2)
  let rule = expect_ok(
    @tanikun-requirements.Rule::total_minimum(credit_value(8)),
  )
  let set = credit_requirement_set_with_rule(
    [core],
    [(passed.id, core.id), (in_progress.id, core.id)],
    rule,
  )
  let offerings = [
    credit_offering("offering-1", passed.id),
    credit_offering("offering-2", in_progress.id),
    credit_offering("offering-3", planned.id),
  ]
  let input = credit_input(
    set,
    [passed, in_progress, planned],
    offerings,
    [
      passed_enrollment("offering-1", passed, 4),
      in_progress_enrollment("offering-2"),
      planned_enrollment("offering-3"),
    ],
    @tanikun-domain.Overrides::empty(),
  )
  let evaluation = expect_ok(@tanikun-requirements.evaluate(input))
  assert_eq(evaluation.credits.confirmed.total.half_units(), 4)
  assert_eq(evaluation.credits.standard.total.half_units(), 10)
  assert_eq(evaluation.credits.optimistic.total.half_units(), 12)
  assert_satisfaction(
    evaluation.requirements.confirmed,
    @tanikun-requirements.Satisfaction::Partial,
  )
  assert_credits_progress(evaluation.requirements.confirmed, 4, 8)
  assert_satisfaction(
    evaluation.requirements.standard,
    @tanikun-requirements.Satisfaction::Satisfied,
  )
  assert_satisfaction(
    evaluation.requirements.optimistic,
    @tanikun-requirements.Satisfaction::Satisfied,
  )
}

///|
test "evaluation is independent of context and course order" {
  let mechanics = course_id("PHY101")
  let thermodynamics = course_id("PHY102")
  let rule = expect_ok(
    @tanikun-requirements.Rule::course_set_minimum(
      [mechanics, thermodynamics],
      credit_value(6),
    ),
  )
  let first = @tanikun-requirements.evaluate_rule(
    rule,
    eval_context(
      @tanikun-domain.Credits::zero(),
      [],
      [(mechanics, credit_value(4)), (thermodynamics, credit_value(2))],
      [],
    ),
  )
  let second = @tanikun-requirements.evaluate_rule(
    rule,
    eval_context(
      @tanikun-domain.Credits::zero(),
      [],
      [(thermodynamics, credit_value(2)), (mechanics, credit_value(4))],
      [],
    ),
  )
  assert_rule_result_equal(first, second)
}

///|
test "node satisfaction is independent of child order" {
  let core = category_id("core")
  let elective = category_id("elective")
  let context = eval_context(
    @tanikun-domain.Credits::zero(),
    [(core, credit_value(4)), (elective, credit_value(2))],
    [],
    [],
  )
  let satisfied = expect_ok(
    @tanikun-requirements.Rule::category_minimum([core], credit_value(2)),
  )
  let partial = expect_ok(
    @tanikun-requirements.Rule::category_minimum([elective], credit_value(4)),
  )
  let forward = @tanikun-requirements.evaluate_rule(
    expect_ok(@tanikun-requirements.Rule::all([satisfied, partial])),
    context,
  )
  let reverse = @tanikun-requirements.evaluate_rule(
    expect_ok(@tanikun-requirements.Rule::all([partial, satisfied])),
    context,
  )
  assert_satisfaction(forward, @tanikun-requirements.Satisfaction::Partial)
  assert_satisfaction(reverse, @tanikun-requirements.Satisfaction::Partial)
  assert_children_progress(forward, 1, 1, 2)
  assert_children_progress(reverse, 1, 1, 2)
  let forward_children = forward.children()
  let reverse_children = reverse.children()
  assert_satisfaction(
    forward_children[0],
    @tanikun-requirements.Satisfaction::Satisfied,
  )
  assert_satisfaction(
    forward_children[1],
    @tanikun-requirements.Satisfaction::Partial,
  )
  assert_satisfaction(
    reverse_children[0],
    @tanikun-requirements.Satisfaction::Partial,
  )
  assert_satisfaction(
    reverse_children[1],
    @tanikun-requirements.Satisfaction::Satisfied,
  )
}
