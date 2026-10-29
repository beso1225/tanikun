///|
pub struct SummaryCategory {
  name : String
  confirmed : @tanikun-domain.Credits
  standard : @tanikun-domain.Credits
  optimistic : @tanikun-domain.Credits
}

///|
/// One projection of a requirement tree node.
pub struct RequirementMode {
  satisfaction : @tanikun-requirements.Satisfaction
  status : String
  progress : String
  remaining : String
  unit : String
  done : Int
  total : Int
}

///|
pub fn RequirementMode::status_label(self : RequirementMode) -> String {
  self.status
}

///|
/// One node in the requirement result tree with all three projections.
pub struct RequirementNode {
  label : String
  confirmed : RequirementMode
  standard : RequirementMode
  optimistic : RequirementMode
  children : Array[RequirementNode]
}

///|
fn requirement_label(
  rule : @tanikun-requirements.Rule,
  is_root : Bool,
) -> String {
  if rule.is_all() {
    if is_root {
      "全体"
    } else {
      "すべての要件"
    }
  } else if rule.is_any() {
    "いずれか1つ以上の要件"
  } else if rule.children() is Some(_) {
    match rule.at_least_count() {
      Some(count) => "要件のうち\{count}件以上"
      None => "複合要件"
    }
  } else if rule.category_ids() is Some(_) {
    "区分単位数"
  } else if rule.course_ids() is Some(_) {
    if rule.min_credits() is Some(_) {
      "科目群の単位数"
    } else {
      "全科目合格"
    }
  } else if rule.min_credits() is Some(_) {
    "合計単位数"
  } else {
    "要件"
  }
}

///|
fn requirement_node(
  rule : @tanikun-requirements.Rule,
  confirmed : @tanikun-requirements.RuleResult,
  standard : @tanikun-requirements.RuleResult,
  optimistic : @tanikun-requirements.RuleResult,
  is_root : Bool,
) -> RequirementNode {
  let children : Array[RequirementNode] = []
  let confirmed_children = confirmed.children()
  let standard_children = standard.children()
  let optimistic_children = optimistic.children()
  match rule.children() {
    Some(child_rules) =>
      for index in 0..<child_rules.length() {
        if index < confirmed_children.length() {
          children.push(
            requirement_node(
              child_rules[index],
              confirmed_children[index],
              if index < standard_children.length() {
                standard_children[index]
              } else {
                confirmed_children[index]
              },
              if index < optimistic_children.length() {
                optimistic_children[index]
              } else {
                confirmed_children[index]
              },
              false,
            ),
          )
        }
      }
    None => ()
  }
  let confirmed_satisfied = confirmed.satisfaction ==
    @tanikun-requirements.Satisfaction::Satisfied
  let standard_satisfied = standard.satisfaction ==
    @tanikun-requirements.Satisfaction::Satisfied
  let optimistic_satisfied = optimistic.satisfaction ==
    @tanikun-requirements.Satisfaction::Satisfied
  let confirmed_status = if confirmed_satisfied { "達成" } else { "不足" }
  let standard_status = if confirmed_satisfied {
    "達成"
  } else if standard_satisfied {
    "履修中で充足見込"
  } else {
    "不足"
  }
  let optimistic_status = if confirmed_satisfied {
    "達成"
  } else if standard_satisfied {
    "履修中で充足見込"
  } else if optimistic_satisfied {
    "計画上充足"
  } else {
    "不足"
  }
  {
    label: requirement_label(rule, is_root),
    confirmed: requirement_mode(confirmed, confirmed_status),
    standard: requirement_mode(standard, standard_status),
    optimistic: requirement_mode(optimistic, optimistic_status),
    children,
  }
}

///|
fn requirement_mode(
  result : @tanikun-requirements.RuleResult,
  status : String,
) -> RequirementMode {
  let (done, total) = progress_counts(result.progress)
  {
    satisfaction: result.satisfaction,
    status,
    progress: progress_label(result.progress),
    remaining: remaining_label(result.progress),
    unit: match result.progress {
      @tanikun-requirements.Progress::Credits(..) => "単位"
      @tanikun-requirements.Progress::Courses(..) => "科目"
      @tanikun-requirements.Progress::Children(..) => "件"
    },
    done,
    total,
  }
}

