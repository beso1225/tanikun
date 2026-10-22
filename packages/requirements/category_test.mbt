///|
test "category records its id and display name" {
  let id = expect_ok(@tanikun-domain.CategoryId::new("physics"))
  let category = expect_ok(@tanikun-requirements.Category::new(id, "Physics"))
  assert_same_category_id(category.id, id)
  assert_eq(category.name, "Physics")
}

///|
test "category rejects an empty display name" {
  let id = expect_ok(@tanikun-domain.CategoryId::new("physics"))
  assert_empty_category_name(@tanikun-requirements.Category::new(id, "  "))
}
