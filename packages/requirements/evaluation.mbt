///|
/// How well a requirement is met.
pub(all) enum Satisfaction {
  Satisfied
  Partial
  Unsatisfied
} derive(Eq)

///|
pub extend Satisfaction with Eq::{not_equal, equal}

///|
/// Mode-specific progress for a rule result.
pub(all) enum Progress {
  Credits(
    achieved~ : @tanikun-domain.Credits,
    required~ : @tanikun-domain.Credits
  )
  Courses(passed~ : Int, total~ : Int)
  Children(satisfied~ : Int, partial~ : Int, total~ : Int)
}

///|
/// The evaluation of one rule for one projection mode.
pub struct RuleResult {
  satisfaction : Satisfaction
  progress : Progress
  priv children : Array[RuleResult]
}

///|
pub fn RuleResult::children(self : RuleResult) -> Array[RuleResult] {
  self.children.copy()
}

///|
/// The mode-specific data used to evaluate a rule tree.
///
/// Construction copies and sorts category/course entries and deduplicates
/// passed courses. `passed_courses` is intentionally mode-independent; see
/// `RuleContext::new`.
pub struct RuleContext {
  priv total : @tanikun-domain.Credits
  priv by_category : Array[
    (@tanikun-domain.CategoryId, @tanikun-domain.Credits),
  ]
  priv by_course : Array[(@tanikun-domain.CourseId, @tanikun-domain.Credits)]
  priv passed_courses : Array[@tanikun-domain.CourseId]
}

///|
/// Builds a rule context.
///
/// Category, course, and passed-course IDs are sorted and deduplicated. When a
/// duplicate category or course ID is supplied, the first entry wins.
///
/// `passed_courses` is intentionally mode-independent: only confirmed passed
/// enrollments count. Projected enrollments contribute to credit-based leaves
/// but do not make `AllCoursesPassed` satisfied.
pub fn RuleContext::new(
  total : @tanikun-domain.Credits,
  by_category : Array[(@tanikun-domain.CategoryId, @tanikun-domain.Credits)],
  by_course : Array[(@tanikun-domain.CourseId, @tanikun-domain.Credits)],
  passed_courses : Array[@tanikun-domain.CourseId],
) -> RuleContext {
  let by_category = unique_sorted_by(by_category, fn(entry) { entry.0 }, fn(
    left,
    right,
  ) {
    left.compare(right)
  })
  let by_course = unique_sorted_by(by_course, fn(entry) { entry.0 }, fn(
    left,
    right,
  ) {
    left.compare(right)
  })
  let passed_courses = unique_sorted_by(
    passed_courses,
    fn(course_id) { course_id },
    fn(left, right) { left.compare(right) },
  )
  { total, by_category, by_course, passed_courses, }
}

///|
pub fn RuleContext::total(self : RuleContext) -> @tanikun-domain.Credits {
  self.total
}

///|
pub fn RuleContext::by_category(
  self : RuleContext,
) -> Array[(@tanikun-domain.CategoryId, @tanikun-domain.Credits)] {
  self.by_category.copy()
}

///|
pub fn RuleContext::by_course(
  self : RuleContext,
) -> Array[(@tanikun-domain.CourseId, @tanikun-domain.Credits)] {
  self.by_course.copy()
}

///|
pub fn RuleContext::passed_courses(
  self : RuleContext,
) -> Array[@tanikun-domain.CourseId] {
  self.passed_courses.copy()
}

///|
fn[T, K] unique_sorted_by(
  items : Array[T],
  key : (T) -> K,
  compare : (K, K) -> Int,
) -> Array[T] {
  let unique : Array[T] = []
  for item in items {
    let mut seen = false
    for existing in unique {
      if compare(key(existing), key(item)) == 0 {
        seen = true
      }
    }
    if !seen {
      unique.push(item)
    }
  }
  unique.sort_by(fn(left, right) { compare(key(left), key(right)) })
  unique
}

