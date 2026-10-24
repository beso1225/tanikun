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
  match validate_id_blank(namespace_part, IdKind::Course, IdField::Namespace) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  match validate_id_blank(local_part, IdKind::Course, IdField::Local) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  match
    validate_id_control(namespace_part, IdKind::Course, IdField::Namespace) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  match validate_id_control(local_part, IdKind::Course, IdField::Local) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  Ok({ namespace_part, local_part, })
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
