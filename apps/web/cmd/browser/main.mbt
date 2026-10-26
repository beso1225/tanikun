///|
using @rabbita {type Emit, type Html, type Val}

///|
using @html {
  a,
  aside,
  button,
  div,
  h1,
  h2,
  header,
  input,
  label,
  main_,
  nav,
  option,
  p,
  section,
  select,
  span,
  table,
  tbody,
  td,
  th,
  thead,
  tr,
}

///|
fn day_label(day : @tanikun-domain.DayOfWeek) -> String {
  match day {
    @tanikun-domain.DayOfWeek::Monday => "月"
    @tanikun-domain.DayOfWeek::Tuesday => "火"
    @tanikun-domain.DayOfWeek::Wednesday => "水"
    @tanikun-domain.DayOfWeek::Thursday => "木"
    @tanikun-domain.DayOfWeek::Friday => "金"
    @tanikun-domain.DayOfWeek::Saturday => "土"
    @tanikun-domain.DayOfWeek::Sunday => "日"
  }
}

///|
fn day_index(day : @tanikun-domain.DayOfWeek) -> Int {
  match day {
    @tanikun-domain.DayOfWeek::Monday => 0
    @tanikun-domain.DayOfWeek::Tuesday => 1
    @tanikun-domain.DayOfWeek::Wednesday => 2
    @tanikun-domain.DayOfWeek::Thursday => 3
    @tanikun-domain.DayOfWeek::Friday => 4
    @tanikun-domain.DayOfWeek::Saturday => 5
    @tanikun-domain.DayOfWeek::Sunday => 6
  }
}

///|
fn slot_id(day : @tanikun-domain.DayOfWeek, period : Int) -> String {
  "slot-\{day_index(day)}-\{period}"
}

///|
/// Formats a whole-unit label. `Credits` stores half-units, so odd values end
/// in `.5`.
fn credits_label(credits : @tanikun-domain.Credits) -> String {
  let half = credits.half_units()
  if half % 2 == 0 {
    "\{half / 2}"
  } else {
    "\{half / 2}.5"
  }
}

///|
fn term_label(term : @tanikun-domain.Term) -> String {
  match term {
    @tanikun-domain.Term::S1 => "S1"
    @tanikun-domain.Term::S2 => "S2"
    @tanikun-domain.Term::A1 => "A1"
    @tanikun-domain.Term::A2 => "A2"
  }
}

///|
fn semester_label(semester : @tanikun-domain.Semester) -> String {
  match semester {
    @tanikun-domain.Semester::S => "S"
    @tanikun-domain.Semester::A => "A"
    @tanikun-domain.Semester::W => "W"
  }
}

///|
fn schedule_label(schedule : @tanikun-domain.OfferingSchedule) -> String {
  match schedule {
    @tanikun-domain.OfferingSchedule::Regular(terms~) =>
      terms.map(term_label).join(", ")
    @tanikun-domain.OfferingSchedule::YearLong => "通年"
    @tanikun-domain.OfferingSchedule::Intensive(semester~) =>
      "集中 " + semester_label(semester)
  }
}

///|
fn slots_label(slots : Array[@tanikun-domain.Slot]) -> String {
  if slots.is_empty() {
    return "曜限なし"
  }
  let labels : Array[String] = []
  for slot in slots {
    labels.push("\{day_label(slot.day)}\{slot.period.value()}")
  }
  labels.join(", ")
}

///|
fn enrollment_status_view(
  status : @tanikun-domain.EnrollmentStatus,
) -> (String, String) {
  match status {
    @tanikun-domain.EnrollmentStatus::Planned => ("予定", "text-muted-tile")
    @tanikun-domain.EnrollmentStatus::InProgress =>
      ("履修中", "text-primary-text")
    @tanikun-domain.EnrollmentStatus::Confirmed(
      @tanikun-domain.ConfirmedGrade::Passed(..)
    ) => ("合格", "text-success-text-tile")
    @tanikun-domain.EnrollmentStatus::Confirmed(
      @tanikun-domain.ConfirmedGrade::Failed(..)
    ) => ("不合格", "text-danger-text")
    @tanikun-domain.EnrollmentStatus::Confirmed(
      @tanikun-domain.ConfirmedGrade::NotTaken
    ) => ("未履修", "text-muted-tile")
  }
}

