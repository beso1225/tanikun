///|
/// Stable, namespaced course identifier.
///
/// Names are display attributes; equality only uses the namespace and local
/// parts. Both parts keep their original spelling and whitespace.
pub struct CourseId {
  namespace_part : String
  local_part : String
}

///|
pub fn CourseId::new(
  namespace_part : String,
  local_part : String,
) -> Result[CourseId, DomainError] {
  if is_blank(namespace_part) {
    Err(
      DomainError::EmptyIdField(kind=IdKind::Course, field=IdField::Namespace),
    )
  } else if is_blank(local_part) {
    Err(DomainError::EmptyIdField(kind=IdKind::Course, field=IdField::Local))
  } else if has_control_character(namespace_part) {
    Err(
      DomainError::ControlCharacterInId(
        kind=IdKind::Course,
        field=IdField::Namespace,
      ),
    )
  } else if has_control_character(local_part) {
    Err(
      DomainError::ControlCharacterInId(
        kind=IdKind::Course,
        field=IdField::Local,
      ),
    )
  } else {
    Ok({ namespace_part, local_part, })
  }
}

///|
/// Course IDs are equal when both stored parts match exactly.
pub impl Eq for CourseId with fn equal(self, other) {
  self.namespace_part == other.namespace_part &&
  self.local_part == other.local_part
}

///|
/// Orders IDs lexicographically by namespace, then by local part.
pub impl Compare for CourseId with fn compare(self, other) {
  let namespace_order = compare_code_units(
    self.namespace_part,
    other.namespace_part,
  )
  if namespace_order != 0 {
    namespace_order
  } else {
    compare_code_units(self.local_part, other.local_part)
  }
}

///|
pub extend CourseId with Eq::{not_equal, equal}

///|
pub extend CourseId with Compare::{op_lt, op_le, op_ge, compare, op_gt}

///|
fn compare_code_units(left : String, right : String) -> Int {
  let shared = if left.length() < right.length() {
    left.length()
  } else {
    right.length()
  }
  for index in 0..<shared {
    if left[index] != right[index] {
      return if left[index] < right[index] { -1 } else { 1 }
    }
  }
  if left.length() < right.length() {
    -1
  } else if left.length() > right.length() {
    1
  } else {
    0
  }
}
