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
/// Reports a blank value before a control character. U+2028 is both, so this
/// order is observable and must stay stable.
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

///|
/// Validates a namespaced course ID.
///
/// Blank namespace/local parts are reported before control characters, in the
/// order namespace, local, namespace-control, local-control. This order is
/// observable for inputs that are both blank and control-like.
fn validate_course_id(
  namespace_part : String,
  local_part : String,
) -> Result[Unit, DomainError] {
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
  Ok(())
}