///|
fn remaining_label(progress : @tanikun-requirements.Progress) -> String {
  match progress {
    @tanikun-requirements.Progress::Credits(achieved~, required~) =>
      if achieved.half_units() < required.half_units() {
        "あと \{half_units_text(required.half_units() - achieved.half_units())}単位"
      } else {
        ""
      }
    @tanikun-requirements.Progress::Courses(passed~, total~) =>
      if passed < total {
        "あと \{total - passed}科目"
      } else {
        ""
      }
    @tanikun-requirements.Progress::Children(satisfied~, total~, ..) =>
      if satisfied < total {
        "あと \{total - satisfied}件"
      } else {
        ""
      }
  }
}

///|
fn progress_counts(progress : @tanikun-requirements.Progress) -> (Int, Int) {
  match progress {
    @tanikun-requirements.Progress::Credits(achieved~, required~) =>
      (achieved.half_units(), required.half_units())
    @tanikun-requirements.Progress::Courses(passed~, total~) => (passed, total)
    @tanikun-requirements.Progress::Children(satisfied~, total~, ..) =>
      (satisfied, total)
  }
}

///|
fn half_units_text(half_units : Int) -> String {
  if half_units % 2 == 0 {
    "\{half_units / 2}"
  } else {
    "\{half_units / 2}.5"
  }
}

///|
fn credits_text(credits : @tanikun-domain.Credits) -> String {
  half_units_text(credits.half_units())
}

///|
fn progress_label(progress : @tanikun-requirements.Progress) -> String {
  match progress {
    @tanikun-requirements.Progress::Credits(achieved~, required~) =>
      "\{credits_text(achieved)} / \{credits_text(required)}単位"
    @tanikun-requirements.Progress::Courses(passed~, total~) =>
      "合格 \{passed} / \{total}科目"
    @tanikun-requirements.Progress::Children(satisfied~, partial~, total~) =>
      "要件 \{satisfied} / \{total}件（部分 \{partial}）"
  }
}

///|
/// A complete derived summary of credits and requirements.
pub struct PlannerSummary {
  confirmed : @tanikun-domain.Credits
  standard : @tanikun-domain.Credits
  optimistic : @tanikun-domain.Credits
  categories : Array[SummaryCategory]
  requirement_root : RequirementNode
}

