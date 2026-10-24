///|
test "credit summary tracks confirmed, standard, and optimistic states" {
  let core = category("core", "Core")
  let elective = category("elective", "Elective")
  let unused = category("unused", "Unused")
  let passed = credit_course("PHY101", 4)
  let in_progress = credit_course("PHY102", 6)
  let planned = credit_course("PHY103", 2)
  let failed = credit_course("PHY104", 3)
  let not_taken = credit_course("PHY105", 1)
  let set = credit_requirement_set([core, elective, unused], [
    (passed.id, core.id),
    (in_progress.id, elective.id),
    (failed.id, core.id),
    (not_taken.id, elective.id),
  ])
  let offerings = [
    credit_offering("offering-1", passed.id),
    credit_offering("offering-2", in_progress.id),
    credit_offering("offering-3", planned.id),
    credit_offering("offering-4", failed.id),
    credit_offering("offering-5", not_taken.id),
  ]
  let enrollments = [
    passed_enrollment("offering-1", passed, 4),
    in_progress_enrollment("offering-2"),
    planned_enrollment("offering-3"),
    failed_enrollment("offering-4"),
    not_taken_enrollment("offering-5"),
  ]
  let input = credit_input(
    set,
    [passed, in_progress, planned, failed, not_taken],
    offerings,
    enrollments,
    @tanikun-domain.Overrides::empty(),
  )
  let projection = expect_ok(@tanikun-requirements.credit_summary(input))
  assert_eq(projection.confirmed.total.half_units(), 4)
  assert_eq(projection.standard.total.half_units(), 10)
  assert_eq(projection.optimistic.total.half_units(), 12)
  assert_category_credits(projection.confirmed, core.id, 4)
  assert_category_credits(projection.confirmed, elective.id, 0)
  assert_category_credits(projection.confirmed, unused.id, 0)
  assert_category_credits(projection.standard, core.id, 4)
  assert_category_credits(projection.standard, elective.id, 6)
  assert_category_credits(projection.optimistic, core.id, 4)
  assert_category_credits(projection.optimistic, elective.id, 6)
  assert_eq(category_total(projection.confirmed), 4)
  assert_eq(category_total(projection.standard), 10)
  assert_eq(category_total(projection.optimistic), 10)
  let categories = projection.confirmed.by_category()
  assert_eq(categories.length(), 3)
  assert_same_category_id(categories[0].0, core.id)
  assert_same_category_id(categories[1].0, elective.id)
  assert_same_category_id(categories[2].0, unused.id)
  assert_monotonic(projection)
}

///|
test "frozen passed credits and overrides apply to the right states" {
  let core = category("core", "Core")
  let passed = credit_course("PHY101", 8)
  let in_progress = credit_course("PHY102", 4)
  let planned = credit_course("PHY103", 2)
  let set = credit_requirement_set([core], [
    (passed.id, core.id),
    (in_progress.id, core.id),
  ])
  let overrides = credit_overrides([
    credit_override(passed, 6),
    credit_override(in_progress, 6),
  ])
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
    overrides,
  )
  let projection = expect_ok(@tanikun-requirements.credit_summary(input))
  assert_eq(projection.confirmed.total.half_units(), 4)
  assert_eq(projection.standard.total.half_units(), 10)
  assert_eq(projection.optimistic.total.half_units(), 12)
  assert_category_credits(projection.confirmed, core.id, 4)
  assert_category_credits(projection.standard, core.id, 10)
  assert_category_credits(projection.optimistic, core.id, 10)
  assert_eq(category_total(projection.confirmed), 4)
  assert_eq(category_total(projection.standard), 10)
  assert_eq(category_total(projection.optimistic), 10)
  assert_monotonic(projection)
}

