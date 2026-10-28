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
  h3,
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
  span(
    class="shrink-0 whitespace-nowrap text-[0.6875rem] font-medium \{class_name}",
    label,
  )
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
fn program_label(value : String) -> String {
  match value {
    "applied-physics" => "応用物理"
    "applied-chemistry" => "応用化学"
    _ => value
  }
}

///|
fn profile_controls(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  let program_options : Array[Html] = []
  for program in state.program_ids() {
    let value = program.value
    program_options.push(
      option(
        value~,
        selected=state.profile.program_id == program,
        program_label(value),
      ),
    )
  }
  let year_options : Array[Html] = []
  for year in state.advancement_years(state.profile.program_id) {
    let value = "\{year.year()}"
    year_options.push(
      option(
        value~,
        selected=state.profile.advancement_year == year,
        "\{year.year()}年度",
      ),
    )
  }
  div(
    attrs=@html.Attrs::build()
      .role("group")
      .aria_label("要件プロファイル"),
    class="space-y-2",
    [
      div([
        label(
          for_="program-select",
          class="mb-1 block text-xs text-muted",
          "プログラム",
        ),
        select(
          id="program-select",
          class="min-h-9 w-full rounded-md border border-rule bg-paper px-2 text-sm",
          on_change=fn(value) {
            emit(@app.PlannerMsg::SelectProgram(program_id=value))
          },
          program_options,
        ),
      ]),
      div([
        label(
          for_="year-select",
          class="mb-1 block text-xs text-muted",
          "進級年度",
        ),
        select(
          id="year-select",
          class="min-h-9 w-full rounded-md border border-rule bg-paper px-2 text-sm",
          on_change=fn(value) {
            emit(@app.PlannerMsg::SelectAdvancementYear(year=value))
          },
          year_options,
        ),
      ]),
    ],
  )
}

///|
fn timetable_year_panel(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  let grade_options : Array[Html] = []
  for year in state.timetable_years() {
    let value = "\{year.grade}"
    grade_options.push(
      option(
        value~,
        selected=state.timetable_year.grade == year.grade,
        "\{year.grade}年（\{year.academic_year.year()}年度）",
      ),
    )
  }
  div(
    attrs=@html.Attrs::build()
      .role("group")
      .aria_label("時間割の表示対象"),
    class="space-y-2",
    [
      p(class="text-xs font-semibold text-muted", "時間割"),
      div([
        label(
          for_="grade-select",
          class="mb-1 block text-xs text-muted",
          "学年",
        ),
        select(
          id="grade-select",
          class="min-h-9 w-full rounded-md border border-rule bg-paper px-2 text-sm",
          on_change=fn(value) {
            emit(@app.PlannerMsg::SelectGrade(grade=value))
          },
          grade_options,
        ),
      ]),
    ],
  )
}

///|
fn term_section(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  let tabs : Array[Html] = []
  for term in @app.PlannerTerm::display_values() {
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
    class="flex w-full shrink-0 flex-col gap-3 border-b border-rule bg-canvas p-3 md:w-56 md:rounded-bl-xl md:border-b-0 md:border-r",
    [
      div(class="flex items-center gap-2 px-2 pt-1", [
        app_mark(),
        h1(class="text-sm font-semibold", "応物単位くん"),
      ]),
      timetable_year_panel(state, emit),
      nav(class="grid grid-cols-5 gap-1 md:flex md:flex-col md:gap-0.5", tabs),
    ],
  )
}

///|
fn override_field_class(
  form : @app.OverrideDraft,
  field : @app.OverrideField,
  base : String,
) -> String {
  if form.error_field == Some(field) {
    "\{base} border-danger-text"
  } else {
    base
  }
}

///|
fn override_field_attrs(
  form : @app.OverrideDraft,
  field : @app.OverrideField,
) -> @html.Attrs {
  if form.error_field == Some(field) {
    @html.Attrs::build()
    .aria_invalid("true")
    .aria_describedby("override-form-error")
  } else {
    @html.Attrs::build()
  }
}

