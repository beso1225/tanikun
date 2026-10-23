///|
/// A fictional Applied Physics fixture used for the Phase 1 golden scenario.
///
/// Credits are half-units. The fixture intentionally covers:
/// - 0.5, 1, 1.5, and 2 credit courses;
/// - regular, year-long, intensive, and not-offered offerings;
/// - every enrollment status and every passing/failing grade;
/// - categorized, uncategorized, and retired courses;
/// - an override active after a pass, and an override on an in-progress course.
///
/// Explicit corrections are deferred: `correct_enrollment` is not implemented
/// in Phase 1 yet, so this fixture will be extended when it lands.
///
/// Expected golden values:
///
/// | Mode      | Total | Elective | Foundation | Lab | Seminar | Root rule     |
/// | --------- | ----: | -------: | ---------: | --: | ------: | ------------- |
/// | confirmed |    18 |        0 |          7 |   3 |       0 | Partial       |
/// | standard  |    21 |        3 |          7 |   3 |       0 | Satisfied     |
/// | optimistic|    22 |        4 |          7 |   3 |       0 | Satisfied     |
///
/// Uncategorized credits are 8 in every mode (4 for PHY301 and 4 for the
/// retired PHY401). Category sums are therefore 10, 13, and 14.
///
/// PHY101 has a 3-half-unit master value, a 4-half-unit frozen pass snapshot,
/// and a current 5-half-unit override. The snapshot wins, demonstrating that an
/// override after a pass does not rewrite confirmed history.
///
/// The rule tree contains every Phase 1 leaf and node:
/// All(category-group, Any(course-set, category-single),
///     AtLeast(2, category-single, total, all-courses-passed)).
fn phase1_fixture() -> @tanikun-requirements.EvaluationInput[
  @tanikun-requirements.Rule,
] raise Error {
  let foundation = category("foundation", "Foundation")
  let elective = category("elective", "Elective")
  let lab = category("lab", "Lab")
  let seminar = category("seminar", "Seminar")

  let f1 = credit_course("PHY101", 3)
  let f2 = credit_course("PHY102", 3)
  let f3 = credit_course("PHY103", 2)
  let f4 = credit_course("PHY104", 3)
  let f5 = credit_course("PHY105", 1)
  let l1 = credit_course("PHY201", 2)
  let l2 = credit_course("PHY202", 1)
  let u1 = credit_course("PHY301", 4)
  let r1 = credit_course_status(
    "PHY401",
    4,
    @tanikun-domain.CourseStatus::Retired,
  )
  let e1 = credit_course("PHY501", 2)
  let e2 = credit_course("PHY502", 1)

  let offerings = [
    phase1_offering(
      "offering-f1",
      f1.id,
      @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::S1]),
      @tanikun-domain.OfferingStatus::Offered,
    ),
    phase1_offering(
      "offering-f2",
      f2.id,
      @tanikun-domain.OfferingSchedule::YearLong,
      @tanikun-domain.OfferingStatus::Offered,
    ),
    phase1_offering(
      "offering-l1",
      l1.id,
      @tanikun-domain.OfferingSchedule::Intensive(
        semester=@tanikun-domain.Semester::S,
      ),
      @tanikun-domain.OfferingStatus::Offered,
    ),
    phase1_offering(
      "offering-l2",
      l2.id,
      @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::S2]),
      @tanikun-domain.OfferingStatus::Offered,
    ),
    phase1_offering(
      "offering-u1",
      u1.id,
      @tanikun-domain.OfferingSchedule::YearLong,
      @tanikun-domain.OfferingStatus::Offered,
    ),
    // R1 is retired and its offering is not offered; only the historical
    // passed enrollment may reference this pair.
    phase1_offering(
      "offering-r1",
      r1.id,
      @tanikun-domain.OfferingSchedule::YearLong,
      @tanikun-domain.OfferingStatus::NotOffered,
    ),
    phase1_offering(
      "offering-e1",
      e1.id,
      @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::S1]),
      @tanikun-domain.OfferingStatus::Offered,
    ),
    phase1_offering(
      "offering-e2",
      e2.id,
      @tanikun-domain.OfferingSchedule::YearLong,
      @tanikun-domain.OfferingStatus::Offered,
    ),
    phase1_offering(
      "offering-f3",
      f3.id,
      @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::S1]),
      @tanikun-domain.OfferingStatus::Offered,
    ),
    phase1_offering(
      "offering-f4",
      f4.id,
      @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::S2]),
      @tanikun-domain.OfferingStatus::Offered,
    ),
    phase1_offering(
      "offering-f5",
      f5.id,
      @tanikun-domain.OfferingSchedule::Regular(terms=[@tanikun-domain.Term::S1]),
      @tanikun-domain.OfferingStatus::Offered,
    ),
  ]

  let enrollments = [
    phase1_passed(
      "offering-f1",
      f1,
      @tanikun-domain.PassingGrade::ExcellentPlus,
      4,
    ),
    phase1_passed("offering-f2", f2, @tanikun-domain.PassingGrade::Excellent, 3),
    phase1_passed("offering-l1", l1, @tanikun-domain.PassingGrade::Good, 2),
    phase1_passed("offering-l2", l2, @tanikun-domain.PassingGrade::Fair, 1),
    phase1_passed("offering-u1", u1, @tanikun-domain.PassingGrade::Pass, 4),
    phase1_passed("offering-r1", r1, @tanikun-domain.PassingGrade::Pass, 4),
    in_progress_enrollment("offering-e1"),
    planned_enrollment("offering-e2"),
    phase1_failed("offering-f3", @tanikun-domain.FailingGrade::Fail),
    phase1_failed("offering-f4", @tanikun-domain.FailingGrade::NotPassed),
    not_taken_enrollment("offering-f5"),
  ]

  let overrides = credit_overrides([
    credit_override(f1, 5),
    credit_override(e1, 3),
  ])
  let set = phase1_requirement_set(
    [
      (f1.id, foundation.id),
      (f2.id, foundation.id),
      (f3.id, foundation.id),
      (f4.id, foundation.id),
      (f5.id, foundation.id),
      (l1.id, lab.id),
      (l2.id, lab.id),
      (e1.id, elective.id),
      (e2.id, elective.id),
    ],
    [foundation, elective, lab, seminar],
  )
  @tanikun-requirements.EvaluationInput::new(
    credit_profile("applied-physics", 2026),
    set,
    [f1, f2, f3, f4, f5, l1, l2, u1, r1, e1, e2],
    offerings,
    enrollments,
    overrides,
  )
}