///|
test "each course counts once and failed courses do not block later states" {
  let course_a = credit_course("PHY101", 4)
  let course_b = credit_course("PHY102", 2)
  let course_c = credit_course("PHY103", 2)
  let set = credit_requirement_set([], [])
  let offerings = [
    credit_offering("offering-a1", course_a.id),
    credit_offering("offering-a2", course_a.id),
    credit_offering("offering-a3", course_a.id),
    credit_offering("offering-b1", course_b.id),
    credit_offering("offering-b2", course_b.id),
    credit_offering("offering-c1", course_c.id),
    credit_offering("offering-c2", course_c.id),
  ]
  let input = credit_input(
    set,
    [course_a, course_b, course_c],
    offerings,
    [
      passed_enrollment("offering-a1", course_a, 4),
      in_progress_enrollment("offering-a2"),
      planned_enrollment("offering-a3"),
      failed_enrollment("offering-b1"),
      in_progress_enrollment("offering-b2"),
      planned_enrollment("offering-c1"),
      planned_enrollment("offering-c2"),
    ],
    @tanikun-domain.Overrides::empty(),
  )
  let projection = expect_ok(@tanikun-requirements.credit_summary(input))
  assert_eq(projection.confirmed.total.half_units(), 4)
  assert_eq(projection.standard.total.half_units(), 6)
  assert_eq(projection.optimistic.total.half_units(), 8)
  assert_monotonic(projection)
}

///|
test "credit summary rejects duplicate passed courses" {
  let course = credit_course("PHY101", 4)
  let set = credit_requirement_set([], [])
  let offerings = [
    credit_offering("offering-1", course.id),
    credit_offering("offering-2", course.id),
  ]
  let input = credit_input(
    set,
    [course],
    offerings,
    [
      passed_enrollment("offering-1", course, 4),
      passed_enrollment("offering-2", course, 4),
    ],
    @tanikun-domain.Overrides::empty(),
  )
  assert_duplicate_passed_course(
    @tanikun-requirements.credit_summary(input),
    course.id,
  )
}

///|
test "credit summary rejects a profile and requirement-set mismatch" {
  let course = credit_course("PHY101", 4)
  let set = credit_requirement_set([], [])
  let offering = credit_offering("offering-1", course.id)
  let input = @tanikun-requirements.EvaluationInput::new(
    credit_profile("physics", 2026),
    set,
    [course],
    [offering],
    [in_progress_enrollment("offering-1")],
    @tanikun-domain.Overrides::empty(),
  )
  assert_profile_requirement_set_mismatch(
    @tanikun-requirements.credit_summary(input),
  )
}

///|
test "credit summary rejects duplicate and unknown references" {
  let course = credit_course("PHY101", 4)
  let empty_set = credit_requirement_set([], [])
  let offering = credit_offering("offering-1", course.id)
  let empty_overrides = @tanikun-domain.Overrides::empty()

  assert_duplicate_course_id(
    @tanikun-requirements.credit_summary(
      credit_input(empty_set, [course, course], [], [], empty_overrides),
    ),
    course.id,
  )
  assert_duplicate_offering_id(
    @tanikun-requirements.credit_summary(
      credit_input(
        empty_set,
        [course],
        [offering, offering],
        [],
        empty_overrides,
      ),
    ),
    offering.id,
  )
  assert_duplicate_enrollment(
    @tanikun-requirements.credit_summary(
      credit_input(
        empty_set,
        [course],
        [offering],
        [planned_enrollment("offering-1"), in_progress_enrollment("offering-1")],
        empty_overrides,
      ),
    ),
    offering.id,
  )
  assert_unknown_offering(
    @tanikun-requirements.credit_summary(
      credit_input(
        empty_set,
        [course],
        [offering],
        [planned_enrollment("missing")],
        empty_overrides,
      ),
    ),
    expect_ok(@tanikun-domain.OfferingId::new("missing")),
  )
  let unknown_course = course_id("PHY999")
  let unknown_offering = credit_offering("offering-2", unknown_course)
  assert_unknown_course(
    @tanikun-requirements.credit_summary(
      credit_input(
        empty_set,
        [course],
        [unknown_offering],
        [in_progress_enrollment("offering-2")],
        empty_overrides,
      ),
    ),
    unknown_course,
  )
}

