///|
/// Identifies a requirement set by program and advancement year.
pub struct RequirementSetKey {
  program_id : @tanikun-domain.ProgramId
  advancement_year : @tanikun-domain.AcademicYear
} derive(Eq)

///|
pub extend RequirementSetKey with Eq::{not_equal, equal}

///|
pub fn RequirementSetKey::new(
  program_id : @tanikun-domain.ProgramId,
  advancement_year : @tanikun-domain.AcademicYear,
) -> RequirementSetKey {
  { program_id, advancement_year, }
}

///|
/// Categories, a category table, and a rule tree for one program/year.
pub struct RequirementSet[Rule] {
  key : RequirementSetKey
  priv categories : Array[Category]
  priv category_table : CategoryTable
  priv rule : Rule
}

///|
pub fn[Rule] RequirementSet::new(
  key : RequirementSetKey,
  categories : Array[Category],
  assignments : Array[(@tanikun-domain.CourseId, @tanikun-domain.CategoryId)],
  rule : Rule,
) -> Result[RequirementSet[Rule], @tanikun-domain.DomainError] {
  let categories = categories.copy()
  for index in 0..<categories.length() {
    for other in (index + 1)..<categories.length() {
      if categories[index].id == categories[other].id {
        return Err(
          @tanikun-domain.DomainError::DuplicateCategoryId(
            id=categories[index].id,
          ),
        )
      }
    }
  }
  let category_table = match CategoryTable::new(assignments, categories) {
    Ok(table) => table
    Err(error) => return Err(error)
  }
  Ok({ key, categories, category_table, rule, })
}

///|
pub fn[Rule] RequirementSet::categories(
  self : RequirementSet[Rule],
) -> Array[Category] {
  self.categories.copy()
}

///|
pub fn[Rule] RequirementSet::category_for(
  self : RequirementSet[Rule],
  course_id : @tanikun-domain.CourseId,
) -> @tanikun-domain.CategoryId? {
  self.category_table.lookup(course_id)
}

///|
pub fn[Rule] RequirementSet::rule(self : RequirementSet[Rule]) -> Rule {
  self.rule
}

///|
/// A collection of requirement sets with unique program/year keys.
pub struct RequirementSets[Rule] {
  priv sets : Array[RequirementSet[Rule]]
}

///|
pub fn[Rule] RequirementSets::new(
  sets : Array[RequirementSet[Rule]],
) -> Result[RequirementSets[Rule], @tanikun-domain.DomainError] {
  let sets = sets.copy()
  for index in 0..<sets.length() {
    for other in (index + 1)..<sets.length() {
      if sets[index].key == sets[other].key {
        return Err(
          @tanikun-domain.DomainError::DuplicateRequirementSet(
            program_id=sets[index].key.program_id,
            advancement_year=sets[index].key.advancement_year,
          ),
        )
      }
    }
  }
  Ok({ sets, })
}

///|
pub fn[Rule] RequirementSets::len(self : RequirementSets[Rule]) -> Int {
  self.sets.length()
}

///|
pub fn[Rule] RequirementSets::lookup(
  self : RequirementSets[Rule],
  program_id : @tanikun-domain.ProgramId,
  advancement_year : @tanikun-domain.AcademicYear,
) -> RequirementSet[Rule]? {
  for set in self.sets {
    if set.key.program_id == program_id &&
      set.key.advancement_year == advancement_year {
      return Some(set)
    }
  }
  None
}

///|
pub fn[Rule] RequirementSets::lookup_for_profile(
  self : RequirementSets[Rule],
  profile : @tanikun-domain.AcademicProfile,
) -> RequirementSet[Rule]? {
  self.lookup(profile.program_id, profile.advancement_year)
}