///|
fn enrollment_status_badge(status : @tanikun-domain.EnrollmentStatus) -> Html {
  let (label, class_name) = enrollment_status_view(status)
  span(class="text-[0.6875rem] font-medium \{class_name}", label)
}

///|
fn app_mark() -> Html {
  div(
    attrs=@html.Attrs::build().aria_hidden("true"),
    class="flex h-7 w-7 flex-col justify-center gap-[3px] rounded-[7px] bg-primary px-[5px]",
    [
      div(class="h-[2px] w-full rounded-full bg-white/90", ([] : Array[Html])),
      div(class="h-[2px] w-3/4 rounded-full bg-white/70", ([] : Array[Html])),
      div(class="h-[2px] w-1/2 rounded-full bg-white/50", ([] : Array[Html])),
    ],
  )
}

///|
fn find_block(
  blocks : Array[@app.ScheduledBlock],
  day : @tanikun-domain.DayOfWeek,
  period : Int,
) -> @app.ScheduledBlock? {
  for block in blocks {
    if block.day == day && block.period.value() == period {
      return Some(block)
    }
  }
  None
}

///|
fn term_section(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  let tabs : Array[Html] = []
  for term in @app.PlannerTerm::values() {
    let selected = state.selected_term == term
    let class_name = if selected {
      "flex min-h-9 w-full items-center justify-center rounded-md bg-primary px-3 text-center text-sm font-medium text-white md:justify-start"
    } else {
      "flex min-h-9 w-full items-center justify-center rounded-md px-3 text-center text-sm text-ink hover:bg-rule/40 md:justify-start"
    }
    tabs.push(
      button(
        id="term-\{term.label()}",
        class=class_name,
        on_click=emit(@app.PlannerMsg::SelectTerm(term~)),
        term.label(),
      ),
    )
  }
  aside(
    class="flex w-full shrink-0 flex-col gap-3 border-b border-rule bg-canvas p-3 md:w-56 md:border-b-0 md:border-r",
    [
      div(class="flex items-center gap-2 px-2 pt-1", [
        app_mark(),
        h1(class="text-sm font-semibold", "応物単位くん"),
      ]),
      nav(class="grid grid-cols-5 gap-1 md:flex md:flex-col md:gap-0.5", tabs),
      button(
        id="open-custom-course",
        class="mt-1 min-h-8 rounded-md px-2 text-left text-xs text-primary-text hover:bg-primary-soft",
        on_click=emit(@app.PlannerMsg::OpenCustomCourseForm),
        "独自科目",
      ),
    ],
  )
}

///|
fn range_controls(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  div(
    attrs=@html.Attrs::build().role("group").aria_label("表示範囲"),
    class="flex items-center gap-1 rounded-md bg-canvas p-0.5 text-xs",
    [
      button(
        id="remove-day",
        title="表示する曜日を減らす",
        attrs=@html.Attrs::build().aria_label("表示する曜日を減らす"),
        class="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-rule/50 disabled:opacity-30",
        disabled=state.visible_days <= 5,
        on_click=emit(@app.PlannerMsg::DecreaseVisibleDays),
        "-",
      ),
      span(class="min-w-6 text-center text-ink", "\{state.visible_days}日"),
      button(
        id="add-day",
        title="表示する曜日を増やす",
        attrs=@html.Attrs::build().aria_label("表示する曜日を増やす"),
        class="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-rule/50 disabled:opacity-30",
        disabled=state.visible_days >= 7,
        on_click=emit(@app.PlannerMsg::IncreaseVisibleDays),
        "+",
      ),
      span(class="px-1 text-rule", "/"),
      button(
        id="remove-period",
        title="表示する時限を減らす",
        attrs=@html.Attrs::build().aria_label("表示する時限を減らす"),
        class="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-rule/50 disabled:opacity-30",
        disabled=state.visible_periods <= 6,
        on_click=emit(@app.PlannerMsg::DecreaseVisiblePeriods),
        "-",
      ),
      span(class="min-w-6 text-center text-ink", "\{state.visible_periods}限"),
      button(
        id="add-period",
        title="表示する時限を増やす",
        attrs=@html.Attrs::build().aria_label("表示する時限を増やす"),
        class="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-rule/50 disabled:opacity-30",
        disabled=state.visible_periods >= 10,
        on_click=emit(@app.PlannerMsg::IncreaseVisiblePeriods),
        "+",
      ),
    ],
  )
}

