///|
test "academic year must be positive" {
  assert_eq(expect_ok(@tanikun-domain.AcademicYear::new(2026)).year(), 2026)
  assert_invalid_academic_year(@tanikun-domain.AcademicYear::new(0), 0)
  assert_invalid_academic_year(@tanikun-domain.AcademicYear::new(-1), -1)
}

///|
test "period is validated from one through ten" {
  assert_eq(expect_ok(@tanikun-domain.Period::new(1)).value(), 1)
  assert_eq(expect_ok(@tanikun-domain.Period::new(10)).value(), 10)
  assert_invalid_period(@tanikun-domain.Period::new(0), 0)
  assert_invalid_period(@tanikun-domain.Period::new(11), 11)
}

///|
test "semesters and terms cover the academic calendar" {
  let terms = [
    @tanikun-domain.Term::S1,
    @tanikun-domain.Term::S2,
    @tanikun-domain.Term::A1,
    @tanikun-domain.Term::A2,
  ]
  assert_eq(terms.length(), 4)
  assert_true(
    @tanikun-domain.Term::S1.semester() == @tanikun-domain.Semester::S,
  )
  assert_true(
    @tanikun-domain.Term::S2.semester() == @tanikun-domain.Semester::S,
  )
  assert_true(
    @tanikun-domain.Term::A1.semester() == @tanikun-domain.Semester::A,
  )
  assert_true(
    @tanikun-domain.Term::A2.semester() == @tanikun-domain.Semester::A,
  )
  assert_true(@tanikun-domain.Semester::W != @tanikun-domain.Semester::A)
}

///|
test "weekdays and slots keep their day and period" {
  let monday = @tanikun-domain.DayOfWeek::Monday
  let tuesday = @tanikun-domain.DayOfWeek::Tuesday
  let first = @tanikun-domain.Slot::new(
    monday,
    expect_ok(@tanikun-domain.Period::new(1)),
  )
  let same = @tanikun-domain.Slot::new(
    monday,
    expect_ok(@tanikun-domain.Period::new(1)),
  )
  let later = @tanikun-domain.Slot::new(
    tuesday,
    expect_ok(@tanikun-domain.Period::new(1)),
  )
  assert_true(first == same)
  assert_true(first != later)
  assert_eq(first.period.value(), 1)
  assert_true(first.day == monday)
}
