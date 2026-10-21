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
  let sorted = courses.copy()
  sorted.sort_by(fn(left : Course, right : Course) { left.id.compare(right.id) })
  for index in 1..<sorted.length() {
    if sorted[index - 1].id.equals(sorted[index].id) {
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
pub fn CourseCatalog::lookup(self : CourseCatalog, id : CourseId) -> Course? {
  for course in self.courses {
    if course.id.equals(id) {
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