///|
fn timetable_grid(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  let blocks = state.scheduled_blocks(state.selected_term)
  let days = state.visible_day_values()
  let header : Array[Html] = [
    th(
      scope=@html.Scope::Col,
      class="w-8 border-b border-rule bg-canvas px-1 py-2 text-left text-xs font-medium text-muted sm:w-12 sm:px-3",
      "時限",
    ),
  ]
  for day in days {
    header.push(
      th(
        scope=@html.Scope::Col,
        class="border-b border-rule bg-canvas px-1 py-2 text-left text-xs font-medium text-muted sm:px-3",
        day_label(day),
      ),
    )
  }
  let rows : Array[Html] = []
  for period in state.visible_period_values() {
    let cells : Array[Html] = [
      th(
        scope=@html.Scope::Row,
        class="w-8 border-b border-rule px-1 py-2 text-xs font-normal text-muted sm:w-12 sm:px-3",
        "\{period}",
      ),
    ]
    for day in days {
      let cell = match find_block(blocks, day, period) {
        Some(block) =>
          td(
            class="h-20 border-b border-rule p-0.5 align-top sm:h-16 sm:p-1.5",
            [
              button(
                id="open-detail-\{block.offering_id.value}-\{day_label(block.day)}-\{block.period.value()}",
                class="flex h-full w-full items-start justify-start rounded-md bg-primary-soft px-0.5 py-1 text-left hover:bg-primary-soft/80 sm:px-2 sm:py-1.5",
                on_click=emit(
                  @app.PlannerMsg::SelectOffering(offering_id=block.offering_id),
                ),
                div(class="flex h-full w-full flex-col justify-between", [
                  span(
                    class="block break-words text-[0.6875rem] font-medium leading-tight tracking-tight text-ink sm:text-sm",
                    block.course_name,
                  ),
                  enrollment_status_badge(block.status),
                ]),
              ),
            ],
          )
        None =>
          td(class="h-20 border-b border-rule p-0 align-middle sm:h-16", [
            button(
              id=slot_id(day, period),
              title="\{day_label(day)}\{period}限に科目を追加",
              attrs=@html.Attrs::build().aria_label(
                "\{day_label(day)}\{period}限に科目を追加",
              ),
              class="h-full w-full bg-transparent p-0 hover:bg-primary-soft/40",
              on_click=emit(@app.PlannerMsg::OpenSlotPicker(day~, period~)),
              ([] : Array[Html]),
            ),
          ])
      }
      cells.push(cell)
    }
    rows.push(tr(cells))
  }
  let hidden = state.hidden_scheduled_block_count(state.selected_term)
  let children : Array[Html] = [
    div(
      id="timetable-scroll",
      class="mt-4 overflow-visible rounded-lg border border-rule bg-paper",
      [
        table(
          id="timetable",
          class="w-full table-fixed border-separate border-spacing-x-1 border-spacing-y-0 text-sm sm:border-spacing-x-2",
          [thead(header), tbody(rows)],
        ),
      ],
    ),
  ]
  if hidden > 0 {
    children.push(
      p(
        id="hidden-blocks",
        class="mt-2 text-xs text-muted",
        "表示範囲外に\{hidden}件の履修があります",
      ),
    )
  }
  div(children)
}