///|
fn override_form_panel(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  match state.override_form {
    None => div(([] : Array[Html]))
    Some(form) => {
      let credit_options : Array[Html] = [
        option(value="", selected=form.credits.is_empty(), "元の単位数"),
      ]
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
      let day_options : Array[Html] = []
      let day_values = [
        @tanikun-domain.DayOfWeek::Monday,
        @tanikun-domain.DayOfWeek::Tuesday,
        @tanikun-domain.DayOfWeek::Wednesday,
        @tanikun-domain.DayOfWeek::Thursday,
        @tanikun-domain.DayOfWeek::Friday,
        @tanikun-domain.DayOfWeek::Saturday,
        @tanikun-domain.DayOfWeek::Sunday,
      ]
      for day in day_values {
        let value = "\{day_index(day)}"
        day_options.push(
          option(value~, selected=form.day == day, day_label(day)),
        )
      }
      let period_options : Array[Html] = []
      for period in 1..<=10 {
        let value = "\{period}"
        period_options.push(
          option(value~, selected=form.period.value() == period, "\{period}限"),
        )
      }
      let slots_class = if form.slots_enabled {
        "min-h-11 rounded-md bg-primary px-3 text-sm font-medium text-white"
      } else {
        "min-h-11 rounded-md bg-canvas px-3 text-sm text-ink hover:bg-rule/40"
      }
      let body : Array[Html] = [
        div(class="max-h-[70vh] space-y-4 overflow-y-auto px-4 py-4", [
          div([
            label(
              for_="override-name",
              class="mb-1 block text-xs font-medium text-muted",
              "表示名",
            ),
            input(
              id="override-name",
              class=override_field_class(
                form,
                @app.OverrideField::Name,
                "w-full rounded-lg border border-rule bg-paper px-3 py-2 text-sm outline-none focus:border-primary",
              ),
              attrs=override_field_attrs(form, @app.OverrideField::Name),
              value=form.name,
              placeholder="空欄なら元の名前",
              on_input=fn(value) {
                emit(
                  @app.PlannerMsg::UpdateOverrideField(
                    field=@app.OverrideField::Name,
                    value~,
                  ),
                )
              },
            ),
          ]),
          div([
            label(
              for_="override-credits",
              class="mb-1 block text-xs font-medium text-muted",
              "単位数",
            ),
            select(
              id="override-credits",
              class=override_field_class(
                form,
                @app.OverrideField::Credits,
                "w-full rounded-lg border border-rule bg-paper px-2 py-2 text-sm",
              ),
              attrs=override_field_attrs(form, @app.OverrideField::Credits),
              on_change=fn(value) {
                emit(
                  @app.PlannerMsg::UpdateOverrideField(
                    field=@app.OverrideField::Credits,
                    value~,
                  ),
                )
              },
              credit_options,
            ),
          ]),
          if form.supports_slots {
            div([
              p(class="mb-2 text-sm font-medium", "曜限"),
              button(
                id="override-slots-enabled",
                class=slots_class,
                attrs=@html.Attrs::build().aria_pressed(
                  if form.slots_enabled {
                    "true"
                  } else {
                    "false"
                  },
                ),
                on_click=emit(@app.PlannerMsg::ToggleOverrideSlots),
                if form.slots_enabled {
                  "曜限を上書きしない"
                } else {
                  "曜限を上書き"
                },
              ),
              if form.slots_enabled {
                div(
                  class="mt-2 grid grid-cols-2 gap-2",
                  attrs=override_field_attrs(form, @app.OverrideField::Slots),
                  [
                    label(for_="override-day", class="sr-only", "曜日"),
                    select(
                      id="override-day",
                      attrs=override_field_attrs(
                        form,
                        @app.OverrideField::Slots,
                      ),
                      class=override_field_class(
                        form,
                        @app.OverrideField::Slots,
                        "w-full rounded-lg border border-rule bg-paper px-2 py-2 text-sm",
                      ),
                      on_change=fn(value) {
                        emit(@app.PlannerMsg::UpdateOverrideDay(value~))
                      },
                      day_options,
                    ),
                    label(for_="override-period", class="sr-only", "時限"),
                    select(
                      id="override-period",
                      attrs=override_field_attrs(
                        form,
                        @app.OverrideField::Slots,
                      ),
                      class=override_field_class(
                        form,
                        @app.OverrideField::Slots,
                        "w-full rounded-lg border border-rule bg-paper px-2 py-2 text-sm",
                      ),
                      on_change=fn(value) {
                        emit(@app.PlannerMsg::UpdateOverridePeriod(value~))
                      },
                      period_options,
                    ),
                  ],
                )
              } else {
                div(([] : Array[Html]))
              },
            ])
          } else {
            p(
              class="text-xs text-muted",
              "集中講義では曜限を変更できません",
            )
          },
          if state.enrollment_is_passed(form.offering_id) {
            p(
              id="override-passed-note",
              class="rounded-md bg-primary-soft px-3 py-2 text-xs text-primary-text",
              "合格済みのため、この上書きは時間割とカタログの合格時表示には反映されません。",
            )
          } else {
            div(([] : Array[Html]))
          },
          if !form.error_message.is_empty() {
            p(
              id="override-form-error",
              class="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger-text",
              attrs=@html.Attrs::build().role("alert"),
              form.error_message,
            )
          } else {
            div(([] : Array[Html]))
          },
        ]),
        div(
          class="flex items-center justify-between border-t border-rule px-4 py-2",
          [
            button(
              id="remove-overrides",
              class="min-h-11 rounded-md px-2 text-sm text-danger-text hover:bg-danger/10",
              on_click=emit(@app.PlannerMsg::RemoveAllOverrides),
              "すべての上書きを解除",
            ),
            button(
              id="override-submit",
              class="min-h-11 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90",
              on_click=emit(@app.PlannerMsg::SubmitOverride),
              "保存",
            ),
          ],
        ),
      ]
      modal_shell(
        id="override-editor",
        title_id="override-title",
        close_id="close-override-editor",
        title="表示をカスタマイズ",
        width_class="max-w-md",
        close=emit(@app.PlannerMsg::CloseOverrideEditor),
        children=body,
      )
    }
  }
}

