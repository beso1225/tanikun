///|
/// Returns true when a string contains only Unicode whitespace.
///
/// The core `String::trim()` default only strips ASCII whitespace, so IDs and
/// names need this broader check to reject pasted non-breaking and ideographic
/// spaces as empty.
fn is_blank(value : String) -> Bool {
  for char in value {
    if !is_blank_char(char) {
      return false
    }
  }
  true
}

///|
fn is_blank_char(char : Char) -> Bool {
  let code = char.to_int()
  code == 0x09 ||
  code == 0x0A ||
  code == 0x0B ||
  code == 0x0C ||
  code == 0x0D ||
  code == 0x20 ||
  code == 0x85 ||
  code == 0xA0 ||
  code == 0x1680 ||
  (code >= 0x2000 && code <= 0x200A) ||
  code == 0x2028 ||
  code == 0x2029 ||
  code == 0x202F ||
  code == 0x205F ||
  code == 0x3000
}

///|
/// Returns true for C0, DEL, C1 controls, and Unicode line separators.
fn has_control_character(value : String) -> Bool {
  for char in value {
    let code = char.to_int()
    if code < 32 ||
      code == 127 ||
      (code >= 128 && code <= 159) ||
      code == 0x2028 ||
      code == 0x2029 {
      return true
    }
  }
  false
}
