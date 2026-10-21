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
  if namespace_part.trim().is_empty() {
    Err(
      DomainError::EmptyIdField(kind=IdKind::Course, field=IdField::Namespace),
    )
  } else if local_part.trim().is_empty() {
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
/// Compares the full ID exactly.
pub fn CourseId::equals(self : CourseId, other : CourseId) -> Bool {
  self.namespace_part == other.namespace_part &&
  self.local_part == other.local_part
}

///|
/// Orders IDs by namespace and then by local part.
pub fn CourseId::compare(self : CourseId, other : CourseId) -> Int {
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

///|
fn has_control_character(value : String) -> Bool {
  for index in 0..<value.length() {
    let code = value.code_unit_at(index).to_int()
    if code < 32 || code == 127 {
      return true
    }
  }
  false
}
