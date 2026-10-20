///|
test "health body is valid for the JavaScript bridge" {
  inspect(@tanikun-api.health_body(), content="{\"status\":\"ok\"}")
}
