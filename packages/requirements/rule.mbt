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
/// Validates that every category and course reference exists in the scope.
pub fn Rule::validate(
  self : Rule,
  scope : RuleScope,
) -> Result[Unit, @tanikun-domain.DomainError] {
  match self.kind {
    CategoryMinimum(categories~, min_credits~) => {
      match validate_rule_threshold(min_credits) {
        Err(error) => return Err(error)
        Ok(_) => ()
      }
      match validate_rule_categories(categories) {
        Err(error) => return Err(error)
        Ok(_) => ()
      }
      for category in categories {
        if !scope.contains_category(category) {
          return Err(
            @tanikun-domain.DomainError::UnknownRuleCategory(id=category),
          )
        }
      }
    }
    TotalMinimum(min_credits~) =>
      match validate_rule_threshold(min_credits) {
        Err(error) => return Err(error)
        Ok(_) => ()
      }
    AllCoursesPassed(courses~) => {
      match validate_rule_courses(courses) {
        Err(error) => return Err(error)
        Ok(_) => ()
      }
      for course in courses {
        if !scope.contains_course(course) {
          return Err(
            @tanikun-domain.DomainError::UnknownRuleCourse(course_id=course),
          )
        }
      }
    }
    CourseSetMinimum(courses~, min_credits~) => {
      match validate_rule_threshold(min_credits) {
        Err(error) => return Err(error)
        Ok(_) => ()
      }
      match validate_rule_courses(courses) {
        Err(error) => return Err(error)
        Ok(_) => ()
      }
      for course in courses {
        if !scope.contains_course(course) {
          return Err(
            @tanikun-domain.DomainError::UnknownRuleCourse(course_id=course),
          )
        }
      }
    }
    All(children~) => {
      match validate_rule_children(children) {
        Err(error) => return Err(error)
        Ok(_) => ()
      }
      match validate_rule_references(children, scope) {
        Err(error) => return Err(error)
        Ok(_) => ()
      }
    }
    Any(children~) => {
      match validate_rule_children(children) {
        Err(error) => return Err(error)
        Ok(_) => ()
      }
      match validate_rule_references(children, scope) {
        Err(error) => return Err(error)
        Ok(_) => ()
      }
    }
    AtLeast(count~, children~) => {
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
      match validate_rule_references(children, scope) {
        Err(error) => return Err(error)
        Ok(_) => ()
      }
    }
  }
  Ok(())
}

///|
fn validate_rule_references(
  children : Array[Rule],
  scope : RuleScope,
) -> Result[Unit, @tanikun-domain.DomainError] {
  for child in children {
    match child.validate(scope) {
      Err(error) => return Err(error)
      Ok(_) => ()
    }
  }
  Ok(())
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