///|
priv struct EvalFrame {
  rule : Rule
  child_index : Int
  results : Array[RuleResult]
}

///|
/// Evaluates one rule for one projection mode.
pub fn evaluate_rule(rule : Rule, context : RuleContext) -> RuleResult {
  let stack : Array[EvalFrame] = [{ rule, child_index: 0, results: [], }]
  while !stack.is_empty() {
    let index = stack.length() - 1
    let frame = stack[index]
    match evaluate_leaf(frame.rule, context) {
      Some(result) => {
        let _ = stack.pop()
        if stack.is_empty() {
          return result
        }
        stack[stack.length() - 1].results.push(result)
      }
      None => {
        let children = match frame.rule.kind {
          All(children~) => children
          Any(children~) => children
          AtLeast(children~, ..) => children
          _ => []
        }
        if frame.child_index < children.length() {
          let child = children[frame.child_index]
          stack[index] = {
            rule: frame.rule,
            child_index: frame.child_index + 1,
            results: frame.results,
          }
          stack.push({ rule: child, child_index: 0, results: [], })
        } else {
          let result = evaluate_node(frame.rule, frame.results)
          let _ = stack.pop()
          if stack.is_empty() {
            return result
          }
          stack[stack.length() - 1].results.push(result)
        }
      }
    }
  }
  // Unreachable: the stack only empties after returning the root result.
  panic()
}

///|
fn evaluate_leaf(rule : Rule, context : RuleContext) -> RuleResult? {
  match rule.kind {
    CategoryMinimum(categories~, min_credits~) => {
      let mut achieved = @tanikun-domain.Credits::zero()
      for category in categories {
        achieved = achieved.add(context.category_credits(category))
      }
      Some(credit_result(achieved, min_credits))
    }
    TotalMinimum(min_credits~) =>
      Some(credit_result(context.total, min_credits))
    AllCoursesPassed(courses~) => {
      let mut passed = 0
      for course in courses {
        if context.has_passed(course) {
          passed = passed + 1
        }
      }
      Some({
        satisfaction: courses_satisfaction(passed, courses.length()),
        progress: Courses(passed~, total=courses.length()),
        children: [],
      })
    }
    MandatoryCourses(courses~) => {
      let included = courses
        .filter(course => context.by_course.any(entry => entry.0 == course))
        .length()
      Some({
        satisfaction: courses_satisfaction(included, courses.length()),
        progress: Courses(passed=included, total=courses.length()),
        children: [],
      })
    }
    CourseSetMinimum(courses~, min_credits~) => {
      let mut achieved = @tanikun-domain.Credits::zero()
      for course in courses {
        achieved = achieved.add(context.course_credits(course))
      }
      Some(credit_result(achieved, min_credits))
    }
    _ => None
  }
}

///|
fn evaluate_node(rule : Rule, results : Array[RuleResult]) -> RuleResult {
  let counts = count_results(results)
  match rule.kind {
    All(_) => {
      let satisfaction = if counts.satisfied == results.length() {
        Satisfied
      } else if counts.satisfied == 0 && counts.partial == 0 {
        Unsatisfied
      } else {
        Partial
      }
      {
        satisfaction,
        progress: Children(
          satisfied=counts.satisfied,
          partial=counts.partial,
          total=results.length(),
        ),
        children: results,
      }
    }
    Any(_) => {
      let satisfaction = if counts.satisfied > 0 {
        Satisfied
      } else if counts.partial > 0 {
        Partial
      } else {
        Unsatisfied
      }
      {
        satisfaction,
        progress: Children(
          satisfied=counts.satisfied,
          partial=counts.partial,
          total=results.length(),
        ),
        children: results,
      }
    }
    AtLeast(count~, ..) => {
      let satisfaction = if counts.satisfied >= count {
        Satisfied
      } else if counts.satisfied + counts.partial >= count {
        Partial
      } else {
        Unsatisfied
      }
      {
        satisfaction,
        progress: Children(
          satisfied=counts.satisfied,
          partial=counts.partial,
          total=results.length(),
        ),
        children: results,
      }
    }
    _ =>
      {
        satisfaction: Unsatisfied,
        progress: Children(satisfied=0, partial=0, total=0),
        children: [],
      }
  }
}

