///|
/// An ID-keyed course collection with deterministic ordering.
pub struct CourseCatalog {
  priv courses : Array[Course]
}

///|
/// Builds a catalog sorted by `CourseId` and rejects duplicate IDs.
pub fn CourseCatalog::new(
  courses : Array[Course],
) -> Result[CourseCatalog, DomainError] {
  // Courses are immutable values, so a shallow copy is enough. The catalog
  // owns the ordering, not the course data.
  let sorted = courses.copy()
  sorted.sort_by(fn(left : Course, right : Course) { left.id.compare(right.id) })
  for index in 1..<sorted.length() {
    if sorted[index - 1].id == sorted[index].id {
      return Err(DomainError::DuplicateCourseId(id=sorted[index].id))
    }
  }
  Ok({ courses: sorted, })
}

///|
/// Returns the number of courses in the catalog.
pub fn CourseCatalog::len(self : CourseCatalog) -> Int {
  self.courses.length()
}

///|
/// Looks up any course, including a retired one.
///
/// Binary search is valid because `new` stores courses in `CourseId` order.
pub fn CourseCatalog::lookup(self : CourseCatalog, id : CourseId) -> Course? {
  let mut low = 0
  let mut high = self.courses.length()
  while low < high {
    let middle = low + (high - low) / 2
    let course = self.courses[middle]
    let order = course.id.compare(id)
    if order < 0 {
      low = middle + 1
    } else if order > 0 {
      high = middle
    } else {
      return Some(course)
    }
  }
  None
}

///|
/// Returns a copy of the courses in stable ID order.
pub fn CourseCatalog::courses(self : CourseCatalog) -> Array[Course] {
  self.courses.copy()
}
