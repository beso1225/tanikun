///|
fn passing_grade_label(grade : @tanikun-domain.PassingGrade) -> String {
  match grade {
    @tanikun-domain.PassingGrade::ExcellentPlus => "優上"
    @tanikun-domain.PassingGrade::Excellent => "優"
    @tanikun-domain.PassingGrade::Good => "良"
    @tanikun-domain.PassingGrade::Fair => "可"
    @tanikun-domain.PassingGrade::Pass => "合"
  }
}

///|
fn failing_grade_label(grade : @tanikun-domain.FailingGrade) -> String {
  match grade {
    @tanikun-domain.FailingGrade::Fail => "不可"
    @tanikun-domain.FailingGrade::NotPassed => "否"
  }
}

///|
fn status_button(
  id : String,
  label : String,
  active : Bool,
  offering_id : @tanikun-domain.OfferingId,
  target : @app.EnrollmentStatusTarget,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  let class_name = if active {
    "min-h-11 rounded-md bg-primary px-2 text-sm font-medium text-white"
  } else {
    "min-h-11 rounded-md bg-canvas px-2 text-sm text-ink hover:bg-rule/40"
  }
  button(
    id~,
    class=class_name,
    attrs=@html.Attrs::build().aria_pressed(
      if active {
        "true"
      } else {
        "false"
      },
    ),
    on_click=emit(
      @app.PlannerMsg::UpdateEnrollmentStatus(offering_id~, target~),
    ),
    label,
  )
}

///|
fn grade_button(
  id : String,
  label : String,
  active : Bool,
  offering_id : @tanikun-domain.OfferingId,
  target : @app.EnrollmentStatusTarget,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  let class_name = if active {
    "min-h-9 rounded-md bg-primary-soft px-2 text-sm font-medium text-primary-text"
  } else {
    "min-h-9 rounded-md px-2 text-sm text-muted hover:bg-canvas"
  }
  button(
    id~,
    class=class_name,
    attrs=@html.Attrs::build().aria_pressed(
      if active {
        "true"
      } else {
        "false"
      },
    ),
    on_click=emit(
      @app.PlannerMsg::UpdateEnrollmentStatus(offering_id~, target~),
    ),
    label,
  )
}

///|
fn status_controls(
  offering_id : @tanikun-domain.OfferingId,
  current : @tanikun-domain.EnrollmentStatus?,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  let is_planned = match current {
    Some(@tanikun-domain.EnrollmentStatus::Planned) => true
    _ => false
  }
  let is_in_progress = match current {
    Some(@tanikun-domain.EnrollmentStatus::InProgress) => true
    _ => false
  }
  let passed_grade = match current {
    Some(
      @tanikun-domain.EnrollmentStatus::Confirmed(
        @tanikun-domain.ConfirmedGrade::Passed(grade~, ..)
      )
    ) => Some(grade)
    _ => None
  }
  let failing_grade = match current {
    Some(
      @tanikun-domain.EnrollmentStatus::Confirmed(
        @tanikun-domain.ConfirmedGrade::Failed(grade~)
      )
    ) => Some(grade)
    _ => None
  }
  let is_not_taken = match current {
    Some(
      @tanikun-domain.EnrollmentStatus::Confirmed(
        @tanikun-domain.ConfirmedGrade::NotTaken
      )
    ) => true
    _ => false
  }
  let default_passing = match passed_grade {
    Some(grade) => grade
    None => @tanikun-domain.PassingGrade::Excellent
  }
  let default_failing = match failing_grade {
    Some(grade) => grade
    None => @tanikun-domain.FailingGrade::Fail
  }
  let status_buttons : Array[Html] = [
    status_button(
      "status-planned",
      "予定",
      is_planned,
      offering_id,
      @app.EnrollmentStatusTarget::Planned,
      emit,
    ),
    status_button(
      "status-in-progress",
      "履修中",
      is_in_progress,
      offering_id,
      @app.EnrollmentStatusTarget::InProgress,
      emit,
    ),
    status_button(
      "status-passed",
      "合格",
      passed_grade is Some(_),
      offering_id,
      @app.EnrollmentStatusTarget::Passed(grade=default_passing),
      emit,
    ),
    status_button(
      "status-failed",
      "不合格",
      failing_grade is Some(_),
      offering_id,
      @app.EnrollmentStatusTarget::Failed(grade=default_failing),
      emit,
    ),
    status_button(
      "status-not-taken",
      "未履修",
      is_not_taken,
      offering_id,
      @app.EnrollmentStatusTarget::NotTaken,
      emit,
    ),
  ]
  let grade_buttons : Array[Html] = []
  if passed_grade is Some(_) {
    let grades = [
      (
        @tanikun-domain.PassingGrade::ExcellentPlus,
        passing_grade_label(@tanikun-domain.PassingGrade::ExcellentPlus),
        "excellent-plus",
      ),
      (
        @tanikun-domain.PassingGrade::Excellent,
        passing_grade_label(@tanikun-domain.PassingGrade::Excellent),
        "excellent",
      ),
      (
        @tanikun-domain.PassingGrade::Good,
        passing_grade_label(@tanikun-domain.PassingGrade::Good),
        "good",
      ),
      (
        @tanikun-domain.PassingGrade::Fair,
        passing_grade_label(@tanikun-domain.PassingGrade::Fair),
        "fair",
      ),
      (
        @tanikun-domain.PassingGrade::Pass,
        passing_grade_label(@tanikun-domain.PassingGrade::Pass),
        "pass",
      ),
    ]
    for entry in grades {
      let (grade, label, slug) = entry
      let active = match passed_grade {
        Some(current) => current == grade
        None => false
      }
      grade_buttons.push(
        grade_button(
          "grade-\{slug}",
          label,
          active,
          offering_id,
          @app.EnrollmentStatusTarget::Passed(grade~),
          emit,
        ),
      )
    }
  }
  if failing_grade is Some(_) {
    let grades = [
      (
        @tanikun-domain.FailingGrade::Fail,
        failing_grade_label(@tanikun-domain.FailingGrade::Fail),
        "fail",
      ),
      (
        @tanikun-domain.FailingGrade::NotPassed,
        failing_grade_label(@tanikun-domain.FailingGrade::NotPassed),
        "not-passed",
      ),
    ]
    for entry in grades {
      let (grade, label, slug) = entry
      let active = match failing_grade {
        Some(current) => current == grade
        None => false
      }
      grade_buttons.push(
        grade_button(
          "grade-\{slug}",
          label,
          active,
          offering_id,
          @app.EnrollmentStatusTarget::Failed(grade~),
          emit,
        ),
      )
    }
  }
  div(class="mt-3 border-t border-rule px-4 pt-3", [
    p(class="mb-1 text-xs font-medium text-muted", "履修状態"),
    div(class="flex flex-wrap gap-1", status_buttons),
    if grade_buttons.is_empty() {
      div(([] : Array[Html]))
    } else {
      div(class="mt-2 pb-3", [
        p(class="mb-1 text-xs font-medium text-muted", "成績"),
        div(class="flex flex-wrap gap-1", grade_buttons),
      ])
    },
  ])
}

