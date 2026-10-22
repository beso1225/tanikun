///|
test "program id rejects blank and control values" {
  assert_eq(
    expect_ok(@tanikun-domain.ProgramId::new("applied-physics")).value,
    "applied-physics",
  )
  assert_empty_program_id(@tanikun-domain.ProgramId::new("  "))
  assert_control_character_program_id(
    @tanikun-domain.ProgramId::new("program\u{0085}"),
  )
}

///|
test "academic profile records a program and advancement year" {
  let program_id = expect_ok(@tanikun-domain.ProgramId::new("applied-physics"))
  let advancement_year = expect_ok(@tanikun-domain.AcademicYear::new(2026))
  let profile = @tanikun-domain.AcademicProfile::new(
    program_id, advancement_year,
  )
  assert_eq(profile.program_id.value, "applied-physics")
  assert_eq(profile.advancement_year.year(), 2026)
}
