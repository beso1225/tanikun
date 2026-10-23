///|
/// Known category and course IDs used to validate rule references.
pub struct RuleScope {
  priv categories : Array[@tanikun-domain.CategoryId]
  priv courses : Array[@tanikun-domain.CourseId]
}

///|
pub fn RuleScope::new(
  categories : Array[@tanikun-domain.CategoryId],
  courses : Array[@tanikun-domain.CourseId],
) -> RuleScope {
  { categories: categories.copy(), courses: courses.copy(), }
}

///|
/// A graduation-requirement rule tree.
pub struct Rule {
  priv kind : RuleKind
}

///|
priv enum RuleKind {
  CategoryMinimum(
    categories~ : Array[@tanikun-domain.CategoryId],
    min_credits~ : @tanikun-domain.Credits
  )
  TotalMinimum(min_credits~ : @tanikun-domain.Credits)
  AllCoursesPassed(courses~ : Array[@tanikun-domain.CourseId])
  CourseSetMinimum(
    courses~ : Array[@tanikun-domain.CourseId],
    min_credits~ : @tanikun-domain.Credits
  )
  All(children~ : Array[Rule])
  Any(children~ : Array[Rule])
  AtLeast(count~ : Int, children~ : Array[Rule])
}

///|
pub fn Rule::category_minimum(
  categories : Array[@tanikun-domain.CategoryId],
  min_credits : @tanikun-domain.Credits,
) -> Result[Rule, @tanikun-domain.DomainError] {
  match validate_rule_threshold(min_credits) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  match validate_rule_categories(categories) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  Ok({ kind: CategoryMinimum(categories=categories.copy(), min_credits~), })
}

///|
pub fn Rule::total_minimum(
  min_credits : @tanikun-domain.Credits,
) -> Result[Rule, @tanikun-domain.DomainError] {
  match validate_rule_threshold(min_credits) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  Ok({ kind: TotalMinimum(min_credits~), })
}

///|
pub fn Rule::all_courses_passed(
  courses : Array[@tanikun-domain.CourseId],
) -> Result[Rule, @tanikun-domain.DomainError] {
  match validate_rule_courses(courses) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  Ok({ kind: AllCoursesPassed(courses=courses.copy()), })
}

///|
pub fn Rule::course_set_minimum(
  courses : Array[@tanikun-domain.CourseId],
  min_credits : @tanikun-domain.Credits,
) -> Result[Rule, @tanikun-domain.DomainError] {
  match validate_rule_threshold(min_credits) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  match validate_rule_courses(courses) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  Ok({ kind: CourseSetMinimum(courses=courses.copy(), min_credits~), })
}

///|
pub fn Rule::all(
  children : Array[Rule],
) -> Result[Rule, @tanikun-domain.DomainError] {
  match validate_rule_children(children) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  Ok({ kind: All(children=children.copy()), })
}

///|
pub fn Rule::any(
  children : Array[Rule],
) -> Result[Rule, @tanikun-domain.DomainError] {
  match validate_rule_children(children) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  Ok({ kind: Any(children=children.copy()), })
}

///|
pub fn Rule::at_least(
  count : Int,
  children : Array[Rule],
) -> Result[Rule, @tanikun-domain.DomainError] {
  match validate_rule_children(children) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  if count < 1 || count > children.length() {
    return Err(
      @tanikun-domain.DomainError::InvalidAtLeastCount(
        count~,
        child_count=children.length(),
      ),
    )
  }
  Ok({ kind: AtLeast(count~, children=children.copy()), })
}

///|
/// Returns a copy of the category IDs for a category-minimum rule.
pub fn Rule::category_ids(self : Rule) -> Array[@tanikun-domain.CategoryId]? {
  match self.kind {
    CategoryMinimum(categories~, ..) => Some(categories.copy())
    _ => None
  }
}

///|
/// Returns a copy of the course IDs for a course-based leaf.
pub fn Rule::course_ids(self : Rule) -> Array[@tanikun-domain.CourseId]? {
  match self.kind {
    AllCoursesPassed(courses~) => Some(courses.copy())
    CourseSetMinimum(courses~, ..) => Some(courses.copy())
    _ => None
  }
}

///|
/// Returns the minimum credits for a credit-based leaf.
pub fn Rule::min_credits(self : Rule) -> @tanikun-domain.Credits? {
  match self.kind {
    CategoryMinimum(min_credits~, ..) => Some(min_credits)
    TotalMinimum(min_credits~) => Some(min_credits)
    CourseSetMinimum(min_credits~, ..) => Some(min_credits)
    _ => None
  }
}

///|
/// Returns a copy of the children for a node.
pub fn Rule::children(self : Rule) -> Array[Rule]? {
  match self.kind {
    All(children~) => Some(children.copy())
    Any(children~) => Some(children.copy())
    AtLeast(children~, ..) => Some(children.copy())
    _ => None
  }
}

