///|
/// Shared Phase 1 assertion helpers for credit and rule results.
///
/// Test-only; production packages must not depend on this file.
///

///|
fn category_total(summary : @tanikun-requirements.CreditSummary) -> Int {
  let mut total = 0
  for entry in summary.by_category() {
    total = total + entry.1.half_units()
  }
  total
}

///|
fn assert_category_credits(
  summary : @tanikun-requirements.CreditSummary,
  category_id : @tanikun-domain.CategoryId,
  half_units : Int,
) -> Unit raise Error {
  assert_eq(
    expect_some(summary.category_credits(category_id)).half_units(),
    half_units,
  )
}

///|
fn assert_credit_summary_equal(
  actual : @tanikun-requirements.CreditSummary,
  expected : @tanikun-requirements.CreditSummary,
) -> Unit raise Error {
  assert_eq(actual.total.half_units(), expected.total.half_units())
  let actual_categories = actual.by_category()
  let expected_categories = expected.by_category()
  assert_eq(actual_categories.length(), expected_categories.length())
  for index in 0..<actual_categories.length() {
    assert_same_category_id(
      actual_categories[index].0,
      expected_categories[index].0,
    )
    assert_eq(
      actual_categories[index].1.half_units(),
      expected_categories[index].1.half_units(),
    )
  }
}

///|
fn assert_monotonic(
  projection : @tanikun-requirements.Projection[
    @tanikun-requirements.CreditSummary,
  ],
) -> Unit raise Error {
  let confirmed = projection.confirmed
  let standard = projection.standard
  let optimistic = projection.optimistic
  assert_true(confirmed.total.half_units() <= standard.total.half_units())
  assert_true(standard.total.half_units() <= optimistic.total.half_units())
  let confirmed_categories = confirmed.by_category()
  let standard_categories = standard.by_category()
  let optimistic_categories = optimistic.by_category()
  assert_eq(confirmed_categories.length(), standard_categories.length())
  assert_eq(standard_categories.length(), optimistic_categories.length())
  for index in 0..<confirmed_categories.length() {
    assert_true(
      confirmed_categories[index].1.half_units() <=
      standard_categories[index].1.half_units(),
    )
    assert_true(
      standard_categories[index].1.half_units() <=
      optimistic_categories[index].1.half_units(),
    )
  }
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