///|
fn settings_panel(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  if !state.settings_open {
    return div(([] : Array[Html]))
  }
  let body : Array[Html] = [
    div(class="space-y-4 px-4 py-4", [
      h3(class="text-sm font-semibold", "時間割の表示"),
      div([
        p(
          id="days-label",
          class="mb-2 text-sm font-medium",
          "表示する曜日",
        ),
        div(
          attrs=@html.Attrs::build().role("group").aria_labelledby("days-label"),
          class="flex items-center gap-2",
          [
            button(
              id="remove-day",
              title="表示する曜日を減らす",
              attrs=@html.Attrs::build().aria_label(
                "表示する曜日を減らす",
              ),
              class="flex h-11 w-11 items-center justify-center rounded-md border border-rule text-muted hover:bg-canvas disabled:opacity-30",
              disabled=state.visible_days <= 5,
              on_click=emit(@app.PlannerMsg::DecreaseVisibleDays),
              "-",
            ),
            span(
              class="min-w-12 text-center text-sm",
              "\{state.visible_days}日",
            ),
            button(
              id="add-day",
              title="表示する曜日を増やす",
              attrs=@html.Attrs::build().aria_label(
                "表示する曜日を増やす",
              ),
              class="flex h-11 w-11 items-center justify-center rounded-md border border-rule text-muted hover:bg-canvas disabled:opacity-30",
              disabled=state.visible_days >= 7,
              on_click=emit(@app.PlannerMsg::IncreaseVisibleDays),
              "+",
            ),
          ],
        ),
      ]),
      div([
        p(
          id="periods-label",
          class="mb-2 text-sm font-medium",
          "表示する時限",
        ),
        div(
          attrs=@html.Attrs::build()
            .role("group")
            .aria_labelledby("periods-label"),
          class="flex items-center gap-2",
          [
            button(
              id="remove-period",
              title="表示する時限を減らす",
              attrs=@html.Attrs::build().aria_label(
                "表示する時限を減らす",
              ),
              class="flex h-11 w-11 items-center justify-center rounded-md border border-rule text-muted hover:bg-canvas disabled:opacity-30",
              disabled=state.visible_periods <= 6,
              on_click=emit(@app.PlannerMsg::DecreaseVisiblePeriods),
              "-",
            ),
            span(
              class="min-w-12 text-center text-sm",
              "\{state.visible_periods}限",
            ),
            button(
              id="add-period",
              title="表示する時限を増やす",
              attrs=@html.Attrs::build().aria_label(
                "表示する時限を増やす",
              ),
              class="flex h-11 w-11 items-center justify-center rounded-md border border-rule text-muted hover:bg-canvas disabled:opacity-30",
              disabled=state.visible_periods >= 10,
              on_click=emit(@app.PlannerMsg::IncreaseVisiblePeriods),
              "+",
            ),
          ],
        ),
      ]),
      h3(
        class="border-t border-rule/60 pt-4 text-sm font-semibold",
        "プロファイル",
      ),
      profile_controls(state, emit),
    ]),
  ]
  modal_shell(
    id="settings",
    title_id="settings-title",
    close_id="close-settings",
    title="設定",
    width_class="max-w-sm",
    close=emit(@app.PlannerMsg::CloseSettings),
    children=body,
  )
}

