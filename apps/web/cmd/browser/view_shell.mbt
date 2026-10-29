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
