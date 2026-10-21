///|
test "credits accept zero and positive half units" {
  assert_eq(expect_ok(@tanikun-domain.Credits::new(0)).half_units(), 0)
  assert_eq(expect_ok(@tanikun-domain.Credits::new(1)).half_units(), 1)
  assert_eq(expect_ok(@tanikun-domain.Credits::new(5)).half_units(), 5)
}

///|
test "credits reject negative half units" {
  assert_invalid_credits(@tanikun-domain.Credits::new(-2), -2)
}

///|
test "credits add exactly in half units" {
  let two = expect_ok(@tanikun-domain.Credits::new(2))
  let one = expect_ok(@tanikun-domain.Credits::new(1))
  assert_eq(two.add(one).half_units(), 3)
}

///|
test "credits sum keeps exact half units" {
  let values = [
    expect_ok(@tanikun-domain.Credits::new(2)),
    @tanikun-domain.Credits::zero(),
    expect_ok(@tanikun-domain.Credits::new(3)),
  ]
  assert_eq(@tanikun-domain.Credits::sum(values).half_units(), 5)
}
