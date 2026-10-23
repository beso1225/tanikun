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
pub struct RuleContext {
  priv total : @tanikun-domain.Credits
  priv by_category : Array[
    (@tanikun-domain.CategoryId, @tanikun-domain.Credits),
  ]
  priv by_course : Array[(@tanikun-domain.CourseId, @tanikun-domain.Credits)]
  priv passed_courses : Array[@tanikun-domain.CourseId]
}

///|
pub fn RuleContext::new(
  total : @tanikun-domain.Credits,
  by_category : Array[(@tanikun-domain.CategoryId, @tanikun-domain.Credits)],
  by_course : Array[(@tanikun-domain.CourseId, @tanikun-domain.Credits)],
  passed_courses : Array[@tanikun-domain.CourseId],
) -> RuleContext {
  let by_category = by_category.copy()
  by_category.sort_by(fn(left, right) { left.0.compare(right.0) })
  let by_course = by_course.copy()
  by_course.sort_by(fn(left, right) { left.0.compare(right.0) })
  let sorted_passed = passed_courses.copy()
  sorted_passed.sort_by(fn(left, right) { left.compare(right) })
  let unique_passed : Array[@tanikun-domain.CourseId] = []
  for course_id in sorted_passed {
    if unique_passed.is_empty() ||
      unique_passed[unique_passed.length() - 1] != course_id {
      unique_passed.push(course_id)
    }
  }
  { total, by_category, by_course, passed_courses: unique_passed, }
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
/// Evaluates one rule for one projection mode.
pub fn evaluate_rule(rule : Rule, context : RuleContext) -> RuleResult {
  match rule.kind {
    CategoryMinimum(categories~, min_credits~) => {
      let mut achieved = @tanikun-domain.Credits::zero()
      for category in categories {
        achieved = achieved.add(context.category_credits(category))
      }
      credit_result(achieved, min_credits)
    }
    TotalMinimum(min_credits~) => credit_result(context.total, min_credits)
    AllCoursesPassed(courses~) => {
      let mut passed = 0
      for course in courses {
        if context.has_passed(course) {
          passed = passed + 1
        }
      }
      {
        satisfaction: courses_satisfaction(passed, courses.length()),
        progress: Courses(passed~, total=courses.length()),
        children: [],
      }
    }
    CourseSetMinimum(courses~, min_credits~) => {
      let mut achieved = @tanikun-domain.Credits::zero()
      for course in courses {
        achieved = achieved.add(context.course_credits(course))
      }
      credit_result(achieved, min_credits)
    }
    All(children~) => {
      let results = evaluate_children(children, context)
      let counts = count_results(results)
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
    Any(children~) => {
      let results = evaluate_children(children, context)
      let counts = count_results(results)
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
    AtLeast(count~, children~) => {
      let results = evaluate_children(children, context)
      let counts = count_results(results)
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
  }
}

///|
priv struct ResultCounts {
  satisfied : Int
  partial : Int
}

///|
fn evaluate_children(
  children : Array[Rule],
  context : RuleContext,
) -> Array[RuleResult] {
  let results : Array[RuleResult] = []
  for child in children {
    results.push(evaluate_rule(child, context))
  }
  results
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