///|
fn off_grid(state : @app.PlannerState, emit : Emit[@app.PlannerMsg]) -> Html {
  let entries = state.off_grid_entries(state.selected_term)
  let items : Array[Html] = []
  for entry in entries {
    items.push(
      button(
        id="open-detail-\{entry.offering_id.value}",
        class="flex min-h-12 w-full items-start justify-start rounded-lg bg-primary-soft px-3 py-2 text-left hover:bg-primary-soft/80",
        on_click=emit(
          @app.PlannerMsg::SelectOffering(offering_id=entry.offering_id),
        ),
        [
          div(class="min-w-0", [
            p(class="truncate text-sm font-medium text-ink", entry.course_name),
            div(class="mt-0.5 flex items-center gap-2 text-xs text-muted", [
              span("\{credits_label(entry.credits)}単位"),
              enrollment_status_badge(entry.status),
            ]),
          ]),
        ],
      ),
    )
  }
  if entries.is_empty() {
    items.push(
      p(class="px-3 py-4 text-sm text-muted", "集中講義はありません"),
    )
  }
  section(id="off-grid", class="mt-5", [
    div(class="mb-2 flex items-center justify-between", [
      h2(class="text-sm font-semibold", "集中講義"),
      button(
        id="open-intensive-picker",
        class="min-h-8 rounded-md px-2 text-xs text-primary-text hover:bg-primary-soft",
        on_click=emit(@app.PlannerMsg::OpenIntensivePicker),
        "追加",
      ),
    ]),
    div(class="flex flex-col gap-2", items),
  ])
}

///|
fn picker_label(target : @app.PickerTarget) -> String {
  match target {
    @app.PickerTarget::Slot(day~, period~) =>
      "\{day_label(day)}\{period}限に追加"
    @app.PickerTarget::Intensive => "集中講義を追加"
    @app.PickerTarget::All => "科目を追加"
  }
}

///|
/// One modal shell for every dialog in the planner. It owns the backdrop,
/// dialog semantics, the header, and the shared close affordance.
fn modal_shell(
  id~ : String,
  title_id~ : String,
  close_id~ : String,
  title~ : String,
  width_class~ : String,
  close~ : @rabbita.Cmd,
  children~ : Array[Html],
) -> Html {
  let content : Array[Html] = [
    div(
      class="flex min-h-12 items-center justify-between border-b border-rule px-4",
      [
        h2(id=title_id, class="text-[1.0625rem] font-semibold", title),
        button(
          id=close_id,
          class="min-h-11 rounded-md px-2 text-sm text-ink hover:bg-primary-soft",
          attrs=@html.Attrs::build().data_set("dialog-close", "true"),
          on_click=close,
          "完了",
        ),
      ],
    ),
  ]
  for child in children {
    content.push(child)
  }
  div(
    class="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4",
    [
      div(
        id="\{id}-backdrop",
        class="absolute inset-0",
        on_click=close,
        ([] : Array[Html]),
      ),
      section(
        id~,
        class="relative z-10 w-full \{width_class} overflow-hidden rounded-xl bg-paper shadow-2xl",
        attrs=@html.Attrs::build()
          .role("dialog")
          .aria_modal("true")
          .aria_labelledby(title_id),
        content,
      ),
    ],
  )
}