///|
pub fn PlannerState::planner_summary(
  self : PlannerState,
) -> Result[PlannerSummary, @tanikun-domain.DomainError] {
  let requirement_set = match self.effective_requirement_set() {
    Some(value) => value
    None =>
      return Err(@tanikun-domain.DomainError::ProfileRequirementSetMismatch)
  }
  let input = match self.evaluation_input() {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  let evaluation = match @tanikun-requirements.evaluate(input) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  let categories : Array[SummaryCategory] = []
  for category in requirement_set.categories() {
    let confirmed = match
      evaluation.credits.confirmed.category_credits(category.id) {
      Some(value) => value
      None => @tanikun-domain.Credits::zero()
    }
    let standard = match
      evaluation.credits.standard.category_credits(category.id) {
      Some(value) => value
      None => @tanikun-domain.Credits::zero()
    }
    let optimistic = match
      evaluation.credits.optimistic.category_credits(category.id) {
      Some(value) => value
      None => @tanikun-domain.Credits::zero()
    }
    categories.push({ name: category.name, confirmed, standard, optimistic, })
  }
  Ok({
    confirmed: evaluation.credits.confirmed.total,
    standard: evaluation.credits.standard.total,
    optimistic: evaluation.credits.optimistic.total,
    categories,
    requirement_root: requirement_node(
      requirement_set.rule(),
      evaluation.requirements.confirmed,
      evaluation.requirements.standard,
      evaluation.requirements.optimistic,
      true,
    ),
  })
}

///|
/// Looks up the active requirement set from the profile and the available sets.
pub fn PlannerState::active_requirement_set(
  self : PlannerState,
) -> @tanikun-requirements.RequirementSet[@tanikun-requirements.Rule]? {
  self.requirement_sets.lookup_for_profile(self.profile)
}

///|
/// The active set with custom course category assignments merged in.
pub fn PlannerState::effective_requirement_set(
  self : PlannerState,
) -> @tanikun-requirements.RequirementSet[@tanikun-requirements.Rule]? {
  let base = match self.active_requirement_set() {
    Some(value) => value
    None => return None
  }
  let categories = base.categories()
  let assignments = []
  for assignment in base.assignments() {
    let mut replaced = false
    for custom in self.custom_categories {
      if assignment.0 == custom.0 {
        replaced = true
      }
    }
    if !replaced {
      assignments.push(assignment)
    }
  }
  for custom in self.custom_categories {
    let mut known = false
    for category in categories {
      if category.id == custom.1 {
        known = true
      }
    }
    if known {
      assignments.push(custom)
    }
  }
  match
    @tanikun-requirements.RequirementSet::new(
      base.key,
      categories,
      assignments,
      base.rule(),
    ) {
    Ok(value) => Some(value)
    Err(_) => None
  }
}

///|
pub fn PlannerState::category_id_for_course(
  self : PlannerState,
  course_id : @tanikun-domain.CourseId,
) -> @tanikun-domain.CategoryId? {
  match self.effective_requirement_set() {
    Some(value) => value.category_for(course_id)
    None => None
  }
}

///|
/// One render-scoped course-to-category-name lookup.
pub struct CategoryNames {
  entries : Array[(@tanikun-domain.CourseId, String)]
}

///|
pub fn CategoryNames::name_for(
  self : CategoryNames,
  course_id : @tanikun-domain.CourseId,
) -> String {
  for entry in self.entries {
    if entry.0 == course_id {
      return entry.1
    }
  }
  "未分類"
}

///|
pub fn PlannerState::category_names(self : PlannerState) -> CategoryNames {
  let entries = []
  match self.effective_requirement_set() {
    Some(set) => {
      let categories = set.categories()
      for assignment in set.assignments() {
        let mut name = "未分類"
        for category in categories {
          if category.id == assignment.1 {
            name = category.name
          }
        }
        entries.push((assignment.0, name))
      }
    }
    None => ()
  }
  { entries, }
}

///|
pub fn PlannerState::category_name_for(
  self : PlannerState,
  course_id : @tanikun-domain.CourseId,
) -> String? {
  let set = match self.effective_requirement_set() {
    Some(value) => value
    None => return None
  }
  let category_id = match set.category_for(course_id) {
    Some(value) => value
    None => return None
  }
  for category in set.categories() {
    if category.id == category_id {
      return Some(category.name)
    }
  }
  None
}

///|
fn PlannerState::evaluation_input(
  self : PlannerState,
) -> Result[
  @tanikun-requirements.EvaluationInput[@tanikun-requirements.Rule],
  @tanikun-domain.DomainError,
] {
  let requirement_set = match self.effective_requirement_set() {
    Some(value) => value
    None =>
      return Err(@tanikun-domain.DomainError::ProfileRequirementSetMismatch)
  }
  Ok(
    @tanikun-requirements.EvaluationInput::new(
      self.profile,
      requirement_set,
      self.catalogue,
      self.offerings,
      self.enrollments,
      self.overrides,
    ),
  )
}

///|
/// Available program IDs, in requirement-set order.
pub fn PlannerState::program_ids(
  self : PlannerState,
) -> Array[@tanikun-domain.ProgramId] {
  let programs : Array[@tanikun-domain.ProgramId] = []
  for key in self.requirement_sets.keys() {
    let mut seen = false
    for program in programs {
      if program == key.program_id {
        seen = true
      }
    }
    if !seen {
      programs.push(key.program_id)
    }
  }
  let mut current_seen = false
  for program in programs {
    if program == self.profile.program_id {
      current_seen = true
    }
  }
  if !current_seen {
    programs.push(self.profile.program_id)
  }
  programs
}

///|
/// Available advancement years for a program, in requirement-set order.
pub fn PlannerState::advancement_years(
  self : PlannerState,
  program_id : @tanikun-domain.ProgramId,
) -> Array[@tanikun-domain.AcademicYear] {
  let years : Array[@tanikun-domain.AcademicYear] = []
  for key in self.requirement_sets.keys() {
    if key.program_id == program_id {
      let mut seen = false
      for year in years {
        if year == key.advancement_year {
          seen = true
        }
      }
      if !seen {
        years.push(key.advancement_year)
      }
    }
  }
  if self.profile.program_id == program_id {
    let mut seen = false
    for year in years {
      if year == self.profile.advancement_year {
        seen = true
      }
    }
    if !seen {
      years.push(self.profile.advancement_year)
    }
  }
  years
}

///|
/// A status the user can apply to an existing enrollment.
