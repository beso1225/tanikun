///|
test "passed course snapshot validates and preserves course data" {
  let course_id = enrollment_course_id()
  let credits = expect_ok(@tanikun-domain.Credits::new(4))
  let snapshot = expect_ok(
    @tanikun-domain.PassedCourseSnapshot::new(course_id, "Physics", credits),
  )
  assert_same_id(snapshot.course_id, course_id)
  assert_eq(snapshot.name, "Physics")
  assert_eq(snapshot.credits.half_units(), 4)
  assert_empty_course_name(
    @tanikun-domain.PassedCourseSnapshot::new(course_id, "  ", credits),
  )
}

///|
test "snapshot can be built from a course" {
  let course = expect_ok(
    @tanikun-domain.Course::new(
      enrollment_course_id(),
      "Physics",
      expect_ok(@tanikun-domain.Credits::new(4)),
      @tanikun-domain.CourseStatus::Active,
    ),
  )
  let snapshot = expect_ok(
    @tanikun-domain.PassedCourseSnapshot::from_course(
      course,
      @tanikun-domain.Overrides::empty(),
    ),
  )
  assert_same_id(snapshot.course_id, course.id)
  assert_eq(snapshot.name, "Physics")
  assert_eq(snapshot.credits.half_units(), 4)
}

///|
test "passed enrollment keeps its snapshot after the course master changes" {
  let course = expect_ok(
    @tanikun-domain.Course::new(
      enrollment_course_id(),
      "Physics",
      expect_ok(@tanikun-domain.Credits::new(4)),
      @tanikun-domain.CourseStatus::Active,
    ),
  )
  let snapshot = expect_ok(
    @tanikun-domain.PassedCourseSnapshot::from_course(
      course,
      @tanikun-domain.Overrides::empty(),
    ),
  )
  let enrollment = @tanikun-domain.Enrollment::passed(
    enrollment_offering_id(),
    @tanikun-domain.PassingGrade::Excellent,
    snapshot,
  )
  assert_eq(enrollment.offering_id.value, "offering-1")
  let revised = expect_ok(
    @tanikun-domain.Course::new(
      enrollment_course_id(),
      "Physics Revised",
      expect_ok(@tanikun-domain.Credits::new(6)),
      @tanikun-domain.CourseStatus::Retired,
    ),
  )
  assert_eq(revised.credits.half_units(), 6)
  let stored = match enrollment.snapshot() {
    Some(snapshot) => snapshot
    None => fail("expected a passed snapshot")
  }
  assert_same_id(stored.course_id, course.id)
  assert_eq(stored.name, "Physics")
  assert_eq(stored.credits.half_units(), 4)
}

///|
test "all passing grades are passed" {
  for
    grade in [
      @tanikun-domain.PassingGrade::ExcellentPlus,
      @tanikun-domain.PassingGrade::Excellent,
      @tanikun-domain.PassingGrade::Good,
      @tanikun-domain.PassingGrade::Fair,
      @tanikun-domain.PassingGrade::Pass,
    ] {
    let enrollment = @tanikun-domain.Enrollment::passed(
      enrollment_offering_id(),
      grade,
      enrollment_snapshot(),
    )
    assert_true(enrollment.is_passed())
    assert_true(enrollment.is_confirmed())
    match enrollment.snapshot() {
      Some(_) => ()
      None => fail("expected a passed snapshot")
    }
  }
}

///|
test "failing grades are confirmed but not passed" {
  for
    grade in [
      @tanikun-domain.FailingGrade::Fail,
      @tanikun-domain.FailingGrade::NotPassed,
    ] {
    let enrollment = @tanikun-domain.Enrollment::failed(
      enrollment_offering_id(),
      grade,
    )
    assert_false(enrollment.is_passed())
    assert_true(enrollment.is_confirmed())
    match enrollment.snapshot() {
      None => ()
      Some(_) => fail("a failed enrollment has no snapshot")
    }
  }
}

///|
test "not-taken and unconfirmed enrollments are not passed" {
  let not_taken = @tanikun-domain.Enrollment::not_taken(
    enrollment_offering_id(),
  )
  assert_false(not_taken.is_passed())
  assert_true(not_taken.is_confirmed())
  match not_taken.snapshot() {
    None => ()
    Some(_) => fail("a not-taken enrollment has no snapshot")
  }

  let planned = @tanikun-domain.Enrollment::planned(enrollment_offering_id())
  assert_false(planned.is_passed())
  assert_false(planned.is_confirmed())
  match planned.snapshot() {
    None => ()
    Some(_) => fail("a planned enrollment has no snapshot")
  }

  let in_progress = @tanikun-domain.Enrollment::in_progress(
    enrollment_offering_id(),
  )
  assert_false(in_progress.is_passed())
  assert_false(in_progress.is_confirmed())
  match in_progress.snapshot() {
    None => ()
    Some(_) => fail("an in-progress enrollment has no snapshot")
  }
}

///|
test "confirmed enrollment always carries a confirmed outcome" {
  // EnrollmentStatus::Confirmed requires a ConfirmedGrade by construction, so
  // a confirmed enrollment without an outcome cannot be represented.
  let enrollment = @tanikun-domain.Enrollment::new(
    enrollment_offering_id(),
    @tanikun-domain.EnrollmentStatus::Confirmed(
      @tanikun-domain.ConfirmedGrade::NotTaken,
    ),
  )
  assert_true(enrollment.is_confirmed())
  assert_false(enrollment.is_passed())
  match enrollment.status {
    @tanikun-domain.EnrollmentStatus::Confirmed(
      @tanikun-domain.ConfirmedGrade::NotTaken
    ) => ()
    _ => fail("expected a confirmed not-taken enrollment")
  }
}
