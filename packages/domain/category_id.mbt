///|
/// A stable, non-empty category identifier.
pub struct CategoryId {
  value : String
} derive(Eq)

///|
pub extend CategoryId with Eq::{not_equal, equal}

///|
pub impl Compare for CategoryId with fn compare(self, other) {
  compare_code_units(self.value, other.value)
}

///|
pub extend CategoryId with Compare::{op_lt, op_le, op_ge, compare, op_gt}

///|
pub fn CategoryId::new(value : String) -> Result[CategoryId, DomainError] {
  if is_blank(value) {
    Err(DomainError::EmptyIdField(kind=IdKind::Category, field=IdField::Value))
  } else if has_control_character(value) {
    Err(
      DomainError::ControlCharacterInId(
        kind=IdKind::Category,
        field=IdField::Value,
      ),
    )
  } else {
    Ok({ value, })
  }
}