///|
test "credit summary is order-independent and category-sorted" {
  let core = category("core", "Core")
  let elective = category("elective", "Elective")
  let passed = credit_course("PHY101", 4)
  let in_progress = credit_course("PHY102", 6)
  let planned = credit_course("PHY103", 2)
  let set = credit_requirement_set([core, elective], [
    (passed.id, core.id),
    (in_progress.id, elective.id),
  ])
  let offerings = [
    credit_offering("offering-1", passed.id),
    credit_offering("offering-2", in_progress.id),
    credit_offering("offering-3", planned.id),
  ]
  let enrollments = [
    passed_enrollment("offering-1", passed, 4),
    in_progress_enrollment("offering-2"),
    planned_enrollment("offering-3"),
  ]
  let first = expect_ok(
    @tanikun-requirements.credit_summary(
      credit_input(
        set,
        [passed, in_progress, planned],
        offerings,
        enrollments,
        @tanikun-domain.Overrides::empty(),
      ),
    ),
  )
  let second = expect_ok(
    @tanikun-requirements.credit_summary(
      credit_input(
        set,
        [planned, in_progress, passed],
        [
          credit_offering("offering-3", planned.id),
          credit_offering("offering-2", in_progress.id),
          credit_offering("offering-1", passed.id),
        ],
        [
          planned_enrollment("offering-3"),
          in_progress_enrollment("offering-2"),
          passed_enrollment("offering-1", passed, 4),
        ],
        @tanikun-domain.Overrides::empty(),
      ),
    ),
  )
  assert_credit_summary_equal(first.confirmed, second.confirmed)
  assert_credit_summary_equal(first.standard, second.standard)
  assert_credit_summary_equal(first.optimistic, second.optimistic)
  assert_monotonic(first)
  assert_monotonic(second)
}

///|
test "projected credits reject retired courses and not-offered offerings" {
  let retired = credit_course_status(
    "PHY101",
    4,
    @tanikun-domain.CourseStatus::Retired,
  )
  let retired_offering = credit_offering("offering-1", retired.id)
  assert_retired_course_enrollment(
    @tanikun-requirements.credit_summary(
      credit_input(
        credit_requirement_set([], []),
        [retired],
        [retired_offering],
        [in_progress_enrollment("offering-1")],
        @tanikun-domain.Overrides::empty(),
      ),
    ),
    retired.id,
  )

  let active = credit_course("PHY102", 4)
  let not_offered = credit_offering_status(
    "offering-2",
    active.id,
    @tanikun-domain.OfferingStatus::NotOffered,
  )
  assert_not_offered_enrollment(
    @tanikun-requirements.credit_summary(
      credit_input(
        credit_requirement_set([], []),
        [active],
        [not_offered],
        [planned_enrollment("offering-2")],
        @tanikun-domain.Overrides::empty(),
      ),
    ),
    not_offered.id,
  )

  assert_retired_course_enrollment(
    @tanikun-requirements.credit_summary(
      credit_input(
        credit_requirement_set([], []),
        [retired],
        [retired_offering],
        [failed_enrollment("offering-1")],
        @tanikun-domain.Overrides::empty(),
      ),
    ),
    retired.id,
  )
}

///|
test "passed snapshots must match their offering course" {
  let course = credit_course("PHY101", 4)
  let other = credit_course("PHY102", 4)
  let offering = credit_offering("offering-1", course.id)
  let input = credit_input(
    credit_requirement_set([], []),
    [course, other],
    [offering],
    [passed_enrollment("offering-1", other, 4)],
    @tanikun-domain.Overrides::empty(),
  )
  assert_passed_snapshot_course_mismatch(
    @tanikun-requirements.credit_summary(input),
    offering.id,
    other.id,
    course.id,
  )
}

