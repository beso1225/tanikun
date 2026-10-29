///|
/// The five UI terms. W has no domain `Term`; it is the off-grid winter period.
pub(all) enum PlannerTerm {
  S1
  S2
  A1
  A2
  W
} derive(Eq)

///|
pub extend PlannerTerm with Eq::{not_equal, equal}

///|
pub fn PlannerTerm::values() -> Array[PlannerTerm] {
  [S1, S2, A1, A2, W]
}

///|
/// Terms exposed as sidebar tabs. W is shown inside the A semester's intensive
/// section instead of as its own tab.
pub fn PlannerTerm::display_values() -> Array[PlannerTerm] {
  [S1, S2, A1, A2]
}

///|
pub fn PlannerTerm::semester(self : PlannerTerm) -> @tanikun-domain.Semester {
  match self {
    S1 | S2 => @tanikun-domain.Semester::S
    A1 | A2 => @tanikun-domain.Semester::A
    W => @tanikun-domain.Semester::W
  }
}

///|
pub fn PlannerTerm::term(self : PlannerTerm) -> @tanikun-domain.Term? {
  match self {
    S1 => Some(@tanikun-domain.Term::S1)
    S2 => Some(@tanikun-domain.Term::S2)
    A1 => Some(@tanikun-domain.Term::A1)
    A2 => Some(@tanikun-domain.Term::A2)
    W => None
  }
}

///|
pub fn PlannerTerm::label(self : PlannerTerm) -> String {
  match self {
    S1 => "S1"
    S2 => "S2"
    A1 => "A1"
    A2 => "A2"
    W => "W"
  }
}

///|
