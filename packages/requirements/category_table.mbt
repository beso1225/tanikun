///|
/// A course-to-category mapping owned by one requirement set.
pub struct CategoryTable {
  priv assignments : Array[
    (@tanikun-domain.CourseId, @tanikun-domain.CategoryId),
  ]
}

///|
pub fn CategoryTable::new(
  assignments : Array[(@tanikun-domain.CourseId, @tanikun-domain.CategoryId)],
  categories : Array[Category],
) -> Result[CategoryTable, @tanikun-domain.DomainError] {
  let assignments = assignments.copy()
  for assignment in assignments {
    if !contains_category(categories, assignment.1) {
      return Err(@tanikun-domain.DomainError::UnknownCategory(id=assignment.1))
    }
  }
  assignments.sort_by(fn(left, right) { left.0.compare(right.0) })
  for index in 1..<assignments.length() {
    if assignments[index - 1].0 == assignments[index].0 {
      return Err(
        @tanikun-domain.DomainError::DuplicateCategoryAssignment(
          course_id=assignments[index].0,
        ),
      )
    }
  }
  Ok({ assignments, })
}

///|
pub fn CategoryTable::len(self : CategoryTable) -> Int {
  self.assignments.length()
}

///|
pub fn CategoryTable::lookup(
  self : CategoryTable,
  course_id : @tanikun-domain.CourseId,
) -> @tanikun-domain.CategoryId? {
  for assignment in self.assignments {
    if assignment.0 == course_id {
      return Some(assignment.1)
    }
  }
  None
}

///|
fn contains_category(
  categories : Array[Category],
  id : @tanikun-domain.CategoryId,
) -> Bool {
  for category in categories {
    if category.id == id {
      return true
    }
  }
  false
}
