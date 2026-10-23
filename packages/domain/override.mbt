///|
/// The course or offering an override applies to.
pub(all) enum OverrideTarget {
  Course(CourseId)
  Offering(OfferingId)
} derive(Eq)

///|
pub extend OverrideTarget with Eq::{not_equal, equal}

///|
/// Orders course targets before offering targets, then by ID. Used to make
/// override validation deterministic.
pub impl Compare for OverrideTarget with fn compare(self, other) {
  match (self, other) {
    (Course(left), Course(right)) => left.compare(right)
    (Offering(left), Offering(right)) => left.compare(right)
    (Course(_), Offering(_)) => -1
    (Offering(_), Course(_)) => 1
  }
}

///|
pub extend OverrideTarget with Compare::{op_lt, op_le, op_ge, compare, op_gt}

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
/// Orders attributes for deterministic override validation.
pub impl Compare for OverrideAttribute with fn compare(self, other) {
  match (self, other) {
    (DisplayName, DisplayName) => 0
    (DisplayName, _) => -1
    (Credits, DisplayName) => 1
    (Credits, Credits) => 0
    (Credits, Slots) => -1
    (Slots, Slots) => 0
    (Slots, _) => 1
  }
}

///|
pub extend OverrideAttribute with Compare::{op_lt, op_le, op_ge, compare, op_gt}

///|
/// A typed override value.
pub(all) enum OverrideValue {
  Text(String)
  Credits(Credits)
  Slots(Array[Slot])
}

///|
/// A sparse override of a course or offering attribute.
///
/// `value` is excluded from identity; `(target, attribute)` is the key used
/// for duplicate detection.
pub struct Override {
  target : OverrideTarget
  attribute : OverrideAttribute
  priv value : OverrideValue
}

///|
/// Slot values are checked for shape here but validated against the owning
/// offering's schedule and status by `effective_slots` when applied.
pub fn Override::new(
  target : OverrideTarget,
  attribute : OverrideAttribute,
  value : OverrideValue,
) -> Result[Override, DomainError] {
  match (target, attribute, value) {
    (Course(_), DisplayName, Text(text)) =>
      match validate_display_name(text, DomainError::EmptyOverrideText) {
        Err(error) => Err(error)
        Ok(_) => Ok({ target, attribute, value: Text(text), })
      }
    (Course(_), Credits, Credits(credits)) =>
      Ok({ target, attribute, value: Credits(credits), })
    (Offering(_), Slots, Slots(slots)) =>
      Ok({ target, attribute, value: Slots(slots.copy()), })
    _ => Err(DomainError::InvalidOverrideCombination(target~, attribute~))
  }
}

///|
/// Returns the text value, or `None` for another value kind.
pub fn Override::text(self : Override) -> String? {
  match self.value {
    Text(text) => Some(text)
    _ => None
  }
}

///|
/// Returns the credit value, or `None` for another value kind.
pub fn Override::credits(self : Override) -> Credits? {
  match self.value {
    Credits(credits) => Some(credits)
    _ => None
  }
}

///|
/// Returns a copy of the slot value, or `None` for another value kind.
pub fn Override::slots(self : Override) -> Array[Slot]? {
  match self.value {
    Slots(slots) => Some(slots.copy())
    _ => None
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
  // Override sets are sparse, so the quadratic duplicate check is fine.
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
/// An empty override set.
pub fn Overrides::empty() -> Overrides {
  { entries: [], }
}

///|
/// Returns a copy of the override entries.
pub fn Overrides::entries(self : Overrides) -> Array[Override] {
  self.entries.copy()
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
