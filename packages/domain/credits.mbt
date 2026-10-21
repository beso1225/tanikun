///|
/// Credits stored as half-credit units.
///
/// One half-unit is 0.5 credits, so the representation is exact. Values are
/// non-negative; zero-credit courses are allowed.
pub struct Credits {
  half_units : Int
}

///|
/// Creates credits from a non-negative number of half-units.
pub fn Credits::new(half_units : Int) -> Result[Credits, DomainError] {
  if half_units < 0 {
    Err(DomainError::InvalidCredits(half_units~))
  } else {
    Ok({ half_units, })
  }
}

///|
/// The additive identity.
pub fn Credits::zero() -> Credits {
  { half_units: 0, }
}

///|
/// Returns the exact number of half-credit units.
pub fn Credits::half_units(self : Credits) -> Int {
  self.half_units
}

///|
/// Adds two non-negative credit values exactly.
pub fn Credits::add(self : Credits, other : Credits) -> Credits {
  { half_units: self.half_units + other.half_units, }
}

///|
/// Sums credits without introducing floating-point arithmetic.
pub fn Credits::sum(values : Array[Credits]) -> Credits {
  let mut total = 0
  for credits in values {
    total = total + credits.half_units
  }
  { half_units: total, }
}
