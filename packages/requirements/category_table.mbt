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
  // Sorted order serves both the adjacent duplicate check and binary lookup.
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
/// Looks up a course in the table. Assignments are stored in `CourseId` order,
/// so binary search is valid.
pub fn CategoryTable::lookup(
  self : CategoryTable,
  course_id : @tanikun-domain.CourseId,
) -> @tanikun-domain.CategoryId? {
  let mut low = 0
  let mut high = self.assignments.length()
  while low < high {
    let middle = low + (high - low) / 2
    let order = self.assignments[middle].0.compare(course_id)
    if order < 0 {
      low = middle + 1
    } else if order > 0 {
      high = middle
    } else {
      return Some(self.assignments[middle].1)
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
