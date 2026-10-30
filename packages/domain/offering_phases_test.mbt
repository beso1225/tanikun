///|
test "term phases have independent copied slots and one offering identity" {
  let a = offering_slot(@tanikun-domain.DayOfWeek::Monday, 3)
  let b = offering_slot(@tanikun-domain.DayOfWeek::Tuesday, 4)
  let phases = [
    (@tanikun-domain.Term::S1, [a]),
    (@tanikun-domain.Term::S2, [a, b]),
  ]
  let base = expect_ok(
    make_offering(
      "phases",
      regular([@tanikun-domain.Term::S1, @tanikun-domain.Term::S2]),
      @tanikun-domain.OfferingStatus::Offered,
      [a],
    ),
  )
  let offering = expect_ok(base.with_term_slots(phases))
  phases[1].1.clear()
  assert_eq(offering.id.value, "phases")
  assert_eq(offering.slots().length(), 2)
  assert_eq(offering.slots_in_term(@tanikun-domain.Term::S1).length(), 1)
  let slots = offering.slots_in_term(@tanikun-domain.Term::S2)
  slots.clear()
  assert_eq(offering.slots_in_term(@tanikun-domain.Term::S2).length(), 2)
  assert_eq(offering.slots_in_term(@tanikun-domain.Term::A1).length(), 0)
  assert_true(base.with_term_slots([(@tanikun-domain.Term::S1, [a])]) is Err(_))
  assert_true(
    base.with_term_slots([
      (@tanikun-domain.Term::S1, [a]),
      (@tanikun-domain.Term::S1, [b]),
    ])
    is Err(_),
  )
  assert_true(
    base.with_term_slots([
      (@tanikun-domain.Term::A1, [a]),
      (@tanikun-domain.Term::S2, [b]),
    ])
    is Err(_),
  )
  assert_true(
    base.with_term_slots([
      (@tanikun-domain.Term::S1, []),
      (@tanikun-domain.Term::S2, [b]),
    ])
    is Err(_),
  )
}

///|
test "extra and repeated phases fail even when every active term is present" {
  let slot = offering_slot(@tanikun-domain.DayOfWeek::Monday, 1)
  let base = expect_ok(
    make_offering(
      "phases",
      regular([@tanikun-domain.Term::S1, @tanikun-domain.Term::S2]),
      @tanikun-domain.OfferingStatus::Offered,
      [slot],
    ),
  )
  let valid = [
    (@tanikun-domain.Term::S1, [slot]),
    (@tanikun-domain.Term::S2, [slot]),
  ]
  let extra = valid.copy()
  extra.push((@tanikun-domain.Term::A1, [slot]))
  match base.with_term_slots(extra) {
    Err(@tanikun-domain.DomainError::UnexpectedOfferingPhase(term~)) =>
      assert_true(term == @tanikun-domain.Term::A1)
    _ => fail("expected an inactive phase error")
  }
  let repeated = valid.copy()
  repeated.push((@tanikun-domain.Term::S1, [slot]))
  match base.with_term_slots(repeated) {
    Err(@tanikun-domain.DomainError::DuplicateOfferingTerm(term~)) =>
      assert_true(term == @tanikun-domain.Term::S1)
    _ => fail("expected a repeated phase error")
  }
}

///|
test "coordinated allocations require a nonempty verification source" {
  assert_true(
    @tanikun-domain.CoordinatedAllocation::new("", "handout") is Err(_),
  )
  assert_true(
    @tanikun-domain.CoordinatedAllocation::new("group", " ") is Err(_),
  )
  assert_true(
    @tanikun-domain.CoordinatedAllocation::new("group", "handout\u{0000}")
    is Err(_),
  )
  let proof = expect_ok(
    @tanikun-domain.CoordinatedAllocation::new(
      "group", "Fictional verified handout",
    ),
  )
  assert_eq(proof.source, "Fictional verified handout")
}

///|
test "coordination requires matching evidence and distinct same-year offerings" {
  let slot = offering_slot(@tanikun-domain.DayOfWeek::Monday, 1)
  let a = expect_ok(
    make_offering(
      "a",
      regular([@tanikun-domain.Term::S1]),
      @tanikun-domain.OfferingStatus::Offered,
      [slot],
    ),
  )
  let b = expect_ok(
    make_offering(
      "b",
      regular([@tanikun-domain.Term::S1]),
      @tanikun-domain.OfferingStatus::Offered,
      [slot],
    ),
  )
  let proof = expect_ok(
    @tanikun-domain.CoordinatedAllocation::new("g", "verified source"),
  )
  let left = a.with_coordinated_allocation(proof)
  let right = b.with_coordinated_allocation(proof)
  assert_true(left.coordinates_with(right))
  assert_true(right.coordinates_with(left))
  assert_true(!left.coordinates_with(left))
  assert_true(!left.coordinates_with(b))
  assert_true(!a.coordinates_with(right))
  assert_true(
    !left.coordinates_with(
      b.with_coordinated_allocation(
        expect_ok(
          @tanikun-domain.CoordinatedAllocation::new("other", "verified source"),
        ),
      ),
    ),
  )
  assert_true(
    !left.coordinates_with(
      b.with_coordinated_allocation(
        expect_ok(
          @tanikun-domain.CoordinatedAllocation::new("g", "other source"),
        ),
      ),
    ),
  )
  let next = expect_ok(
    @tanikun-domain.CourseOffering::new(
      b.id,
      b.course_id,
      expect_ok(@tanikun-domain.AcademicYear::new(2027)),
      b.schedule(),
      b.status,
      [slot],
    ),
  ).with_coordinated_allocation(proof)
  assert_true(!left.coordinates_with(next))
  assert_eq(left.coordinated_allocation.unwrap().group, "g")
  assert_true(
    expect_ok(left.with_term_slots([(@tanikun-domain.Term::S1, [slot])])).coordinated_allocation
    is None,
  )
}