///|
/// Returns the threshold count for an `AtLeast` node.
pub fn Rule::at_least_count(self : Rule) -> Int? {
  match self.kind {
    AtLeast(count~, ..) => Some(count)
    _ => None
  }
}

///|
/// Collects invalid category and course references in deterministic ID order.
///
/// The worklist avoids recursion, so deeply nested trees do not overflow the
/// call stack.
pub fn Rule::reference_errors(
  self : Rule,
  scope : RuleScope,
) -> Array[@tanikun-domain.DomainError] {
  let category_failures : Array[
    (@tanikun-domain.CategoryId, @tanikun-domain.DomainError),
  ] = []
  let course_failures : Array[
    (@tanikun-domain.CourseId, @tanikun-domain.DomainError),
  ] = []
  let pending = [self]
  while !pending.is_empty() {
    let rule = match pending.pop() {
      Some(rule) => rule
      None => break
    }
    match rule.kind {
      CategoryMinimum(categories~, ..) =>
        for category in categories {
          if !scope.contains_category(category) {
            category_failures.push(
              (
                category,
                @tanikun-domain.DomainError::UnknownRuleCategory(id=category),
              ),
            )
          }
        }
      TotalMinimum(_) => ()
      AllCoursesPassed(courses~) =>
        for course in courses {
          if !scope.contains_course(course) {
            course_failures.push(
              (
                course,
                @tanikun-domain.DomainError::UnknownRuleCourse(course_id=course),
              ),
            )
          }
        }
      CourseSetMinimum(courses~, ..) =>
        for course in courses {
          if !scope.contains_course(course) {
            course_failures.push(
              (
                course,
                @tanikun-domain.DomainError::UnknownRuleCourse(course_id=course),
              ),
            )
          }
        }
      All(children~) => push_rule_children(pending, children)
      Any(children~) => push_rule_children(pending, children)
      AtLeast(children~, ..) => push_rule_children(pending, children)
    }
  }
  category_failures.sort_by(fn(left, right) { left.0.compare(right.0) })
  course_failures.sort_by(fn(left, right) { left.0.compare(right.0) })
  let errors : Array[@tanikun-domain.DomainError] = []
  for failure in category_failures {
    errors.push(failure.1)
  }
  for failure in course_failures {
    errors.push(failure.1)
  }
  errors
}

///|
/// Validates that every category and course reference exists in the scope.
pub fn Rule::validate(
  self : Rule,
  scope : RuleScope,
) -> Result[Unit, @tanikun-domain.DomainError] {
  let errors = self.reference_errors(scope)
  if errors.is_empty() {
    Ok(())
  } else {
    Err(errors[0])
  }
}

///|
fn push_rule_children(pending : Array[Rule], children : Array[Rule]) -> Unit {
  let mut index = children.length()
  while index > 0 {
    index = index - 1
    pending.push(children[index])
  }
}

///|
fn validate_rule_threshold(
  credits : @tanikun-domain.Credits,
) -> Result[Unit, @tanikun-domain.DomainError] {
  if credits.half_units() <= 0 {
    Err(@tanikun-domain.DomainError::InvalidRuleThreshold(credits~))
  } else {
    Ok(())
  }
}

///|
fn validate_rule_categories(
  categories : Array[@tanikun-domain.CategoryId],
) -> Result[Unit, @tanikun-domain.DomainError] {
  if categories.is_empty() {
    return Err(@tanikun-domain.DomainError::EmptyRuleCategories)
  }
  for index in 0..<categories.length() {
    for other in (index + 1)..<categories.length() {
      if categories[index] == categories[other] {
        return Err(
          @tanikun-domain.DomainError::DuplicateRuleCategory(
            id=categories[index],
          ),
        )
      }
    }
  }
  Ok(())
}

///|
fn validate_rule_courses(
  courses : Array[@tanikun-domain.CourseId],
) -> Result[Unit, @tanikun-domain.DomainError] {
  if courses.is_empty() {
    return Err(@tanikun-domain.DomainError::EmptyRuleCourses)
  }
  for index in 0..<courses.length() {
    for other in (index + 1)..<courses.length() {
      if courses[index] == courses[other] {
        return Err(
          @tanikun-domain.DomainError::DuplicateRuleCourse(
            course_id=courses[index],
          ),
        )
      }
    }
  }
  Ok(())
}

///|
fn validate_rule_children(
  children : Array[Rule],
) -> Result[Unit, @tanikun-domain.DomainError] {
  if children.is_empty() {
    Err(@tanikun-domain.DomainError::EmptyRuleChildren)
  } else {
    Ok(())
  }
}

///|
fn RuleScope::contains_category(
  self : RuleScope,
  id : @tanikun-domain.CategoryId,
) -> Bool {
  for category in self.categories {
    if category == id {
      return true
    }
  }
  false
}

///|
fn RuleScope::contains_course(
  self : RuleScope,
  id : @tanikun-domain.CourseId,
) -> Bool {
  for course in self.courses {
    if course == id {
      return true
    }
  }
  false
}
