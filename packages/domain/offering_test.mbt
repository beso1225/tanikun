///|
test "offering id rejects blank and control values" {
  assert_eq(
    expect_ok(@tanikun-domain.OfferingId::new("offering-1")).value,
    "offering-1",
  )
  assert_empty_offering_id(@tanikun-domain.OfferingId::new("  "))
  assert_control_character_offering_id(
    @tanikun-domain.OfferingId::new("offering\u{0085}1"),
  )
}

///|
test "regular offering stores its terms, academic year, and status" {
  let offering = expect_ok(
    make_offering(
      "offering-1",
      regular([@tanikun-domain.Term::S1, @tanikun-domain.Term::S2]),
      @tanikun-domain.OfferingStatus::Offered,
      [offering_slot(@tanikun-domain.DayOfWeek::Monday, 1)],
    ),
  )
  assert_eq(offering.id.value, "offering-1")
  assert_eq(offering.course_id.namespace_part, "master")
  assert_eq(offering.course_id.local_part, "PHY101")
  assert_eq(offering.academic_year.year(), 2026)
  assert_true(offering.status == @tanikun-domain.OfferingStatus::Offered)
  match offering.schedule() {
    @tanikun-domain.OfferingSchedule::Regular(terms~) => {
      assert_eq(terms.length(), 2)
      assert_true(terms[0] == @tanikun-domain.Term::S1)
      assert_true(terms[1] == @tanikun-domain.Term::S2)
    }
    _ => fail("expected a regular offering")
  }
  assert_eq(offering.slots().length(), 1)
}

///|
test "regular offerings accept autumn terms" {
  let offering = expect_ok(
    make_offering(
      "offering-autumn",
      regular([@tanikun-domain.Term::A1, @tanikun-domain.Term::A2]),
      @tanikun-domain.OfferingStatus::Offered,
      [offering_slot(@tanikun-domain.DayOfWeek::Friday, 4)],
    ),
  )
  match offering.schedule() {
    @tanikun-domain.OfferingSchedule::Regular(terms~) => {
      assert_eq(terms.length(), 2)
      assert_true(terms[0] == @tanikun-domain.Term::A1)
      assert_true(terms[1] == @tanikun-domain.Term::A2)
    }
    _ => fail("expected a regular offering")
  }
}

///|
test "regular terms must be non-empty and unique" {
  assert_empty_offering_terms(
    make_offering(
      "offering-empty",
      regular([]),
      @tanikun-domain.OfferingStatus::NotOffered,
      [],
    ),
  )
  assert_duplicate_offering_term(
    make_offering(
      "offering-duplicate",
      regular([@tanikun-domain.Term::S1, @tanikun-domain.Term::S1]),
      @tanikun-domain.OfferingStatus::NotOffered,
      [],
    ),
    @tanikun-domain.Term::S1,
  )
}

///|
test "regular terms must belong to one semester" {
  assert_mixed_offering_terms(
    make_offering(
      "offering-mixed",
      regular([@tanikun-domain.Term::S1, @tanikun-domain.Term::A1]),
      @tanikun-domain.OfferingStatus::NotOffered,
      [],
    ),
  )
}

///|
test "offered regular and year-long offerings require slots" {
  assert_missing_offering_slots(
    make_offering(
      "offering-regular",
      regular([@tanikun-domain.Term::S1]),
      @tanikun-domain.OfferingStatus::Offered,
      [],
    ),
  )
  assert_missing_offering_slots(
    make_offering(
      "offering-year-long",
      @tanikun-domain.OfferingSchedule::YearLong,
      @tanikun-domain.OfferingStatus::Offered,
      [],
    ),
  )
}

///|
test "offered regular and year-long offerings accept slots" {
  let _ = expect_ok(
    make_offering(
      "offering-regular",
      regular([@tanikun-domain.Term::S1]),
      @tanikun-domain.OfferingStatus::Offered,
      [offering_slot(@tanikun-domain.DayOfWeek::Monday, 1)],
    ),
  )
  let _ = expect_ok(
    make_offering(
      "offering-year-long",
      @tanikun-domain.OfferingSchedule::YearLong,
      @tanikun-domain.OfferingStatus::Offered,
      [offering_slot(@tanikun-domain.DayOfWeek::Tuesday, 2)],
    ),
  )
}

///|
test "intensive offerings have a semester and no slots" {
  for
    expected_semester in [
      @tanikun-domain.Semester::S,
      @tanikun-domain.Semester::A,
      @tanikun-domain.Semester::W,
    ] {
    let offering = expect_ok(
      make_offering(
        "offering-intensive",
        intensive(expected_semester),
        @tanikun-domain.OfferingStatus::Offered,
        [],
      ),
    )
    match offering.schedule() {
      @tanikun-domain.OfferingSchedule::Intensive(semester~) =>
        assert_true(semester == expected_semester)
      _ => fail("expected an intensive offering")
    }
  }
  assert_unexpected_offering_slots(
    make_offering(
      "offering-intensive",
      intensive(@tanikun-domain.Semester::W),
      @tanikun-domain.OfferingStatus::Offered,
      [offering_slot(@tanikun-domain.DayOfWeek::Monday, 1)],
    ),
  )
}

