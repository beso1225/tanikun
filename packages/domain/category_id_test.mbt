///|
test "category id keeps its value" {
  let id = expect_ok(@tanikun-domain.CategoryId::new("physics"))
  assert_eq(id.value, "physics")
}

///|
test "category id rejects blank and control values" {
  assert_empty_category_id(@tanikun-domain.CategoryId::new("  "))
  assert_control_character_category_id(
    @tanikun-domain.CategoryId::new("category\u{0085}"),
  )
}

///|
test "category id equality and ordering are lexicographic" {
  let first = expect_ok(@tanikun-domain.CategoryId::new("physics"))
  let same = expect_ok(@tanikun-domain.CategoryId::new("physics"))
  let later = expect_ok(@tanikun-domain.CategoryId::new("physics-2"))
  assert_true(first == same)
  assert_true(first < later)
  assert_eq(first.compare(first), 0)
}