///|
fn course_detail(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
  categories : @app.CategoryNames,
) -> Html {
  match state.selected_offering {
    None => div(([] : Array[Html]))
    Some(offering_id) =>
      match @app.find_offering(state.offerings, offering_id) {
        None => div(([] : Array[Html]))
        Some(offering) =>
          match @app.find_course(state.catalogue, offering.course_id) {
            None => div(([] : Array[Html]))
            Some(course) => {
              let (
                display_name,
                display_credits,
                display_category,
                display_slots,
              ) = match state.offering_display_with(offering_id, categories) {
                Some(value) =>
                  (value.name, value.credits, value.category_name, value.slots)
                None =>
                  (
                    course.name,
                    course.credits,
                    categories.name_for(course.id),
                    offering.slots(),
                  )
              }
              let detail = "\{credits_label(display_credits)}単位 · 区分 \{display_category} · \{schedule_label(offering.schedule())} · \{slots_label(display_slots)}"
              let current = state.enrollment_status(offering_id)
              let body : Array[Html] = [
                div(class="px-4 py-4", [p(class="text-sm text-muted", detail)]),
                match current {
                  Some(_) => status_controls(offering_id, current, emit)
                  None => div(([] : Array[Html]))
                },
                div(
                  class="flex items-center justify-between gap-1 border-t border-rule px-4 py-2",
                  [
                    button(
                      id="open-override-editor",
                      class="min-h-11 rounded-md px-2 text-sm text-primary-text hover:bg-primary-soft",
                      on_click=emit(
                        @app.PlannerMsg::OpenOverrideEditor(offering_id~),
                      ),
                      "カスタマイズ",
                    ),
                    button(
                      id="remove-detail",
                      class="min-h-11 rounded-md px-3 text-sm text-danger-text hover:bg-danger/10",
                      on_click=emit(
                        @app.PlannerMsg::RemoveEnrollment(offering_id~),
                      ),
                      "履修から削除",
                    ),
                  ],
                ),
              ]
              match state.error {
                Some(error) =>
                  body.push(
                    p(
                      class="mx-4 mt-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger-text",
                      error.message,
                    ),
                  )
                None => ()
              }
              modal_shell(
                id="course-detail-dialog",
                title_id="course-detail-title",
                close_id="close-detail",
                title=display_name,
                width_class="max-w-sm",
                close=emit(@app.PlannerMsg::ClearOfferingSelection),
                children=body,
              )
            }
          }
      }
  }
}

///|

///|
fn undo_banner(state : @app.PlannerState, emit : Emit[@app.PlannerMsg]) -> Html {
  if !state.undo_available() {
    return div(([] : Array[Html]))
  }
  div(
    id="undo-removal",
    class="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-ink px-4 py-2 text-sm text-white shadow-lg",
    attrs=@html.Attrs::build().role("status"),
    [
      span("履修を削除しました"),
      button(
        id="undo-removal-button",
        class="min-h-9 rounded-md bg-white/15 px-2 font-medium text-white hover:bg-white/25",
        on_click=emit(@app.PlannerMsg::UndoEnrollmentRemoval),
        "元に戻す",
      ),
    ],
  )
}