///|
test "all offerings must reference known courses" {
  let course = credit_course("PHY101", 4)
  let unknown = course_id("PHY999")
  let offering = credit_offering("offering-1", unknown)
  assert_unknown_course(
    @tanikun-requirements.credit_summary(
      credit_input(
        credit_requirement_set([], []),
        [course],
        [offering],
        [],
        @tanikun-domain.Overrides::empty(),
      ),
    ),
    unknown,
  )
}

///|
test "duplicate errors are independent of input order" {
  let first = credit_course("PHY101", 4)
  let second = credit_course("PHY102", 4)
  let set = credit_requirement_set([], [])
  let overrides = @tanikun-domain.Overrides::empty()
  assert_duplicate_course_id(
    @tanikun-requirements.credit_summary(
      credit_input(set, [first, second, first, second], [], [], overrides),
    ),
    first.id,
  )
  assert_duplicate_course_id(
    @tanikun-requirements.credit_summary(
      credit_input(set, [second, first, second, first], [], [], overrides),
    ),
    first.id,
  )
}

///|
test "overrides are validated against their targets" {
  let course = credit_course("PHY101", 4)
  let offering = credit_regular_offering("offering-1", course.id)
  let unknown_course = course_id("PHY999")
  let unknown_course_override = expect_ok(
    @tanikun-domain.Override::new(
      @tanikun-domain.OverrideTarget::Course(unknown_course),
      @tanikun-domain.OverrideAttribute::Credits,
      @tanikun-domain.OverrideValue::Credits(credit_value(4)),
    ),
  )
  assert_unknown_course(
    @tanikun-requirements.credit_summary(
      credit_input(
        credit_requirement_set([], []),
        [course],
        [offering],
        [],
        credit_overrides([unknown_course_override]),
      ),
    ),
    unknown_course,
  )

  let unknown_offering = expect_ok(@tanikun-domain.OfferingId::new("missing"))
  let unknown_offering_override = expect_ok(
    @tanikun-domain.Override::new(
      @tanikun-domain.OverrideTarget::Offering(unknown_offering),
      @tanikun-domain.OverrideAttribute::Slots,
      @tanikun-domain.OverrideValue::Slots([]),
    ),
  )
  assert_unknown_offering(
    @tanikun-requirements.credit_summary(
      credit_input(
        credit_requirement_set([], []),
        [course],
        [offering],
        [],
        credit_overrides([unknown_offering_override]),
      ),
    ),
    unknown_offering,
  )

  let empty_slots = credit_slot_override(offering, [])
  assert_missing_offering_slots(
    @tanikun-requirements.credit_summary(
      credit_input(
        credit_requirement_set([], []),
        [course],
        [offering],
        [],
        credit_overrides([empty_slots]),
      ),
    ),
  )
}

///|
test "override validation order is deterministic" {
  let course = credit_course("PHY101", 4)
  let offering = credit_offering("offering-1", course.id)
  let first_unknown = course_id("PHY999")
  let second_unknown = course_id("PHY998")
  let first_override = expect_ok(
    @tanikun-domain.Override::new(
      @tanikun-domain.OverrideTarget::Course(first_unknown),
      @tanikun-domain.OverrideAttribute::Credits,
      @tanikun-domain.OverrideValue::Credits(credit_value(4)),
    ),
  )
  let second_override = expect_ok(
    @tanikun-domain.Override::new(
      @tanikun-domain.OverrideTarget::Course(second_unknown),
      @tanikun-domain.OverrideAttribute::Credits,
      @tanikun-domain.OverrideValue::Credits(credit_value(4)),
    ),
  )
  let set = credit_requirement_set([], [])
  assert_unknown_course(
    @tanikun-requirements.credit_summary(
      credit_input(
        set,
        [course],
        [offering],
        [],
        credit_overrides([first_override, second_override]),
      ),
    ),
    second_unknown,
  )
  assert_unknown_course(
    @tanikun-requirements.credit_summary(
      credit_input(
        set,
        [course],
        [offering],
        [],
        credit_overrides([second_override, first_override]),
      ),
    ),
    second_unknown,
  )
}