///|
fn phase1_offering(
  id : String,
  course_id : @tanikun-domain.CourseId,
  schedule : @tanikun-domain.OfferingSchedule,
  status : @tanikun-domain.OfferingStatus,
) -> @tanikun-domain.CourseOffering raise Error {
  let period = expect_ok(@tanikun-domain.Period::new(1))
  let slot = @tanikun-domain.Slot::new(
    @tanikun-domain.DayOfWeek::Monday,
    period,
  )
  let slots = match status {
    @tanikun-domain.OfferingStatus::NotOffered => []
    @tanikun-domain.OfferingStatus::Offered =>
      match schedule {
        @tanikun-domain.OfferingSchedule::Intensive(_) => []
        _ => [slot]
      }
  }
  expect_ok(
    @tanikun-domain.CourseOffering::new(
      expect_ok(@tanikun-domain.OfferingId::new(id)),
      course_id,
      academic_year(2026),
      schedule,
      status,
      slots,
    ),
  )
}

///|
fn phase1_passed(
  offering_id : String,
  course : @tanikun-domain.Course,
  grade : @tanikun-domain.PassingGrade,
  snapshot_half_units : Int,
) -> @tanikun-domain.Enrollment raise Error {
  let snapshot = expect_ok(
    @tanikun-domain.PassedCourseSnapshot::new(
      course.id,
      course.name,
      credit_value(snapshot_half_units),
    ),
  )
  @tanikun-domain.Enrollment::passed(
    expect_ok(@tanikun-domain.OfferingId::new(offering_id)),
    grade,
    snapshot,
  )
}

