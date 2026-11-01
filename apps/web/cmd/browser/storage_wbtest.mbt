///|
test "load wire results decode missing, loaded, and failed" {
  assert_eq(decode_storage_load_result(["missing"]), Missing)
  assert_eq(decode_storage_load_result(["loaded", "{}"]), Loaded("{}"))
  assert_eq(
    decode_storage_load_result(["failed", "読めません"]),
    Failed("読めません"),
  )
}

///|
test "malformed load wire results fail safely" {
  for
    wire in [
      [],
      ["unknown"],
      ["loaded"],
      ["loaded", ""],
      ["failed"],
      ["failed", ""],
      ["loaded", "{}", "extra"],
      ["missing", "extra"],
    ] {
    guard decode_storage_load_result(wire) is Failed(message) else {
      fail("expected a failed load result")
    }
    assert_eq(message, "保存データを読み込めません")
  }
}

///|
test "save wire results decode success and failure" {
  assert_eq(decode_storage_save_result(["saved"]), Saved)
  assert_eq(
    decode_storage_save_result(["failed", "保存できません"]),
    Failed("保存できません"),
  )
}

///|
test "malformed save wire results fail safely" {
  for
    wire in [
      [],
      ["unknown"],
      ["failed"],
      ["failed", ""],
      ["saved", "extra"],
      ["saved", ""],
    ] {
    guard decode_storage_save_result(wire) is Failed(message) else {
      fail("expected a failed save result")
    }
    assert_eq(
      message, "保存できません。再読み込みしてください",
    )
  }
}