///|
test "unknown offering courses are reported by course id" {
  let known = credit_course("PHY101", 4)
  let missing_high = course_id("PHY999")
  let missing_low = course_id("PHY000")
  let high_offering = credit_offering("offering-a", missing_high)
  let low_offering = credit_offering("offering-z", missing_low)
  let set = credit_requirement_set([], [])
  assert_unknown_course(
    @tanikun-requirements.credit_summary(
      credit_input(
        set,
        [known],
        [high_offering, low_offering],
        [],
        @tanikun-domain.Overrides::empty(),
      ),
    ),
    missing_low,
  )
  assert_unknown_course(
    @tanikun-requirements.credit_summary(
      credit_input(
        set,
        [known],
        [low_offering, high_offering],
        [],
        @tanikun-domain.Overrides::empty(),
      ),
    ),
    missing_low,
  )
}

///|
test "credit summary validates requirement rule references" {
  let unknown_course = course_id("PHY999")
  let rule = expect_ok(
    @tanikun-requirements.Rule::course_set_minimum(
      [unknown_course],
      credit_value(2),
    ),
  )
  let key = @tanikun-requirements.RequirementSetKey::new(
    program_id("applied-physics"),
    academic_year(2026),
  )
  let set = expect_ok(
    @tanikun-requirements.RequirementSet::new(key, [], [], rule),
  )
  assert_unknown_rule_course(
    @tanikun-requirements.credit_summary(
      credit_input(
        set,
        [credit_course("PHY101", 4)],
        [],
        [],
        @tanikun-domain.Overrides::empty(),
      ),
    ),
    unknown_course,
  )
}

///|
test "reference errors are selected across collections" {
  let known = credit_course("PHY101", 4)
  let offering = credit_offering("offering-1", known.id)
  let missing_from_offering = course_id("PHY999")
  let missing_from_override = course_id("PHY000")
  let offering_with_missing_course = credit_offering(
    "offering-2", missing_from_offering,
  )
  let course_override = expect_ok(
    @tanikun-domain.Override::new(
      @tanikun-domain.OverrideTarget::Course(missing_from_override),
      @tanikun-domain.OverrideAttribute::Credits,
      @tanikun-domain.OverrideValue::Credits(credit_value(4)),
    ),
  )
  assert_unknown_course(
    @tanikun-requirements.credit_summary(
      credit_input(
        credit_requirement_set([], []),
        [known],
        [offering, offering_with_missing_course],
        [],
        credit_overrides([course_override]),
      ),
    ),
    missing_from_override,
  )

  let missing_from_override_offering = expect_ok(
    @tanikun-domain.OfferingId::new("offering-a"),
  )
  let offering_override = expect_ok(
    @tanikun-domain.Override::new(
      @tanikun-domain.OverrideTarget::Offering(missing_from_override_offering),
      @tanikun-domain.OverrideAttribute::Slots,
      @tanikun-domain.OverrideValue::Slots([]),
    ),
  )
  assert_unknown_offering(
    @tanikun-requirements.credit_summary(
      credit_input(
        credit_requirement_set([], []),
        [known],
        [offering],
        [planned_enrollment("offering-z")],
        credit_overrides([offering_override]),
      ),
    ),
    missing_from_override_offering,
  )
}

///|
test "retired course errors are selected by course id" {
  let retired_high = credit_course_status(
    "PHY999",
    4,
    @tanikun-domain.CourseStatus::Retired,
  )
  let retired_low = credit_course_status(
    "PHY000",
    4,
    @tanikun-domain.CourseStatus::Retired,
  )
  let offering_high = credit_offering("offering-a", retired_high.id)
  let offering_low = credit_offering("offering-z", retired_low.id)
  assert_retired_course_enrollment(
    @tanikun-requirements.credit_summary(
      credit_input(
        credit_requirement_set([], []),
        [retired_high, retired_low],
        [offering_high, offering_low],
        [
          in_progress_enrollment("offering-a"),
          in_progress_enrollment("offering-z"),
        ],
        @tanikun-domain.Overrides::empty(),
      ),
    ),
    retired_low.id,
  )
}