///|
priv struct ResultCounts {
  satisfied : Int
  partial : Int
}

///|
fn count_results(results : Array[RuleResult]) -> ResultCounts {
  let mut satisfied = 0
  let mut partial = 0
  for result in results {
    match result.satisfaction {
      Satisfied => satisfied = satisfied + 1
      Partial => partial = partial + 1
      Unsatisfied => ()
    }
  }
  { satisfied, partial, }
}

///|
fn credit_result(
  achieved : @tanikun-domain.Credits,
  required : @tanikun-domain.Credits,
) -> RuleResult {
  {
    satisfaction: credit_satisfaction(achieved, required),
    progress: Credits(achieved~, required~),
    children: [],
  }
}

///|
fn credit_satisfaction(
  achieved : @tanikun-domain.Credits,
  required : @tanikun-domain.Credits,
) -> Satisfaction {
  if achieved.half_units() == 0 {
    Unsatisfied
  } else if achieved.half_units() < required.half_units() {
    Partial
  } else {
    Satisfied
  }
}

///|
fn courses_satisfaction(passed : Int, total : Int) -> Satisfaction {
  if passed == 0 {
    Unsatisfied
  } else if passed < total {
    Partial
  } else {
    Satisfied
  }
}

///|
fn RuleContext::category_credits(
  self : RuleContext,
  category_id : @tanikun-domain.CategoryId,
) -> @tanikun-domain.Credits {
  for entry in self.by_category {
    if entry.0 == category_id {
      return entry.1
    }
  }
  @tanikun-domain.Credits::zero()
}

///|
fn RuleContext::course_credits(
  self : RuleContext,
  course_id : @tanikun-domain.CourseId,
) -> @tanikun-domain.Credits {
  for entry in self.by_course {
    if entry.0 == course_id {
      return entry.1
    }
  }
  @tanikun-domain.Credits::zero()
}

///|
fn RuleContext::has_passed(
  self : RuleContext,
  course_id : @tanikun-domain.CourseId,
) -> Bool {
  for passed in self.passed_courses {
    if passed == course_id {
      return true
    }
  }
  false
}

///|
/// The complete credit and requirement evaluation.
pub struct Evaluation {
  credits : Projection[CreditSummary]
  requirements : Projection[RuleResult]
}

///|
pub fn evaluate(
  input : EvaluationInput[Rule],
) -> Result[Evaluation, @tanikun-domain.DomainError] {
  let data = match accumulate_credits(input) {
    Ok(data) => data
    Err(error) => return Err(error)
  }
  let rule = input.requirement_set.rule()
  let confirmed_context = RuleContext::new(
    data.confirmed.total,
    data.confirmed.by_category,
    data.confirmed.by_course,
    data.confirmed.passed_courses,
  )
  let standard_context = RuleContext::new(
    data.standard.total,
    data.standard.by_category,
    data.standard.by_course,
    data.standard.passed_courses,
  )
  let optimistic_context = RuleContext::new(
    data.optimistic.total,
    data.optimistic.by_category,
    data.optimistic.by_course,
    data.optimistic.passed_courses,
  )
  // CreditSummary conversion stays centralized in CreditModeData::to_summary.
  Ok({
    credits: {
      confirmed: data.confirmed.to_summary(),
      standard: data.standard.to_summary(),
      optimistic: data.optimistic.to_summary(),
    },
    requirements: {
      confirmed: evaluate_rule(rule, confirmed_context),
      standard: evaluate_rule(rule, standard_context),
      optimistic: evaluate_rule(rule, optimistic_context),
    },
  })
}
