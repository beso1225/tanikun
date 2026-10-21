///|
test "requirements skeleton resolves the domain module" {
  inspect(
    @tanikun-requirements.domain_module_name(),
    content="beso1225/tanikun-domain",
  )
}
