///|
/// A positive calendar year.
pub struct AcademicYear {
  year : Int
} derive(Eq)

///|
pub extend AcademicYear with Eq::{not_equal, equal}

///|
pub fn AcademicYear::new(year : Int) -> Result[AcademicYear, DomainError] {
  if year <= 0 {
    Err(DomainError::InvalidAcademicYear(year~))
  } else {
    Ok({ year, })
  }
}

///|
pub fn AcademicYear::year(self : AcademicYear) -> Int {
  self.year
}

///|
/// A half-year period. W is reserved for winter intensive offerings.
pub(all) enum Semester {
  S
  A
  W
} derive(Eq)

///|
pub extend Semester with Eq::{not_equal, equal}

///|
/// A quarter-year period. W has no term.
pub(all) enum Term {
  S1
  S2
  A1
  A2
} derive(Eq)

///|
pub extend Term with Eq::{not_equal, equal}

///|
pub fn Term::semester(self : Term) -> Semester {
  match self {
    S1 => Semester::S
    S2 => Semester::S
    A1 => Semester::A
    A2 => Semester::A
  }
}

///|
pub(all) enum DayOfWeek {
  Monday
  Tuesday
  Wednesday
  Thursday
  Friday
  Saturday
  Sunday
} derive(Eq)

///|
pub extend DayOfWeek with Eq::{not_equal, equal}

///|
/// A timetable period from 1 through 10.
pub struct Period {
  value : Int
} derive(Eq)

///|
pub extend Period with Eq::{not_equal, equal}

///|
pub fn Period::new(value : Int) -> Result[Period, DomainError] {
  if value < 1 || value > 10 {
    Err(DomainError::InvalidPeriod(value~))
  } else {
    Ok({ value, })
  }
}

///|
pub fn Period::value(self : Period) -> Int {
  self.value
}

///|
/// A day and period in the timetable grid.
pub struct Slot {
  day : DayOfWeek
  period : Period
} derive(Eq)

///|
pub extend Slot with Eq::{not_equal, equal}

///|
pub fn Slot::new(day : DayOfWeek, period : Period) -> Slot {
  { day, period, }
}