///|
fn timetable_grid(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
  categories : @app.CategoryNames,
) -> Html {
  let blocks = state.scheduled_blocks_with(state.selected_term, categories)
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
                  div(
                    class="flex flex-col items-start sm:flex-row sm:items-end sm:justify-between sm:gap-1",
                    [
                      span(
                        class="sr-only truncate text-[0.625rem] leading-tight text-muted sm:not-sr-only",
                        "\{credits_label(block.credits)}単位 · \{block.category_name}",
                      ),
                      enrollment_status_badge(block.status),
                    ],
                  ),
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
  let mobile_blocks : Array[Html] = []
  for block in blocks {
    if state.is_visible_slot(block.day, block.period) {
      mobile_blocks.push(
        button(
          id="mobile-detail-\{block.offering_id.value}-\{day_label(block.day)}-\{block.period.value()}",
          class="flex min-h-11 w-full items-center justify-between gap-2 rounded-md bg-primary-soft px-3 py-2 text-left text-sm",
          on_click=emit(
            @app.PlannerMsg::SelectOffering(offering_id=block.offering_id),
          ),
          [
            span(
              "\{day_label(block.day)}\{block.period.value()}限 · \{block.course_name}",
            ),
            enrollment_status_badge(block.status),
          ],
        ),
      )
    }
  }
  let children : Array[Html] = [
    p(
      class="mt-4 text-xs text-muted",
      "空き時間を選んで科目を追加できます。",
    ),
    div(
      id="timetable-scroll",
      class="mt-2 overflow-visible rounded-lg border border-rule bg-paper",
      [
        table(
          id="timetable",
          class="w-full table-fixed border-separate border-spacing-x-1 border-spacing-y-0 text-sm sm:border-spacing-x-2",
          [thead(header), tbody(rows)],
        ),
      ],
    ),
    if mobile_blocks.is_empty() {
      div(([] : Array[Html]))
    } else {
      div(class="mt-3 space-y-1 sm:hidden", mobile_blocks)
    },
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
fn off_grid_item(
  entry : @app.OffGridEntry,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  button(
    id="open-detail-\{entry.offering_id.value}",
    class="flex min-h-12 w-full items-start justify-start rounded-lg bg-primary-soft px-3 py-2 text-left hover:bg-primary-soft/80",
    on_click=emit(
      @app.PlannerMsg::SelectOffering(offering_id=entry.offering_id),
    ),
    [
      div(class="min-w-0", [
        p(class="truncate text-sm font-medium text-ink", entry.course_name),
        div(
          class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted",
          [
            span("\{credits_label(entry.credits)}単位"),
            span(entry.category_name),
            enrollment_status_badge(entry.status),
          ],
        ),
      ]),
    ],
  )
}

///|
fn off_grid(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
  categories : @app.CategoryNames,
) -> Html {
  let entries = state.off_grid_entries_with(state.selected_term, categories)
  let regular_items : Array[Html] = []
  let winter_items : Array[Html] = []
  for entry in entries {
    if entry.winter {
      winter_items.push(off_grid_item(entry, emit))
    } else {
      regular_items.push(off_grid_item(entry, emit))
    }
  }
  if regular_items.is_empty() {
    regular_items.push(
      p(class="px-3 py-4 text-sm text-muted", "集中講義はありません"),
    )
  }
  let winter_block : Array[Html] = []
  if state.selected_term is (@app.PlannerTerm::A1 | @app.PlannerTerm::A2) {
    let items = if winter_items.is_empty() {
      [
        p(
          class="px-3 py-4 text-sm text-muted",
          "Wの集中講義はありません",
        ),
      ]
    } else {
      winter_items
    }
    winter_block.push(h3(class="mt-4 text-sm font-semibold", "W（冬期）"))
    winter_block.push(div(class="mt-2 flex flex-col gap-2", items))
  }
  let body : Array[Html] = [div(class="flex flex-col gap-2", regular_items)]
  for item in winter_block {
    body.push(item)
  }
  section(
    id="off-grid",
    class="mt-5",
    [
      div(class="mb-2 flex items-center justify-between", [
        h2(class="text-sm font-semibold", "集中講義"),
        button(
          id="open-intensive-picker",
          class="min-h-8 rounded-md px-2 text-xs text-primary-text hover:bg-primary-soft",
          on_click=emit(@app.PlannerMsg::OpenIntensivePicker),
          "追加",
        ),
      ]),
    ] +
    body,
  )
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
        class="relative z-10 max-h-[calc(100vh-2rem)] w-full overflow-y-auto rounded-xl bg-paper shadow-2xl \{width_class}",
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
  categories : @app.CategoryNames,
) -> Html {
  match state.picker {
    None => div(([] : Array[Html]))
    Some(target) => {
      let entries = state.picker_entries_with(categories)
      let items : Array[Html] = []
      for entry in entries {
        let detail = "\{credits_label(entry.credits)}単位 · 区分 \{entry.category_name} · \{schedule_label(entry.schedule)} · \{slots_label(entry.slots)}"
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
        let row_actions : Array[Html] = []
        if entry.custom {
          row_actions.push(
            button(
              id="edit-custom-\{entry.offering_id.value}",
              class="min-h-11 rounded-md px-2 text-sm text-muted hover:bg-canvas",
              on_click=emit(
                @app.PlannerMsg::OpenEditCustomCourse(
                  offering_id=entry.offering_id,
                ),
              ),
              "編集",
            ),
          )
        }
        if !entry.enrolled {
          row_actions.push(
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
        for action in row_actions {
          row_children.push(action)
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
        div(class="border-t border-rule px-4 py-2", [
          button(
            id="open-custom-course",
            class="min-h-9 rounded-md px-2 text-sm text-primary-text hover:bg-primary-soft",
            on_click=emit(@app.PlannerMsg::OpenCustomCourseForm),
            "独自科目を作成",
          ),
        ]),
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
fn summary_total_card(
  id : String,
  label : String,
  credits : @tanikun-domain.Credits,
) -> Html {
  div(class="rounded-md bg-canvas px-3 py-2", [
    p(class="text-xs text-muted", label),
    p(id~, class="text-lg font-semibold", "\{credits_label(credits)}単位"),
  ])
}

///|
fn requirement_segment_values(
  node : @app.RequirementNode,
) -> (Int, Int, Int, Int) {
  let total = if node.optimistic.total > 0 { node.optimistic.total } else { 1 }
  let confirmed = if node.confirmed.done < 0 {
    0
  } else if node.confirmed.done > total {
    total
  } else {
    node.confirmed.done
  }
  let standard = if node.standard.done < confirmed {
    confirmed
  } else if node.standard.done > total {
    total
  } else {
    node.standard.done
  }
  let optimistic = if node.optimistic.done < standard {
    standard
  } else if node.optimistic.done > total {
    total
  } else {
    node.optimistic.done
  }
  (total, confirmed, standard, optimistic)
}

///|
fn requirement_stacked_bar(node : @app.RequirementNode) -> Html {
  let (total, confirmed, standard, optimistic) = requirement_segment_values(
    node,
  )
  let confirmed_width = confirmed * 100 / total
  let standard_width = (standard - confirmed) * 100 / total
  let optimistic_width = if optimistic == total {
    100 - confirmed_width - standard_width
  } else {
    (optimistic - standard) * 100 / total
  }
  let unit = node.confirmed.unit
  let confirmed_done = requirement_amount(node.confirmed.done, unit)
  let confirmed_total = requirement_amount(node.confirmed.total, unit)
  let standard_done = requirement_amount(node.standard.done, unit)
  let standard_total = requirement_amount(node.standard.total, unit)
  let optimistic_done = requirement_amount(node.optimistic.done, unit)
  let optimistic_total = requirement_amount(node.optimistic.total, unit)
  let label = "\{node.label}: 修得済 \{confirmed_done}/\{confirmed_total}\{unit}, 履修中込 \{standard_done}/\{standard_total}\{unit}, 履修予定込 \{optimistic_done}/\{optimistic_total}\{unit}"
  div(
    class="flex h-2 w-full overflow-hidden rounded-full bg-rule",
    attrs=@html.Attrs::build()
      .role("img")
      .aria_label(label)
      .data_set("requirement-bar", "true"),
    [
      div(
        style=["width: \{confirmed_width}%"],
        class="h-full bg-primary",
        ([] : Array[Html]),
      ),
      div(
        style=["width: \{standard_width}%"],
        class="h-full bg-primary/55",
        ([] : Array[Html]),
      ),
      div(
        style=["width: \{optimistic_width}%"],
        class="h-full bg-primary/25",
        ([] : Array[Html]),
      ),
    ],
  )
}

///|
fn requirement_amount(amount : Int, unit : String) -> String {
  if unit == "単位" {
    half_units_label(amount)
  } else {
    "\{amount}"
  }
}

///|
fn requirement_segment_chip(
  label : String,
  amount : Int,
  unit : String,
  color_class : String,
) -> Html {
  div(class="flex items-center gap-1 text-xs text-muted", [
    span(
      class="inline-block h-2 w-2 shrink-0 rounded-sm \{color_class}",
      ([] : Array[Html]),
    ),
    span("\{label} \{requirement_amount(amount, unit)}\{unit}"),
  ])
}

///|
fn requirement_segment_legend(node : @app.RequirementNode) -> Html {
  let (_, confirmed, standard, optimistic) = requirement_segment_values(node)
  div(class="flex flex-wrap gap-x-3 gap-y-1", [
    requirement_segment_chip(
      "合格済",
      confirmed,
      node.confirmed.unit,
      "bg-primary",
    ),
    requirement_segment_chip(
      "履修中",
      standard - confirmed,
      node.standard.unit,
      "bg-primary/55",
    ),
    requirement_segment_chip(
      "履修予定",
      optimistic - standard,
      node.optimistic.unit,
      "bg-primary/25",
    ),
  ])
}

///|
fn requirement_status_class(status : String) -> String {
  if status == "達成" {
    "text-success-text"
  } else if status == "不足" {
    "text-muted"
  } else {
    "text-primary-text"
  }
}

///|
fn summary_mode_info(label : String, mode : @app.RequirementMode) -> Html {
  div(
    class="grid grid-cols-[minmax(0,1.1fr)_7.5rem_minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-2 text-xs",
    [
      span(class="font-medium text-muted", label),
      span(
        class="font-medium \{requirement_status_class(mode.status_label())}",
        mode.status_label(),
      ),
      span(class="text-left text-muted", mode.progress),
      if mode.remaining.is_empty() {
        span(([] : Array[Html]))
      } else {
        span(class="text-right text-muted", mode.remaining)
      },
    ],
  )
}

///|
fn requirement_tree_node(node : @app.RequirementNode) -> Html {
  let children : Array[Html] = []
  for child in node.children {
    children.push(requirement_tree_node(child))
  }
  div(class="space-y-2 border-l border-rule/60 pl-3", [
    p(class="text-sm font-medium", node.label),
    requirement_stacked_bar(node),
    requirement_segment_legend(node),
    div(class="space-y-1", [
      summary_mode_info("修得済", node.confirmed),
      summary_mode_info("履修中込", node.standard),
      summary_mode_info("履修予定込", node.optimistic),
    ]),
    if children.is_empty() {
      div(([] : Array[Html]))
    } else {
      div(class="space-y-2", children)
    },
  ])
}

///|
fn summary_panel(
  summary : Result[@app.PlannerSummary, @tanikun-domain.DomainError],
) -> Html {
  match summary {
    Err(error) => {
      let message = match error {
        @tanikun-domain.DomainError::ProfileRequirementSetMismatch =>
          "要件: 要件セットが見つかりません"
        _ => "要件: 要件を評価できません"
      }
      div(
        id="summary",
        class="mt-6 rounded-lg border border-rule bg-paper p-4",
        [
          h2(class="text-sm font-semibold", "累計単位・要件"),
          p(
            id="requirement-summary",
            class="text-xs text-danger-text",
            attrs=@html.Attrs::build().role("status"),
            message,
          ),
          p(
            id="summary-error",
            class="mt-2 text-sm text-danger-text",
            attrs=@html.Attrs::build().role("status"),
            "単位・要件を計算できません",
          ),
        ],
      )
    }
    Ok(summary) => {
      let category_rows : Array[Html] = []
      for category in summary.categories {
        category_rows.push(
          tr(class="border-t border-rule/60", [
            td(class="py-1 pr-2 text-sm", category.name),
            td(
              class="py-1 px-2 text-right text-sm",
              credits_label(category.confirmed),
            ),
            td(
              class="py-1 px-2 text-right text-sm",
              credits_label(category.standard),
            ),
            td(
              class="py-1 pl-2 text-right text-sm",
              credits_label(category.optimistic),
            ),
          ]),
        )
      }
      div(
        id="summary",
        class="mt-6 rounded-lg border border-rule bg-paper p-4",
        [
          div(class="flex items-baseline justify-between gap-2", [
            h2(class="text-sm font-semibold", "単位・要件"),
            p(
              id="requirement-summary",
              class="text-xs text-muted",
              attrs=@html.Attrs::build().role("status"),
              "要件（履修予定込）: \{summary.requirement_root.optimistic.status_label()}",
            ),
          ]),
          div(class="mt-2 grid grid-cols-3 gap-2", [
            summary_total_card(
              "summary-total-confirmed",
              "修得済",
              summary.confirmed,
            ),
            summary_total_card(
              "summary-total-standard",
              "履修中込",
              summary.standard,
            ),
            summary_total_card(
              "summary-total-optimistic",
              "履修予定込",
              summary.optimistic,
            ),
          ]),
          p(
            id="summary-note",
            class="mt-2 text-xs text-muted",
            "各段階はそれ以前の単位を含む累計です。履修中・履修予定は合格した場合の試算です。",
          ),
          if category_rows.is_empty() {
            p(class="mt-4 text-xs text-muted", "区分はありません")
          } else {
            table(
              id="summary-categories",
              class="mt-4 w-full table-fixed text-sm",
              [
                thead([
                  tr([
                    th(
                      scope=@html.Scope::Col,
                      class="pb-1 text-left text-xs text-muted",
                      "区分",
                    ),
                    th(
                      scope=@html.Scope::Col,
                      class="pb-1 px-2 text-right text-xs text-muted",
                      "修得済",
                    ),
                    th(
                      scope=@html.Scope::Col,
                      class="pb-1 px-2 text-right text-xs text-muted",
                      "履修中込",
                    ),
                    th(
                      scope=@html.Scope::Col,
                      class="pb-1 pl-2 text-right text-xs text-muted",
                      "履修予定込",
                    ),
                  ]),
                ]),
                tbody(category_rows),
              ],
            )
          },
          h3(class="mt-4 text-xs font-semibold text-muted", "要件の状況"),
          p(
            class="mt-1 text-xs text-muted",
            "バーと凡例は必要数までの内訳です。",
          ),
          div(id="summary-requirements", class="mt-2", [
            requirement_tree_node(summary.requirement_root),
          ]),
        ],
      )
    }
  }
}

///|
fn credit_total_view(
  summary : Result[@app.PlannerSummary, @tanikun-domain.DomainError],
) -> Html {
  match summary {
    Ok(value) => {
      let confirmed = credits_label(value.confirmed)
      let projected = credits_label(value.optimistic)
      div(
        id="credit-total",
        class="flex shrink-0 items-baseline gap-1 whitespace-nowrap text-xs text-muted",
        [
          span(
            class="hidden whitespace-nowrap sm:inline",
            "合計 修得済 \{confirmed} ・ 履修予定込 \{projected}単位",
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
fn has_planner_term(
  terms : Array[@app.PlannerTerm],
  term : @app.PlannerTerm,
) -> Bool {
  for item in terms {
    if item == term {
      return true
    }
  }
  false
}

///|
fn term_toggle_button(
  id : String,
  label : String,
  active : Bool,
  term : @app.PlannerTerm,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  let class_name = if active {
    "min-h-9 rounded-md bg-primary px-3 text-sm font-medium text-white"
  } else {
    "min-h-9 rounded-md bg-canvas px-3 text-sm text-ink hover:bg-rule/40"
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
    on_click=emit(@app.PlannerMsg::ToggleCustomTerm(term~)),
    label,
  )
}

///|
fn custom_field_attrs(
  form : @app.CustomCourseDraft,
  field : @app.CustomCourseField,
) -> @html.Attrs {
  if form.error_field == Some(field) {
    @html.Attrs::build()
    .aria_invalid("true")
    .aria_describedby("custom-form-error")
  } else {
    @html.Attrs::build()
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
      let is_intensive = form.schedule == @app.CustomCourseSchedule::Intensive
      let is_regular = form.schedule == @app.CustomCourseSchedule::Regular
      let editing = form.editing_course_id is Some(_)
      let year_options : Array[Html] = []
      let mut form_year_present = false
      for year in state.timetable_years() {
        let value = "\{year.academic_year.year()}"
        if form.academic_year == value {
          form_year_present = true
        }
        year_options.push(
          option(
            value~,
            selected=form.academic_year == value,
            "\{year.academic_year.year()}年度",
          ),
        )
      }
      if !form_year_present {
        year_options.push(
          option(
            value=form.academic_year,
            selected=true,
            "\{form.academic_year}年度",
          ),
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
      let category_options : Array[Html] = [
        option(value="", selected=form.category.is_empty(), "未分類"),
      ]
      match state.active_requirement_set() {
        Some(set) =>
          for category in set.categories() {
            category_options.push(
              option(
                value=category.id.value,
                selected=form.category == category.id.value,
                category.name,
              ),
            )
          }
        None => ()
      }
      let term_options : Array[Html] = []
      if is_intensive {
        let semesters = [("S", "S"), ("A", "A"), ("W", "W")]
        for entry in semesters {
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
      let schedule_regular = form.schedule == @app.CustomCourseSchedule::Regular
      let schedule_year_long = form.schedule ==
        @app.CustomCourseSchedule::YearLong
      let schedule_intensive = form.schedule ==
        @app.CustomCourseSchedule::Intensive
      let term_control : Html = if is_regular {
        div([
          p(class="mb-1 text-xs font-medium text-muted", "学期"),
          div(
            attrs=custom_field_attrs(form, @app.CustomCourseField::Term),
            class="flex flex-wrap gap-1",
            [
              term_toggle_button(
                "custom-term-s1",
                "S1",
                has_planner_term(form.terms, @app.PlannerTerm::S1),
                @app.PlannerTerm::S1,
                emit,
              ),
              term_toggle_button(
                "custom-term-s2",
                "S2",
                has_planner_term(form.terms, @app.PlannerTerm::S2),
                @app.PlannerTerm::S2,
                emit,
              ),
              term_toggle_button(
                "custom-term-a1",
                "A1",
                has_planner_term(form.terms, @app.PlannerTerm::A1),
                @app.PlannerTerm::A1,
                emit,
              ),
              term_toggle_button(
                "custom-term-a2",
                "A2",
                has_planner_term(form.terms, @app.PlannerTerm::A2),
                @app.PlannerTerm::A2,
                emit,
              ),
            ],
          ),
        ])
      } else if is_intensive {
        div([
          label(
            for_="custom-term",
            class="mb-1 block text-xs font-medium text-muted",
            "セメスター",
          ),
          select(
            id="custom-term",
            class=custom_field_class(
              form,
              @app.CustomCourseField::Term,
              "w-full rounded-lg border border-rule bg-paper px-2 py-2 text-sm",
            ),
            attrs=custom_field_attrs(form, @app.CustomCourseField::Term),
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
        ])
      } else {
        div(([] : Array[Html]))
      }
      let body : Array[Html] = [
        div(class="max-h-[70vh] space-y-3 overflow-y-auto px-4 py-3", [
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
              attrs=custom_field_attrs(form, @app.CustomCourseField::Name),
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
                attrs=custom_field_attrs(form, @app.CustomCourseField::Credits),
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
                attrs=custom_field_attrs(form, @app.CustomCourseField::Year),
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
              for_="custom-category",
              class="mb-1 block text-xs font-medium text-muted",
              "区分",
            ),
            select(
              id="custom-category",
              class=custom_field_class(
                form,
                @app.CustomCourseField::Category,
                "w-full rounded-lg border border-rule bg-paper px-2 py-2 text-sm",
              ),
              attrs=custom_field_attrs(form, @app.CustomCourseField::Category),
              on_change=fn(value) {
                emit(
                  @app.PlannerMsg::UpdateCustomCourseField(
                    field=@app.CustomCourseField::Category,
                    value~,
                  ),
                )
              },
              category_options,
            ),
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
              attrs=custom_field_attrs(form, @app.CustomCourseField::Schedule),
              on_change=fn(value) {
                emit(
                  @app.PlannerMsg::UpdateCustomCourseField(
                    field=@app.CustomCourseField::Schedule,
                    value~,
                  ),
                )
              },
              [
                option(value="regular", selected=schedule_regular, "通常"),
                option(value="year-long", selected=schedule_year_long, "通年"),
                option(
                  value="intensive",
                  selected=schedule_intensive,
                  "集中講義",
                ),
              ],
            ),
          ]),
          term_control,
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
                  attrs=custom_field_attrs(form, @app.CustomCourseField::Day),
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
                  attrs=custom_field_attrs(form, @app.CustomCourseField::Period),
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
          if !form.error_message.is_empty() {
            p(
              id="custom-form-error",
              class="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger-text",
              attrs=@html.Attrs::build().role("alert"),
              form.error_message,
            )
          } else {
            match state.error {
              Some(error) =>
                p(
                  id="custom-form-error",
                  class="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger-text",
                  attrs=@html.Attrs::build().role("alert"),
                  error.message,
                )
              None => div(([] : Array[Html]))
            }
          },
        ]),
        div(
          class="flex items-center justify-end gap-1 border-t border-rule px-4 py-2",
          [
            if editing {
              match form.editing_course_id {
                Some(course_id) =>
                  button(
                    id="delete-custom-course",
                    class="min-h-11 rounded-md px-2 text-sm text-danger-text hover:bg-danger/10",
                    on_click=emit(
                      @app.PlannerMsg::DeleteCustomCourse(course_id~),
                    ),
                    "削除",
                  )
                None => div(([] : Array[Html]))
              }
            } else {
              div(([] : Array[Html]))
            },
            button(
              id="custom-submit",
              class="min-h-11 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90",
              on_click=emit(@app.PlannerMsg::SubmitCustomCourse),
              if editing {
                "保存"
              } else {
                "作成"
              },
            ),
          ],
        ),
      ]
      modal_shell(
        id="custom-course",
        title_id="custom-course-title",
        close_id="close-custom-course",
        title=if editing {
          "独自科目を編集"
        } else {
          "独自科目を作成"
        },
        width_class="max-w-md",
        close=emit(@app.PlannerMsg::CloseCustomCourseForm),
        children=body,
      )
    }
  }
}

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

///|
fn planner_view(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  let summary = state.planner_summary()
  let categories = state.category_names()
  let grid = timetable_grid(state, emit, categories)
  let content : Array[Html] = [
    header(
      class="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-rule bg-paper px-4 md:rounded-t-xl",
      [
        div(class="flex min-w-0 items-baseline gap-3", [
          h2(
            class="w-9 shrink-0 text-[1.0625rem] font-semibold",
            state.selected_term.label(),
          ),
          span(
            id="term-context",
            class="hidden text-xs text-muted lg:inline",
            "\{state.timetable_year.academic_year.year()}年度 \{program_label(state.profile.program_id.value)}",
          ),
        ]),
        div(
          class="flex shrink-0 items-center gap-2 pl-2 sm:border-l sm:border-rule/60 sm:pl-3",
          [
            credit_total_view(summary),
            button(
              id="open-catalogue-picker",
              class="flex min-h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-primary px-3 text-xs font-medium text-white hover:bg-primary/90",
              on_click=emit(@app.PlannerMsg::OpenCataloguePicker),
              [span("+"), span("科目")],
            ),
            button(
              id="open-settings",
              class="min-h-8 rounded-md px-2 text-xs text-muted hover:bg-canvas",
              on_click=emit(@app.PlannerMsg::OpenSettings),
              "設定",
            ),
          ],
        ),
      ],
    ),
    div(class="flex min-h-0 flex-1 flex-col md:flex-row", [
      term_section(state, emit),
      main_(id="main-content", class="min-w-0 flex-1 p-4 md:p-5", [
        grid,
        off_grid(state, emit, categories),
        summary_panel(summary),
      ]),
    ]),
  ]
  match state.error {
    Some(error) =>
      content.push(
        p(
          id="planner-error",
          class="mx-4 mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger-text",
          attrs=@html.Attrs::build().role("alert"),
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
      class="mx-auto flex min-h-screen max-w-6xl flex-col overflow-visible bg-paper md:min-h-[calc(100vh-3rem)] md:rounded-xl md:border md:border-rule md:shadow-[0_16px_48px_rgba(0,0,0,0.10)]",
      content,
    ),
    undo_banner(state, emit),
    picker_panel(state, emit, categories),
    course_detail(state, emit, categories),
    custom_form_panel(state, emit),
    override_form_panel(state, emit),
    settings_panel(state, emit),
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
