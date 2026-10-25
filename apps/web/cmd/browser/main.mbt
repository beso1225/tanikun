///|
using @rabbita {type Emit, type Html, type Val}

///|
using @html {
  button,
  div,
  h1,
  h2,
  nav,
  p,
  section,
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
fn term_tabs(state : @app.PlannerState, emit : Emit[@app.PlannerMsg]) -> Html {
  let tabs : Array[Html] = []
  for term in @app.PlannerTerm::values() {
    let selected = state.selected_term == term
    let class_name = if selected {
      "rounded-md border border-action bg-action px-4 py-2 text-white"
    } else {
      "rounded-md border border-action bg-white px-4 py-2 text-ink"
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
  nav(class="mt-6 flex flex-wrap gap-2", tabs)
}

///|
fn range_controls(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  div(class="mt-4 flex flex-wrap items-center gap-3 text-sm", [
    span("曜日"),
    button(
      id="remove-day",
      disabled=state.visible_days <= 5,
      on_click=emit(@app.PlannerMsg::DecreaseVisibleDays),
      "-",
    ),
    span("\{state.visible_days}日"),
    button(
      id="add-day",
      disabled=state.visible_days >= 7,
      on_click=emit(@app.PlannerMsg::IncreaseVisibleDays),
      "+",
    ),
    span("時限"),
    button(
      id="remove-period",
      disabled=state.visible_periods <= 6,
      on_click=emit(@app.PlannerMsg::DecreaseVisiblePeriods),
      "-",
    ),
    span("\{state.visible_periods}限"),
    button(
      id="add-period",
      disabled=state.visible_periods >= 10,
      on_click=emit(@app.PlannerMsg::IncreaseVisiblePeriods),
      "+",
    ),
  ])
}

///|
fn timetable_grid(state : @app.PlannerState) -> Html {
  let blocks = state.scheduled_blocks(state.selected_term)
  let days = state.visible_day_values()
  let header : Array[Html] = [th(class="w-16 p-2 text-left", "時限")]
  for day in days {
    header.push(th(class="p-2 text-left", day_label(day)))
  }
  let rows : Array[Html] = []
  for period in state.visible_period_values() {
    let cells : Array[Html] = [th(class="p-2 text-left", "\{period}")]
    for day in days {
      let cell = match find_block(blocks, day, period) {
        Some(block) =>
          td(class="h-16 border border-action bg-white p-2 align-top", [
            span(class="text-sm font-medium", block.course_name),
          ])
        None => td(class="h-16 border border-action p-2", ([] : Array[Html]))
      }
      cells.push(cell)
    }
    rows.push(tr(cells))
  }
  let hidden = state.hidden_scheduled_block_count(state.selected_term)
  let children : Array[Html] = [
    table(
      id="timetable",
      class="mt-4 w-full table-fixed border-collapse text-sm",
      [thead(header), tbody(rows)],
    ),
  ]
  if hidden > 0 {
    children.push(
      p(
        id="hidden-blocks",
        class="mt-2 text-sm",
        "表示範囲外に\{hidden}件の履修があります",
      ),
    )
  }
  div(children)
}

///|
fn off_grid(state : @app.PlannerState) -> Html {
  let entries = state.off_grid_entries(state.selected_term)
  if entries.is_empty() {
    return p(class="mt-4 text-sm", "集中講義はありません")
  }
  let items : Array[Html] = []
  for entry in entries {
    items.push(
      p(
        class="mt-1",
        "\{entry.course_name} (\{credits_label(entry.credits)}単位)",
      ),
    )
  }
  section(id="off-grid", class="mt-4", [
    h2(class="text-lg font-bold", "集中講義"),
    div(items),
  ])
}

///|
fn planner_view(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  let grid = if state.selected_term == @app.PlannerTerm::W {
    p(class="mt-4 text-sm", "Wでは時間割のグリッドを使いません")
  } else {
    timetable_grid(state)
  }
  div(class="mx-auto max-w-6xl p-6", [
    h1(class="text-3xl font-bold", "応物単位くん"),
    p(class="mt-2 text-sm", "Phase 2 timetable planner"),
    term_tabs(state, emit),
    range_controls(state, emit),
    grid,
    off_grid(state),
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