///|
test "not-offered offerings have no slots" {
  let _ = expect_ok(
    make_offering(
      "offering-regular",
      regular([@tanikun-domain.Term::S1]),
      @tanikun-domain.OfferingStatus::NotOffered,
      [],
    ),
  )
  let _ = expect_ok(
    make_offering(
      "offering-intensive",
      intensive(@tanikun-domain.Semester::W),
      @tanikun-domain.OfferingStatus::NotOffered,
      [],
    ),
  )
  let _ = expect_ok(
    make_offering(
      "offering-year-long",
      @tanikun-domain.OfferingSchedule::YearLong,
      @tanikun-domain.OfferingStatus::NotOffered,
      [],
    ),
  )
  assert_unexpected_offering_slots(
    make_offering(
      "offering-year-long",
      @tanikun-domain.OfferingSchedule::YearLong,
      @tanikun-domain.OfferingStatus::NotOffered,
      [offering_slot(@tanikun-domain.DayOfWeek::Wednesday, 3)],
    ),
  )
}

///|
test "duplicate slots within one offering are rejected" {
  let repeated = offering_slot(@tanikun-domain.DayOfWeek::Monday, 1)
  assert_duplicate_offering_slot(
    make_offering(
      "offering-duplicate-slot",
      regular([@tanikun-domain.Term::S1]),
      @tanikun-domain.OfferingStatus::Offered,
      [repeated, repeated],
    ),
    repeated,
  )
}

///|
test "offering accepts multiple distinct slots" {
  let offering = expect_ok(
    make_offering(
      "offering-multiple-slots",
      regular([@tanikun-domain.Term::S1]),
      @tanikun-domain.OfferingStatus::Offered,
      [
        offering_slot(@tanikun-domain.DayOfWeek::Monday, 1),
        offering_slot(@tanikun-domain.DayOfWeek::Tuesday, 2),
      ],
    ),
  )
  assert_eq(offering.slots().length(), 2)
}

///|
test "multiple offerings may share a slot" {
  let shared = offering_slot(@tanikun-domain.DayOfWeek::Wednesday, 3)
  let first = expect_ok(
    make_offering(
      "offering-one",
      regular([@tanikun-domain.Term::S1]),
      @tanikun-domain.OfferingStatus::Offered,
      [shared],
    ),
  )
  let second = expect_ok(
    make_offering(
      "offering-two",
      @tanikun-domain.OfferingSchedule::YearLong,
      @tanikun-domain.OfferingStatus::Offered,
      [shared],
    ),
  )
  assert_eq(first.slots().length(), 1)
  assert_eq(second.slots().length(), 1)
}

///|
test "offering getters do not expose mutable storage" {
  let offering = expect_ok(
    make_offering(
      "offering-copy",
      regular([@tanikun-domain.Term::S1]),
      @tanikun-domain.OfferingStatus::Offered,
      [offering_slot(@tanikun-domain.DayOfWeek::Monday, 1)],
    ),
  )
  match offering.schedule() {
    @tanikun-domain.OfferingSchedule::Regular(terms~) =>
      terms[0] = @tanikun-domain.Term::A1
    _ => fail("expected a regular offering")
  }
  let slots = offering.slots()
  slots[0] = offering_slot(@tanikun-domain.DayOfWeek::Tuesday, 2)
  match offering.schedule() {
    @tanikun-domain.OfferingSchedule::Regular(terms~) =>
      assert_true(terms[0] == @tanikun-domain.Term::S1)
    _ => fail("expected a regular offering")
  }
  assert_true(
    offering.slots()[0] == offering_slot(@tanikun-domain.DayOfWeek::Monday, 1),
  )
}

///|
test "offering constructor copies input arrays" {
  let terms = [@tanikun-domain.Term::S1]
  let slots = [offering_slot(@tanikun-domain.DayOfWeek::Monday, 1)]
  let offering = expect_ok(
    make_offering(
      "offering-input-copy",
      regular(terms),
      @tanikun-domain.OfferingStatus::Offered,
      slots,
    ),
  )
  terms[0] = @tanikun-domain.Term::A1
  slots[0] = offering_slot(@tanikun-domain.DayOfWeek::Tuesday, 2)
  match offering.schedule() {
    @tanikun-domain.OfferingSchedule::Regular(terms~) =>
      assert_true(terms[0] == @tanikun-domain.Term::S1)
    _ => fail("expected a regular offering")
  }
  assert_true(
    offering.slots()[0] == offering_slot(@tanikun-domain.DayOfWeek::Monday, 1),
  )
}
