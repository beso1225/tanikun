///|
/// The course or offering an override applies to.
pub(all) enum OverrideTarget {
  Course(CourseId)
  Offering(OfferingId)
} derive(Eq)

///|
pub extend OverrideTarget with Eq::{not_equal, equal}

///|
/// The overridable attribute. Categories are intentionally absent.
pub(all) enum OverrideAttribute {
  DisplayName
  Credits
  Slots
} derive(Eq)

///|
pub extend OverrideAttribute with Eq::{not_equal, equal}

///|
/// A typed override value.
pub(all) enum OverrideValue {
  Text(String)
  Credits(Credits)
  Slots(Array[Slot])
}

///|
/// A sparse override of a course or offering attribute.
pub struct Override {
  target : OverrideTarget
  attribute : OverrideAttribute
  priv value : OverrideValue
}

///|
pub fn Override::new(
  target : OverrideTarget,
  attribute : OverrideAttribute,
  value : OverrideValue,
) -> Result[Override, DomainError] {
  match (target, attribute, value) {
    (Course(_), DisplayName, Text(text)) =>
      if is_blank(text) {
        Err(DomainError::EmptyOverrideText)
      } else {
        Ok({ target, attribute, value: Text(text), })
      }
    (Course(_), Credits, Credits(credits)) =>
      Ok({ target, attribute, value: Credits(credits), })
    (Offering(_), Slots, Slots(slots)) =>
      Ok({ target, attribute, value: Slots(slots.copy()), })
    _ => Err(DomainError::InvalidOverrideCombination(target~, attribute~))
  }
}

///|
/// Returns a copy of the override value.
pub fn Override::value(self : Override) -> OverrideValue {
  match self.value {
    Text(text) => Text(text)
    Credits(credits) => Credits(credits)
    Slots(slots) => Slots(slots.copy())
  }
}

///|
/// A sparse set of overrides keyed by `(target, attribute)`.
pub struct Overrides {
  priv entries : Array[Override]
}

///|
pub fn Overrides::new(
  entries : Array[Override],
) -> Result[Overrides, DomainError] {
  let entries = entries.copy()
  for index in 0..<entries.length() {
    for other in (index + 1)..<entries.length() {
      if entries[index].target == entries[other].target &&
        entries[index].attribute == entries[other].attribute {
        return Err(
          DomainError::DuplicateOverride(
            target=entries[index].target,
            attribute=entries[index].attribute,
          ),
        )
      }
    }
  }
  Ok({ entries, })
}

///|
pub fn Overrides::len(self : Overrides) -> Int {
  self.entries.length()
}

///|
pub fn Overrides::find(
  self : Overrides,
  target : OverrideTarget,
  attribute : OverrideAttribute,
) -> Override? {
  for entry in self.entries {
    if entry.target == target && entry.attribute == attribute {
      return Some(entry)
    }
  }
  None
}
