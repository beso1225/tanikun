///|
test "evaluation input exposes defensive copies" {
  let course = credit_course("PHY101", 4)
  let offering = credit_offering("offering-1", course.id)
  let input = credit_input(
    credit_requirement_set([], []),
    [course],
    [offering],
    [],
    @tanikun-domain.Overrides::empty(),
  )
  assert_true(input.profile().program_id == program_id("applied-physics"))
  assert_eq(input.courses().length(), 1)
  assert_eq(input.offerings().length(), 1)
  assert_eq(input.enrollments().length(), 0)
  assert_eq(input.overrides().len(), 0)
  assert_eq(input.requirement_set().categories().length(), 0)

  let courses = input.courses()
  courses.push(credit_course("PHY102", 2))
  assert_eq(input.courses().length(), 1)
  let offerings = input.offerings()
  let _ = offerings.pop()
  assert_eq(input.offerings().length(), 1)
  let enrollments = input.enrollments()
  enrollments.push(planned_enrollment("offering-1"))
  assert_eq(input.enrollments().length(), 0)
}