///|
fn phase1_failed(
  offering_id : String,
  grade : @tanikun-domain.FailingGrade,
) -> @tanikun-domain.Enrollment raise Error {
  @tanikun-domain.Enrollment::failed(
    expect_ok(@tanikun-domain.OfferingId::new(offering_id)),
    grade,
  )
}

///|
fn phase1_requirement_set(
  assignments : Array[(@tanikun-domain.CourseId, @tanikun-domain.CategoryId)],
  categories : Array[@tanikun-requirements.Category],
) -> @tanikun-requirements.RequirementSet[@tanikun-requirements.Rule] raise Error {
  let foundation = category("foundation", "Foundation")
  let elective = category("elective", "Elective")
  let lab = category("lab", "Lab")
  let category_group = expect_ok(
    @tanikun-requirements.Rule::category_minimum(
      [foundation.id, lab.id],
      credit_value(8),
    ),
  )
  let category_single = expect_ok(
    @tanikun-requirements.Rule::category_minimum([elective.id], credit_value(4)),
  )
  let total = expect_ok(
    @tanikun-requirements.Rule::total_minimum(credit_value(18)),
  )
  let all_courses = expect_ok(
    @tanikun-requirements.Rule::all_courses_passed([
      course_id("PHY101"),
      course_id("PHY102"),
    ]),
  )
  let course_set = expect_ok(
    @tanikun-requirements.Rule::course_set_minimum(
      [course_id("PHY501"), course_id("PHY502")],
      credit_value(3),
    ),
  )
  let any = expect_ok(
    @tanikun-requirements.Rule::any([course_set, category_single]),
  )
  let at_least = expect_ok(
    @tanikun-requirements.Rule::at_least(2, [
      category_single, total, all_courses,
    ]),
  )
  let root = expect_ok(
    @tanikun-requirements.Rule::all([category_group, any, at_least]),
  )
  let key = @tanikun-requirements.RequirementSetKey::new(
    program_id("applied-physics"),
    academic_year(2026),
  )
  expect_ok(
    @tanikun-requirements.RequirementSet::new(
      key, categories, assignments, root,
    ),
  )
}

///|
test "phase 1 golden fixture evaluates all projection modes" {
  let evaluation = expect_ok(@tanikun-requirements.evaluate(phase1_fixture()))
  assert_eq(evaluation.credits.confirmed.total.half_units(), 18)
  assert_eq(evaluation.credits.standard.total.half_units(), 21)
  assert_eq(evaluation.credits.optimistic.total.half_units(), 22)

  let elective = category_id("elective")
  let foundation = category_id("foundation")
  let lab = category_id("lab")
  let seminar = category_id("seminar")
  let confirmed_categories = evaluation.credits.confirmed.by_category()
  assert_eq(confirmed_categories.length(), 4)
  assert_same_category_id(confirmed_categories[0].0, elective)
  assert_same_category_id(confirmed_categories[1].0, foundation)
  assert_same_category_id(confirmed_categories[2].0, lab)
  assert_same_category_id(confirmed_categories[3].0, seminar)

  assert_category_credits(evaluation.credits.confirmed, elective, 0)
  assert_category_credits(evaluation.credits.confirmed, foundation, 7)
  assert_category_credits(evaluation.credits.confirmed, lab, 3)
  assert_category_credits(evaluation.credits.confirmed, seminar, 0)
  assert_category_credits(evaluation.credits.standard, elective, 3)
  assert_category_credits(evaluation.credits.standard, foundation, 7)
  assert_category_credits(evaluation.credits.standard, lab, 3)
  assert_category_credits(evaluation.credits.optimistic, elective, 4)
  assert_category_credits(evaluation.credits.optimistic, foundation, 7)
  assert_category_credits(evaluation.credits.optimistic, lab, 3)

  assert_eq(category_total(evaluation.credits.confirmed), 10)
  assert_eq(category_total(evaluation.credits.standard), 13)
  assert_eq(category_total(evaluation.credits.optimistic), 14)
  assert_eq(
    evaluation.credits.confirmed.total.half_units() -
    category_total(evaluation.credits.confirmed),
    8,
  )
  assert_eq(
    evaluation.credits.standard.total.half_units() -
    category_total(evaluation.credits.standard),
    8,
  )
  assert_eq(
    evaluation.credits.optimistic.total.half_units() -
    category_total(evaluation.credits.optimistic),
    8,
  )

  let confirmed = evaluation.requirements.confirmed
  let standard = evaluation.requirements.standard
  let optimistic = evaluation.requirements.optimistic
  assert_satisfaction(confirmed, @tanikun-requirements.Satisfaction::Partial)
  assert_satisfaction(standard, @tanikun-requirements.Satisfaction::Satisfied)
  assert_satisfaction(optimistic, @tanikun-requirements.Satisfaction::Satisfied)
  assert_children_progress(confirmed, 2, 0, 3)
  assert_children_progress(standard, 3, 0, 3)
  assert_children_progress(optimistic, 3, 0, 3)
}

