///|
test "requirements skeleton resolves domain credits" {
  assert_eq(@tanikun-requirements.zero_credits().half_units(), 0)
}
