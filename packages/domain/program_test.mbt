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

///|
test "program id treats every Unicode whitespace as blank" {
  let whitespace = [
    "\u{0009}", "\u{000A}", "\u{000B}", "\u{000C}", "\u{000D}", "\u{0020}", "\u{0085}",
    "\u{00A0}", "\u{1680}", "\u{2000}", "\u{2001}", "\u{2002}", "\u{2003}", "\u{2004}",
    "\u{2005}", "\u{2006}", "\u{2007}", "\u{2008}", "\u{2009}", "\u{200A}", "\u{2028}",
    "\u{2029}", "\u{202F}", "\u{205F}", "\u{3000}",
  ]
  for value in whitespace {
    assert_empty_program_id(@tanikun-domain.ProgramId::new(value))
  }
}