///|
test "credit summary validates category-table course references" {
  let known = credit_course("PHY101", 4)
  let category = category("core", "Core")
  let unknown = course_id("PHY999")
  let set = credit_requirement_set([category], [(unknown, category.id)])
  assert_unknown_course(
    @tanikun-requirements.credit_summary(
      credit_input(set, [known], [], [], @tanikun-domain.Overrides::empty()),
    ),
    unknown,
  )
}

///|
test "rule course errors join the deterministic course selection" {
  let known = credit_course("PHY101", 4)
  let rule_missing_low = course_id("PHY000")
  let offering_missing_high = course_id("PHY999")
  let rule = expect_ok(
    @tanikun-requirements.Rule::course_set_minimum(
      [rule_missing_low],
      credit_value(2),
    ),
  )
  let set = credit_requirement_set_with_rule([], [], rule)
  assert_unknown_rule_course(
    @tanikun-requirements.credit_summary(
      credit_input(
        set,
        [known],
        [credit_offering("offering-1", offering_missing_high)],
        [],
        @tanikun-domain.Overrides::empty(),
      ),
    ),
    rule_missing_low,
  )

  let rule_missing_high = course_id("PHY999")
  let offering_missing_low = course_id("PHY000")
  let high_rule = expect_ok(
    @tanikun-requirements.Rule::course_set_minimum(
      [rule_missing_high],
      credit_value(2),
    ),
  )
  let high_set = credit_requirement_set_with_rule([], [], high_rule)
  assert_unknown_course(
    @tanikun-requirements.credit_summary(
      credit_input(
        high_set,
        [known],
        [credit_offering("offering-2", offering_missing_low)],
        [],
        @tanikun-domain.Overrides::empty(),
      ),
    ),
    offering_missing_low,
  )
}

///|
test "duplicate slot overrides report the canonical slot" {
  let course = credit_course("PHY101", 4)
  let offering = credit_regular_offering("offering-1", course.id)
  let monday = @tanikun-domain.Slot::new(
    @tanikun-domain.DayOfWeek::Monday,
    expect_ok(@tanikun-domain.Period::new(1)),
  )
  let tuesday = @tanikun-domain.Slot::new(
    @tanikun-domain.DayOfWeek::Tuesday,
    expect_ok(@tanikun-domain.Period::new(1)),
  )
  let first = credit_slot_override(offering, [tuesday, tuesday, monday, monday])
  let second = credit_slot_override(offering, [monday, monday, tuesday, tuesday])
  assert_duplicate_offering_slot(
    @tanikun-requirements.credit_summary(
      credit_input(
        credit_requirement_set([], []),
        [course],
        [offering],
        [],
        credit_overrides([first]),
      ),
    ),
    @tanikun-domain.DayOfWeek::Monday,
    1,
  )
  assert_duplicate_offering_slot(
    @tanikun-requirements.credit_summary(
      credit_input(
        credit_requirement_set([], []),
        [course],
        [offering],
        [],
        credit_overrides([second]),
      ),
    ),
    @tanikun-domain.DayOfWeek::Monday,
    1,
  )
}