///|
test "phase 1 golden fixture records every rule result" {
  let evaluation = expect_ok(@tanikun-requirements.evaluate(phase1_fixture()))
  let confirmed = evaluation.requirements.confirmed
  let standard = evaluation.requirements.standard
  let optimistic = evaluation.requirements.optimistic

  let confirmed_children = confirmed.children()
  let standard_children = standard.children()
  let optimistic_children = optimistic.children()
  assert_credits_progress(confirmed_children[0], 10, 8)
  assert_credits_progress(standard_children[0], 10, 8)
  assert_credits_progress(optimistic_children[0], 10, 8)
  assert_satisfaction(
    confirmed_children[0],
    @tanikun-requirements.Satisfaction::Satisfied,
  )

  assert_satisfaction(
    confirmed_children[1],
    @tanikun-requirements.Satisfaction::Unsatisfied,
  )
  assert_satisfaction(
    standard_children[1],
    @tanikun-requirements.Satisfaction::Satisfied,
  )
  assert_satisfaction(
    optimistic_children[1],
    @tanikun-requirements.Satisfaction::Satisfied,
  )
  assert_children_progress(confirmed_children[1], 0, 0, 2)
  assert_children_progress(standard_children[1], 1, 1, 2)
  assert_children_progress(optimistic_children[1], 2, 0, 2)

  let confirmed_any_children = confirmed_children[1].children()
  let standard_any_children = standard_children[1].children()
  let optimistic_any_children = optimistic_children[1].children()
  assert_credits_progress(confirmed_any_children[0], 0, 3)
  assert_credits_progress(standard_any_children[0], 3, 3)
  assert_credits_progress(optimistic_any_children[0], 4, 3)
  assert_credits_progress(confirmed_any_children[1], 0, 4)
  assert_credits_progress(standard_any_children[1], 3, 4)
  assert_credits_progress(optimistic_any_children[1], 4, 4)

  assert_satisfaction(
    confirmed_children[2],
    @tanikun-requirements.Satisfaction::Satisfied,
  )
  assert_children_progress(confirmed_children[2], 2, 0, 3)
  assert_children_progress(standard_children[2], 2, 1, 3)
  assert_children_progress(optimistic_children[2], 3, 0, 3)

  let confirmed_at_least_children = confirmed_children[2].children()
  let standard_at_least_children = standard_children[2].children()
  let optimistic_at_least_children = optimistic_children[2].children()
  assert_credits_progress(confirmed_at_least_children[1], 18, 18)
  assert_credits_progress(standard_at_least_children[1], 21, 18)
  assert_credits_progress(optimistic_at_least_children[1], 22, 18)
  assert_courses_progress(confirmed_at_least_children[2], 2, 2)
  assert_courses_progress(standard_at_least_children[2], 2, 2)
  assert_courses_progress(optimistic_at_least_children[2], 2, 2)
}
