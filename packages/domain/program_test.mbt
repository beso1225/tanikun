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
test "program records its id and display name" {
  let id = expect_ok(@tanikun-domain.ProgramId::new("applied-physics"))
  let program = expect_ok(@tanikun-domain.Program::new(id, "Applied Physics"))
  assert_eq(program.id.value, "applied-physics")
  assert_eq(program.name, "Applied Physics")
}

///|
test "program rejects an empty display name" {
  let id = expect_ok(@tanikun-domain.ProgramId::new("applied-physics"))
  assert_empty_program_name(@tanikun-domain.Program::new(id, "  "))
}