///|
test "course and offering failures are selected by entity id" {
  let retired_low = credit_course_status(
    "PHY000",
    4,
    @tanikun-domain.CourseStatus::Retired,
  )
  let missing_high = course_id("PHY999")
  let retired_offering = credit_offering("offering-low", retired_low.id)
  let missing_offering = credit_offering("offering-high", missing_high)
  assert_retired_course_enrollment(
    @tanikun-requirements.credit_summary(
      credit_input(
        credit_requirement_set([], []),
        [retired_low],
        [retired_offering, missing_offering],
        [in_progress_enrollment("offering-low")],
        @tanikun-domain.Overrides::empty(),
      ),
    ),
    retired_low.id,
  )

  let active = credit_course("PHY101", 4)
  let not_offered = credit_offering_status(
    "offering-a",
    active.id,
    @tanikun-domain.OfferingStatus::NotOffered,
  )
  assert_not_offered_enrollment(
    @tanikun-requirements.credit_summary(
      credit_input(
        credit_requirement_set([], []),
        [active],
        [not_offered],
        [planned_enrollment("offering-a"), planned_enrollment("offering-z")],
        @tanikun-domain.Overrides::empty(),
      ),
    ),
    not_offered.id,
  )
}

///|
test "duplicate and eligibility failures are selected by entity id" {
  let retired_low = credit_course_status(
    "PHY000",
    4,
    @tanikun-domain.CourseStatus::Retired,
  )
  let duplicate_high = credit_course("PHY999", 4)
  let retired_offering = credit_offering("offering-1", retired_low.id)
  assert_retired_course_enrollment(
    @tanikun-requirements.credit_summary(
      credit_input(
        credit_requirement_set([], []),
        [retired_low, duplicate_high, duplicate_high],
        [retired_offering],
        [in_progress_enrollment("offering-1")],
        @tanikun-domain.Overrides::empty(),
      ),
    ),
    retired_low.id,
  )

  let active = credit_course("PHY101", 4)
  let not_offered = credit_offering_status(
    "offering-a",
    active.id,
    @tanikun-domain.OfferingStatus::NotOffered,
  )
  let duplicate_offering = credit_offering("offering-z", active.id)
  assert_not_offered_enrollment(
    @tanikun-requirements.credit_summary(
      credit_input(
        credit_requirement_set([], []),
        [active],
        [not_offered, duplicate_offering, duplicate_offering],
        [planned_enrollment("offering-a")],
        @tanikun-domain.Overrides::empty(),
      ),
    ),
    not_offered.id,
  )
}

///|
test "distinct slot overrides are accepted" {
  let course = credit_course("PHY101", 4)
  let offering = credit_regular_offering("offering-1", course.id)
  let monday = @tanikun-domain.Slot::new(
    @tanikun-domain.DayOfWeek::Monday,
    expect_ok(@tanikun-domain.Period::new(1)),
  )
  let tuesday = @tanikun-domain.Slot::new(
    @tanikun-domain.DayOfWeek::Tuesday,
    expect_ok(@tanikun-domain.Period::new(1)),
  )
  let slot_override = credit_slot_override(offering, [monday, tuesday])
  let projection = expect_ok(
    @tanikun-requirements.credit_summary(
      credit_input(
        credit_requirement_set([], []),
        [course],
        [offering],
        [],
        credit_overrides([slot_override]),
      ),
    ),
  )
  assert_eq(projection.confirmed.total.half_units(), 0)
}

///|
test "duplicate slots on one day report the canonical period" {
  let course = credit_course("PHY101", 4)
  let offering = credit_regular_offering("offering-1", course.id)
  let first = @tanikun-domain.Slot::new(
    @tanikun-domain.DayOfWeek::Monday,
    expect_ok(@tanikun-domain.Period::new(1)),
  )
  let second = @tanikun-domain.Slot::new(
    @tanikun-domain.DayOfWeek::Monday,
    expect_ok(@tanikun-domain.Period::new(2)),
  )
  let slot_override = credit_slot_override(offering, [
    second, second, first, first,
  ])
  assert_duplicate_offering_slot(
    @tanikun-requirements.credit_summary(
      credit_input(
        credit_requirement_set([], []),
        [course],
        [offering],
        [],
        credit_overrides([slot_override]),
      ),
    ),
    @tanikun-domain.DayOfWeek::Monday,
    1,
  )
}
