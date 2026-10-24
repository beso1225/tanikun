///|
fn validate_id_blank(
  value : String,
  kind : IdKind,
  field : IdField,
) -> Result[Unit, DomainError] {
  if is_blank(value) {
    Err(DomainError::EmptyIdField(kind~, field~))
  } else {
    Ok(())
  }
}

///|
fn validate_id_control(
  value : String,
  kind : IdKind,
  field : IdField,
) -> Result[Unit, DomainError] {
  if has_control_character(value) {
    Err(DomainError::ControlCharacterInId(kind~, field~))
  } else {
    Ok(())
  }
}

///|
fn validate_single_id(
  value : String,
  kind : IdKind,
) -> Result[Unit, DomainError] {
  match validate_id_blank(value, kind, IdField::Value) {
    Err(error) => Err(error)
    Ok(_) =>
      match validate_id_control(value, kind, IdField::Value) {
        Err(error) => Err(error)
        Ok(_) => Ok(())
      }
  }
}
