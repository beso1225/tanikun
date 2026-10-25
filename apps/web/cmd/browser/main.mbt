///|
using @rabbita {type Emit, type Html, type Val}

///|
using @html {
  button,
  div,
  h1,
  h2,
  input,
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
fn timetable_grid(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
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
            div(class="flex h-full flex-col justify-between", [
              span(
                class="block break-words text-sm font-medium",
                block.course_name,
              ),
              div(class="flex justify-end", [
                button(
                  id="remove-\{block.offering_id.value}-\{day_label(block.day)}-\{block.period.value()}",
                  class="rounded-md border border-action bg-white px-2 py-1 text-xs",
                  on_click=emit(
                    @app.PlannerMsg::RemoveEnrollment(
                      offering_id=block.offering_id,
                    ),
                  ),
                  "削除",
                ),
              ]),
            ]),
          ])
        None =>
          td(class="h-16 border border-action p-1", [
            button(
              id=slot_id(day, period),
              class="h-full w-full rounded-md border border-dashed border-action bg-white text-lg text-action",
              on_click=emit(@app.PlannerMsg::OpenSlotPicker(day~, period~)),
              "+",
            ),
          ])
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
fn off_grid(state : @app.PlannerState, emit : Emit[@app.PlannerMsg]) -> Html {
  let entries = state.off_grid_entries(state.selected_term)
  let items : Array[Html] = []
  for entry in entries {
    items.push(
      div(class="mt-1 flex w-full items-center justify-between gap-2", [
        span(
          class="min-w-0 break-words",
          "\{entry.course_name} (\{credits_label(entry.credits)}単位)",
        ),
        button(
          id="remove-\{entry.offering_id.value}",
          class="shrink-0 rounded-md border border-action bg-white px-2 py-1 text-xs",
          on_click=emit(
            @app.PlannerMsg::RemoveEnrollment(offering_id=entry.offering_id),
          ),
          "削除",
        ),
      ]),
    )
  }
  if entries.is_empty() {
    items.push(p(class="mt-1 text-sm", "集中講義はありません"))
  }
  section(id="off-grid", class="mt-4", [
    div(class="flex items-center gap-3", [
      h2(class="text-lg font-bold", "集中講義"),
      button(
        id="open-intensive-picker",
        class="rounded-md border border-action bg-white px-2 py-1 text-xs",
        on_click=emit(@app.PlannerMsg::OpenIntensivePicker),
        "集中講義を追加",
      ),
    ]),
    div(items),
  ])
}

///|
fn picker_label(target : @app.PickerTarget) -> String {
  match target {
    @app.PickerTarget::Slot(day~, period~) =>
      "\{day_label(day)}\{period}に追加"
    @app.PickerTarget::Intensive => "集中講義を追加"
  }
}

///|
fn picker_panel(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  match state.picker {
    None =>
      p(
        class="mt-4 text-sm",
        "空きセルをクリックすると科目を追加できます",
      )
    Some(target) => {
      let entries = state.picker_entries()
      let items : Array[Html] = []
      for entry in entries {
        let detail = "\{credits_label(entry.credits)}単位 / \{schedule_label(entry.schedule)} / \{slots_label(entry.slots)}"
        let action = if entry.enrolled {
          button(
            id="enrolled-\{entry.offering_id.value}",
            disabled=true,
            class="mt-2 rounded-md border border-action bg-white px-2 py-1 text-xs",
            "登録済み",
          )
        } else {
          button(
            id="add-offering-\{entry.offering_id.value}",
            class="mt-2 rounded-md border border-action bg-white px-2 py-1 text-xs",
            on_click=emit(
              @app.PlannerMsg::AddOffering(offering_id=entry.offering_id),
            ),
            "追加",
          )
        }
        items.push(
          div(class="border-b border-action p-2", [
            p(class="font-medium", entry.course_name),
            p(class="text-xs", detail),
            action,
          ]),
        )
      }
      if items.is_empty() {
        items.push(
          p(class="p-2 text-sm", "該当する科目がありません"),
        )
      }
      div(
        id="picker-backdrop",
        class="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4",
        [
          section(
            id="picker",
            class="mt-[10vh] max-h-[70vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-4",
            [
              div(class="flex items-center justify-between", [
                h2(class="text-lg font-bold", picker_label(target)),
                button(
                  id="close-picker",
                  class="rounded-md border border-action bg-white px-2 py-1 text-xs",
                  on_click=emit(@app.PlannerMsg::ClosePicker),
                  "閉じる",
                ),
              ]),
              input(
                id="catalogue-search",
                class="mt-3 w-full rounded-md border border-action bg-white p-2 text-sm",
                placeholder="科目名で検索",
                value=state.catalogue_query,
                on_input=fn(query) {
                  emit(@app.PlannerMsg::UpdateCatalogueQuery(query~))
                },
              ),
              div(items),
            ],
          ),
        ],
      )
    }
  }
}

///|

///|
fn planner_view(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  let grid = if state.selected_term == @app.PlannerTerm::W {
    p(class="mt-4 text-sm", "Wでは時間割のグリッドを使いません")
  } else {
    timetable_grid(state, emit)
  }
  let children : Array[Html] = [
    h1(class="text-3xl font-bold", "応物単位くん"),
    p(class="mt-2 text-sm", "Phase 2 timetable planner"),
    term_tabs(state, emit),
    range_controls(state, emit),
    grid,
    off_grid(state, emit),
    picker_panel(state, emit),
  ]
  match state.error {
    Some(error) =>
      children.push(
        p(id="planner-error", class="mt-4 text-sm text-red-700", error.message),
      )
    None => ()
  }
  div(class="mx-auto max-w-6xl p-6", children)
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
