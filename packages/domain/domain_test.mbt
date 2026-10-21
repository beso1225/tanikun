///|
test "domain skeleton exposes its module name" {
  inspect(@tanikun-domain.module_name(), content="beso1225/tanikun-domain")
}