///|
fn picker_panel(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  match state.picker {
    None => div(([] : Array[Html]))
    Some(target) => {
      let entries = state.picker_entries()
      let items : Array[Html] = []
      for entry in entries {
        let detail = "\{credits_label(entry.credits)}単位 · \{schedule_label(entry.schedule)} · \{slots_label(entry.slots)}"
        let name_line : Array[Html] = [
          p(class="min-w-0 text-sm font-medium", entry.course_name),
        ]
        if entry.enrolled {
          name_line.push(
            span(class="shrink-0 text-xs text-muted", "登録済み"),
          )
        }
        let row_children : Array[Html] = [
          div(class="min-w-0 flex-1 py-2", [
            div(
              class="flex w-full items-baseline justify-between gap-2",
              name_line,
            ),
            p(class="mt-0.5 truncate text-xs text-muted", detail),
          ]),
        ]
        if !entry.enrolled {
          row_children.push(
            button(
              id="add-offering-\{entry.offering_id.value}",
              class="min-h-11 min-w-20 shrink-0 rounded-md px-2 text-sm font-medium text-primary-text hover:bg-primary-soft",
              on_click=emit(
                @app.PlannerMsg::AddOffering(offering_id=entry.offering_id),
              ),
              "追加",
            ),
          )
        }
        items.push(
          div(
            class="flex min-h-14 items-center justify-between gap-3 border-b border-rule px-4 last:border-b-0",
            row_children,
          ),
        )
      }
      if items.is_empty() {
        items.push(
          p(
            class="px-4 py-8 text-center text-sm text-muted",
            "該当する科目がありません",
          ),
        )
      }
      let body : Array[Html] = [
        div(class="border-b border-rule px-4 py-3", [
          label(for_="catalogue-search", class="sr-only", "科目名で検索"),
          input(
            id="catalogue-search",
            class="w-full rounded-lg bg-canvas px-3 py-2 text-sm outline-none placeholder:text-muted focus:ring-3 focus:ring-primary/30",
            placeholder="科目名で検索",
            value=state.catalogue_query,
            autofocus=true,
            on_input=fn(query) {
              emit(@app.PlannerMsg::UpdateCatalogueQuery(query~))
            },
          ),
        ]),
        div(class="max-h-[60vh] overflow-y-auto", items),
      ]
      modal_shell(
        id="picker",
        title_id="picker-title",
        close_id="close-picker",
        title=picker_label(target),
        width_class="max-w-md",
        close=emit(@app.PlannerMsg::ClosePicker),
        children=body,
      )
    }
  }
}

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
              let detail = "\{credits_label(course.credits)}単位 · \{schedule_label(offering.schedule())} · \{slots_label(offering.slots())}"
              let current = state.enrollment_status(offering_id)
              let body : Array[Html] = [
                div(class="px-4 py-4", [p(class="text-sm text-muted", detail)]),
                status_controls(offering_id, current, emit),
                div(class="flex justify-end border-t border-rule px-4 py-2", [
                  button(
                    id="remove-detail",
                    class="min-h-11 rounded-md px-3 text-sm text-danger-text hover:bg-danger/10",
                    on_click=emit(
                      @app.PlannerMsg::RemoveEnrollment(offering_id~),
                    ),
                    "履修から削除",
                  ),
                ]),
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
                title=course.name,
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
fn credit_total_view(state : @app.PlannerState) -> Html {
  match state.credit_totals() {
    Ok(totals) => {
      let confirmed = credits_label(totals.confirmed)
      let projected = credits_label(totals.projected)
      div(
        id="credit-total",
        class="flex shrink-0 items-baseline gap-1 whitespace-nowrap text-xs text-muted",
        [
          span(
            class="hidden whitespace-nowrap sm:inline",
            "合計 確定 \{confirmed} / 見込 \{projected}単位",
          ),
          span(class="whitespace-nowrap sm:hidden", "合計 \{projected}単位"),
        ],
      )
    }
    Err(_) =>
      div(
        id="credit-total",
        class="text-xs text-danger-text",
        "合計 単位を計算できません",
      )
  }
}

///|
fn half_units_label(half_units : Int) -> String {
  if half_units % 2 == 0 {
    "\{half_units / 2}"
  } else {
    "\{half_units / 2}.5"
  }
}

///|
fn custom_field_class(
  form : @app.CustomCourseDraft,
  field : @app.CustomCourseField,
  base : String,
) -> String {
  if form.error_field == Some(field) {
    "\{base} border-danger-text"
  } else {
    base
  }
}

///|
fn custom_form_panel(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  match state.custom_form {
    None => div(([] : Array[Html]))
    Some(form) => {
      let is_intensive = form.schedule == "intensive"
      let current_year = state.profile.advancement_year.year()
      let year_options : Array[Html] = []
      for offset in 0..<=2 {
        let year = current_year + offset
        let value = "\{year}"
        year_options.push(
          option(value~, selected=form.academic_year == value, "\{year}年度"),
        )
      }
      let credit_options : Array[Html] = []
      for half_units in 1..<=20 {
        let value = "\{half_units}"
        credit_options.push(
          option(
            value~,
            selected=form.credits == value,
            "\{half_units_label(half_units)}単位",
          ),
        )
      }
      let term_options : Array[Html] = []
      if is_intensive {
        let semesters = [("S", "S"), ("A", "A"), ("W", "W")]
        for entry in semesters {
          let (value, label) = entry
          term_options.push(option(value~, selected=form.term == value, label))
        }
      } else {
        let terms = [("S1", "S1"), ("S2", "S2"), ("A1", "A1"), ("A2", "A2")]
        for entry in terms {
          let (value, label) = entry
          term_options.push(option(value~, selected=form.term == value, label))
        }
      }
      let day_options : Array[Html] = []
      let days = ["月", "火", "水", "木", "金", "土", "日"]
      for index in 0..<=6 {
        let value = "\{index}"
        day_options.push(
          option(value~, selected=form.day == value, days[index]),
        )
      }
      let period_options : Array[Html] = []
      for period in 1..<=10 {
        let value = "\{period}"
        period_options.push(
          option(value~, selected=form.period == value, "\{period}限"),
        )
      }
      let body : Array[Html] = [
        div(class="space-y-3 px-4 py-3", [
          div([
            label(
              for_="custom-name",
              class="mb-1 block text-xs font-medium text-muted",
              "科目名",
            ),
            input(
              id="custom-name",
              class=custom_field_class(
                form,
                @app.CustomCourseField::Name,
                "w-full rounded-lg border border-rule bg-paper px-3 py-2 text-sm outline-none focus:border-primary",
              ),
              value=form.name,
              placeholder="例: 線形代数",
              on_input=fn(value) {
                emit(
                  @app.PlannerMsg::UpdateCustomCourseField(
                    field=@app.CustomCourseField::Name,
                    value~,
                  ),
                )
              },
            ),
          ]),
          div(class="grid grid-cols-2 gap-3", [
            div([
              label(
                for_="custom-credits",
                class="mb-1 block text-xs font-medium text-muted",
                "単位数",
              ),
              select(
                id="custom-credits",
                class=custom_field_class(
                  form,
                  @app.CustomCourseField::Credits,
                  "w-full rounded-lg border border-rule bg-paper px-2 py-2 text-sm",
                ),
                on_change=fn(value) {
                  emit(
                    @app.PlannerMsg::UpdateCustomCourseField(
                      field=@app.CustomCourseField::Credits,
                      value~,
                    ),
                  )
                },
                credit_options,
              ),
            ]),
            div([
              label(
                for_="custom-year",
                class="mb-1 block text-xs font-medium text-muted",
                "年度",
              ),
              select(
                id="custom-year",
                class=custom_field_class(
                  form,
                  @app.CustomCourseField::Year,
                  "w-full rounded-lg border border-rule bg-paper px-2 py-2 text-sm",
                ),
                on_change=fn(value) {
                  emit(
                    @app.PlannerMsg::UpdateCustomCourseField(
                      field=@app.CustomCourseField::Year,
                      value~,
                    ),
                  )
                },
                year_options,
              ),
            ]),
          ]),
          div([
            label(
              for_="custom-schedule",
              class="mb-1 block text-xs font-medium text-muted",
              "開講形態",
            ),
            select(
              id="custom-schedule",
              class=custom_field_class(
                form,
                @app.CustomCourseField::Schedule,
                "w-full rounded-lg border border-rule bg-paper px-2 py-2 text-sm",
              ),
              on_change=fn(value) {
                emit(
                  @app.PlannerMsg::UpdateCustomCourseField(
                    field=@app.CustomCourseField::Schedule,
                    value~,
                  ),
                )
              },
              [
                option(
                  value="regular",
                  selected=form.schedule == "regular",
                  "通常",
                ),
                option(
                  value="year-long",
                  selected=form.schedule == "year-long",
                  "通年",
                ),
                option(
                  value="intensive",
                  selected=form.schedule == "intensive",
                  "集中講義",
                ),
              ],
            ),
          ]),
          div([
            label(
              for_="custom-term",
              class="mb-1 block text-xs font-medium text-muted",
              if is_intensive {
                "セメスター"
              } else {
                "学期"
              },
            ),
            select(
              id="custom-term",
              class=custom_field_class(
                form,
                @app.CustomCourseField::Term,
                "w-full rounded-lg border border-rule bg-paper px-2 py-2 text-sm",
              ),
              on_change=fn(value) {
                emit(
                  @app.PlannerMsg::UpdateCustomCourseField(
                    field=@app.CustomCourseField::Term,
                    value~,
                  ),
                )
              },
              term_options,
            ),
          ]),
          if is_intensive {
            div(([] : Array[Html]))
          } else {
            div(class="grid grid-cols-2 gap-3", [
              div([
                label(
                  for_="custom-day",
                  class="mb-1 block text-xs font-medium text-muted",
                  "曜日",
                ),
                select(
                  id="custom-day",
                  class=custom_field_class(
                    form,
                    @app.CustomCourseField::Day,
                    "w-full rounded-lg border border-rule bg-paper px-2 py-2 text-sm",
                  ),
                  on_change=fn(value) {
                    emit(
                      @app.PlannerMsg::UpdateCustomCourseField(
                        field=@app.CustomCourseField::Day,
                        value~,
                      ),
                    )
                  },
                  day_options,
                ),
              ]),
              div([
                label(
                  for_="custom-period",
                  class="mb-1 block text-xs font-medium text-muted",
                  "時限",
                ),
                select(
                  id="custom-period",
                  class=custom_field_class(
                    form,
                    @app.CustomCourseField::Period,
                    "w-full rounded-lg border border-rule bg-paper px-2 py-2 text-sm",
                  ),
                  on_change=fn(value) {
                    emit(
                      @app.PlannerMsg::UpdateCustomCourseField(
                        field=@app.CustomCourseField::Period,
                        value~,
                      ),
                    )
                  },
                  period_options,
                ),
              ]),
            ])
          },
          if form.error_message.is_empty() {
            div(([] : Array[Html]))
          } else {
            p(
              id="custom-form-error",
              class="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger-text",
              form.error_message,
            )
          },
        ]),
        div(class="flex justify-end border-t border-rule px-4 py-2", [
          button(
            id="custom-submit",
            class="min-h-11 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90",
            on_click=emit(@app.PlannerMsg::SubmitCustomCourse),
            "作成",
          ),
        ]),
      ]
      modal_shell(
        id="custom-course",
        title_id="custom-course-title",
        close_id="close-custom-course",
        title="独自科目を作成",
        width_class="max-w-md",
        close=emit(@app.PlannerMsg::CloseCustomCourseForm),
        children=body,
      )
    }
  }
}

///|
fn planner_view(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  let grid = if state.selected_term == @app.PlannerTerm::W {
    p(
      class="mt-4 text-sm text-muted",
      "Wでは時間割のグリッドを使いません",
    )
  } else {
    timetable_grid(state, emit)
  }
  let content : Array[Html] = [
    header(
      class="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-rule bg-paper px-4",
      [
        div(class="flex min-w-0 items-baseline gap-3", [
          h2(
            class="w-9 shrink-0 text-[1.0625rem] font-semibold",
            state.selected_term.label(),
          ),
          span(
            id="term-context",
            class="hidden text-xs text-muted lg:inline",
            "\{state.profile.advancement_year.year()}年度 応用物理",
          ),
        ]),
        div(
          class="flex shrink-0 items-center gap-2 pl-2 sm:border-l sm:border-rule/60 sm:pl-3",
          [
            credit_total_view(state),
            range_controls(state, emit),
            button(
              id="open-catalogue-picker",
              class="flex min-h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-primary px-3 text-xs font-medium text-white hover:bg-primary/90",
              on_click=emit(@app.PlannerMsg::OpenCataloguePicker),
              [span("+"), span("科目")],
            ),
          ],
        ),
      ],
    ),
    div(class="flex min-h-0 flex-1 flex-col md:flex-row", [
      term_section(state, emit),
      main_(id="main-content", class="min-w-0 flex-1 p-4 md:p-5", [
        grid,
        off_grid(state, emit),
      ]),
    ]),
  ]
  match state.error {
    Some(error) =>
      content.push(
        p(
          id="planner-error",
          class="mx-4 mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger-text",
          error.message,
        ),
      )
    None => ()
  }
  div(class="min-h-screen bg-canvas p-0 md:p-6", [
    a(
      href="#main-content",
      class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-paper focus:px-3 focus:py-2",
      "時間割へスキップ",
    ),
    div(
      class="mx-auto flex min-h-screen max-w-6xl flex-col overflow-hidden bg-paper md:min-h-[calc(100vh-3rem)] md:rounded-xl md:border md:border-rule md:shadow-[0_16px_48px_rgba(0,0,0,0.10)]",
      content,
    ),
    picker_panel(state, emit),
    course_detail(state, emit),
    custom_form_panel(state, emit),
  ])
}

///|
fn app() -> Val[Html] {
  let (state, emit) = @rabbita.create_pure_state(
    @app.sample_state(),
    update=@app.update_planner,
  )
  state.view(state => planner_view(state, emit))
}

///|
fn main {
  @rabbita.new(app).mount("app")
}