///|
test "phase validation covers year-long, intensive, cancelled and duplicate slots" {
  let slot = offering_slot(@tanikun-domain.DayOfWeek::Monday, 1)
  let yearlong = expect_ok(
    make_offering(
      "year",
      @tanikun-domain.OfferingSchedule::YearLong,
      @tanikun-domain.OfferingStatus::Offered,
      [slot],
    ),
  )
  let phases = [
    (@tanikun-domain.Term::S1, [slot]),
    (@tanikun-domain.Term::S2, [slot]),
    (@tanikun-domain.Term::A1, [slot]),
    (@tanikun-domain.Term::A2, [slot]),
  ]
  let offering = expect_ok(yearlong.with_term_slots(phases))
  assert_true(offering.slots_in_term(@tanikun-domain.Term::A2) == [slot])
  assert_eq(offering.slots().length(), 1)
  let intensive = expect_ok(
    make_offering(
      "intensive",
      @tanikun-domain.OfferingSchedule::Intensive(
        semester=@tanikun-domain.Semester::S,
      ),
      @tanikun-domain.OfferingStatus::Offered,
      [],
    ),
  )
  assert_true(intensive.with_term_slots([]) is Err(_))
  assert_eq(intensive.slots_in_term(@tanikun-domain.Term::S1).length(), 0)
  let cancelled = expect_ok(
    make_offering(
      "cancelled",
      regular([@tanikun-domain.Term::S1]),
      @tanikun-domain.OfferingStatus::NotOffered,
      [],
    ),
  )
  assert_true(
    cancelled.with_term_slots([(@tanikun-domain.Term::S1, [slot])]) is Err(_),
  )
  assert_eq(
    expect_ok(cancelled.with_term_slots([(@tanikun-domain.Term::S1, [])]))
    .slots()
    .length(),
    0,
  )
  assert_true(
    yearlong.with_term_slots([(@tanikun-domain.Term::S1, [slot, slot])])
    is Err(_),
  )
  assert_true(yearlong.slots_in_term(@tanikun-domain.Term::A1) == [slot])
}

///|
test "slot overrides replace active phases but not inactive terms" {
  let a = offering_slot(@tanikun-domain.DayOfWeek::Monday, 1)
  let b = offering_slot(@tanikun-domain.DayOfWeek::Tuesday, 2)
  let base = expect_ok(
    make_offering(
      "phase",
      regular([@tanikun-domain.Term::S1, @tanikun-domain.Term::S2]),
      @tanikun-domain.OfferingStatus::Offered,
      [a],
    ),
  )
  let offering = expect_ok(
    base.with_term_slots([
      (@tanikun-domain.Term::S1, [a]),
      (@tanikun-domain.Term::S2, [a, b]),
    ]),
  )
  assert_true(
    expect_ok(
      @tanikun-domain.effective_slots_in_term(
        offering,
        @tanikun-domain.Overrides::empty(),
        @tanikun-domain.Term::S2,
      ),
    ) ==
    [a, b],
  )
  let change = expect_ok(
    @tanikun-domain.Override::new(
      @tanikun-domain.OverrideTarget::Offering(offering.id),
      @tanikun-domain.OverrideAttribute::Slots,
      @tanikun-domain.OverrideValue::Slots([b]),
    ),
  )
  let overrides = expect_ok(@tanikun-domain.Overrides::new([change]))
  assert_true(
    expect_ok(
      @tanikun-domain.effective_slots_in_term(
        offering,
        overrides,
        @tanikun-domain.Term::S1,
      ),
    ) ==
    [b],
  )
  assert_true(
    expect_ok(
      @tanikun-domain.effective_slots_in_term(
        offering,
        overrides,
        @tanikun-domain.Term::S2,
      ),
    ) ==
    [b],
  )
  assert_true(
    expect_ok(
      @tanikun-domain.effective_slots_in_term(
        offering,
        overrides,
        @tanikun-domain.Term::A1,
      ),
    ) ==
    [],
  )
}
