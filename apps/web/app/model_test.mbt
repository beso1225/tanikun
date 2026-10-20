///|
test "increment advances the displayed count" {
  assert_eq(@app.update(0, @app.Increment), 1)
  assert_eq(@app.update(1, @app.Increment), 2)
}

///|
test "reset returns the count to zero" {
  assert_eq(@app.update(2, @app.Reset), 0)
  assert_eq(@app.update(0, @app.Reset), 0)
}
