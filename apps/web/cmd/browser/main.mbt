///|
fn planner_view(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  if state.storage_status == @app.StorageStatus::Loading {
    return div(class="min-h-screen bg-canvas p-0 md:p-6", [
      a(
        href="#main-content",
        class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-paper focus:px-3 focus:py-2",
        "時間割へスキップ",
      ),
      main_(
        id="main-content",
        class="flex min-h-screen items-center justify-center text-sm text-muted",
        [
          div(
            id="persistence-loading",
            attrs=@html.Attrs::build().role("status"),
            "読み込み中",
          ),
        ],
      ),
    ])
  }
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
            span(
              id="persistence-status",
              class="text-[0.6875rem] text-muted",
              attrs=@html.Attrs::build().role("status"),
              storage_status_label(state.storage_status),
            ),
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
fn initial_planner_state() -> @app.PlannerState {
  @app.sample_state()
}

///|
fn app() -> Val[Html] {
  let (state, emit) = @rabbita.create_state_with_init(
    init=app_init,
    update=app_update,
  )
  state.view(state => planner_view(state, emit))
}

///|
fn main {
  @rabbita.new(app).mount("app")
}
