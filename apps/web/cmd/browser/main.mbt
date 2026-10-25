///|
using @rabbita {type Emit, type Html, type Val}

///|
using @html {
  button,
  div,
  h1,
  h2,
  header,
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
      "flex w-full items-center justify-center border-b border-l-4 border-l-accent border-rule bg-primary px-3 py-3 text-center text-white md:justify-start"
    } else {
      "flex w-full items-center justify-center border-b border-l-4 border-l-transparent border-rule bg-paper px-3 py-3 text-center hover:bg-primary-soft md:justify-start"
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
  nav(
    class="grid grid-cols-5 gap-0 self-start border border-rule md:flex md:flex-col",
    tabs,
  )
}

///|
fn range_controls(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  div(class="flex flex-wrap items-center gap-1 text-xs text-muted", [
    button(
      id="remove-day",
      title="表示する曜日を減らす",
      class="border border-rule bg-paper px-2 py-1 text-ink disabled:opacity-30",
      disabled=state.visible_days <= 5,
      on_click=emit(@app.PlannerMsg::DecreaseVisibleDays),
      "-",
    ),
    span(class="px-1 text-ink", "\{state.visible_days}日"),
    button(
      id="add-day",
      title="表示する曜日を増やす",
      class="border border-rule bg-paper px-2 py-1 text-ink disabled:opacity-30",
      disabled=state.visible_days >= 7,
      on_click=emit(@app.PlannerMsg::IncreaseVisibleDays),
      "+",
    ),
    span(class="px-1 text-rule", "/"),
    button(
      id="remove-period",
      title="表示する時限を減らす",
      class="border border-rule bg-paper px-2 py-1 text-ink disabled:opacity-30",
      disabled=state.visible_periods <= 6,
      on_click=emit(@app.PlannerMsg::DecreaseVisiblePeriods),
      "-",
    ),
    span(class="px-1 text-ink", "\{state.visible_periods}限"),
    button(
      id="add-period",
      title="表示する時限を増やす",
      class="border border-rule bg-paper px-2 py-1 text-ink disabled:opacity-30",
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
  let header : Array[Html] = [
    th(
      class="w-14 border-b border-rule bg-canvas p-2 text-left text-[11px] font-normal text-muted",
      "時限",
    ),
  ]
  for day in days {
    header.push(
      th(
        class="border-b border-rule bg-canvas p-2 text-left text-[11px] font-normal text-muted",
        day_label(day),
      ),
    )
  }
  let rows : Array[Html] = []
  for period in state.visible_period_values() {
    let cells : Array[Html] = [
      th(
        class="w-14 border-b border-rule p-2 text-[11px] font-normal text-muted",
        "\{period}",
      ),
    ]
    for day in days {
      let cell = match find_block(blocks, day, period) {
        Some(block) =>
          td(
            class="h-20 border-b border-rule bg-primary-soft/40 p-2 align-top",
            [
              div(class="flex h-full flex-col justify-between", [
                span(
                  class="block break-words text-sm font-medium text-ink",
                  block.course_name,
                ),
                div(class="flex justify-end", [
                  button(
                    id="remove-\{block.offering_id.value}-\{day_label(block.day)}-\{block.period.value()}",
                    class="border-0 bg-transparent p-1 text-xs text-muted underline decoration-rule underline-offset-2 hover:text-primary",
                    on_click=emit(
                      @app.PlannerMsg::RemoveEnrollment(
                        offering_id=block.offering_id,
                      ),
                    ),
                    "削除",
                  ),
                ]),
              ]),
            ],
          )
        None =>
          td(class="h-20 border-b border-rule p-1 align-middle", [
            button(
              id=slot_id(day, period),
              title="\{day_label(day)}\{period}限に科目を追加",
              class="h-full w-full border border-dashed border-rule bg-transparent p-0 text-sm text-muted hover:border-pine hover:bg-pine-soft hover:text-pine",
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
    div(class="mt-4 overflow-x-auto", [
      table(
        id="timetable",
        class="w-full min-w-[44rem] table-fixed border-collapse text-sm",
        [thead(header), tbody(rows)],
      ),
    ]),
  ]
  if hidden > 0 {
    children.push(
      p(
        id="hidden-blocks",
        class="mt-2 border-l-2 border-danger pl-3 text-xs text-danger",
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
      div(class="flex w-full items-center justify-between gap-3 py-2", [
        div(class="min-w-0", [
          p(class="text-sm font-medium", entry.course_name),
          p(
            class="mt-0.5 text-xs text-muted",
            "\{credits_label(entry.credits)}単位",
          ),
        ]),
        button(
          id="remove-\{entry.offering_id.value}",
          class="shrink-0 border-0 bg-transparent p-1 text-xs text-muted underline decoration-rule underline-offset-2 hover:text-primary",
          on_click=emit(
            @app.PlannerMsg::RemoveEnrollment(offering_id=entry.offering_id),
          ),
          "削除",
        ),
      ]),
    )
  }
  if entries.is_empty() {
    items.push(
      p(class="py-3 text-sm text-muted", "集中講義はありません"),
    )
  }
  section(id="off-grid", class="mt-6 border-t border-rule pt-4", [
    div(class="flex items-center justify-between gap-3", [
      h2(class="font-semibold", "集中講義"),
      button(
        id="open-intensive-picker",
        class="border border-primary bg-primary px-3 py-1.5 text-xs text-white hover:bg-ink",
        on_click=emit(@app.PlannerMsg::OpenIntensivePicker),
        "集中講義を追加",
      ),
    ]),
    div(class="mt-2 divide-y divide-rule", items),
  ])
}

///|
fn picker_label(target : @app.PickerTarget) -> String {
  match target {
    @app.PickerTarget::Slot(day~, period~) =>
      "\{day_label(day)}\{period}限に追加"
    @app.PickerTarget::Intensive => "集中講義を追加"
    @app.PickerTarget::All => "科目一覧から追加"
  }
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
        let detail = "\{credits_label(entry.credits)}単位 / \{schedule_label(entry.schedule)} / \{slots_label(entry.slots)}"
        let action = if entry.enrolled {
          button(
            id="enrolled-\{entry.offering_id.value}",
            disabled=true,
            class="shrink-0 border border-rule bg-canvas px-3 py-1.5 text-xs text-muted",
            "登録済み",
          )
        } else {
          button(
            id="add-offering-\{entry.offering_id.value}",
            class="shrink-0 border border-pine bg-pine px-3 py-1.5 text-xs text-white hover:bg-ink",
            on_click=emit(
              @app.PlannerMsg::AddOffering(offering_id=entry.offering_id),
            ),
            "追加",
          )
        }
        items.push(
          div(class="flex items-start justify-between gap-4 py-3", [
            div(class="min-w-0", [
              p(class="text-sm font-medium", entry.course_name),
              p(class="mt-0.5 text-xs text-muted", detail),
            ]),
            action,
          ]),
        )
      }
      if items.is_empty() {
        items.push(
          p(
            class="py-4 text-sm text-muted",
            "該当する科目がありません",
          ),
        )
      }
      div(
        id="picker-backdrop",
        class="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 backdrop-blur-sm",
        [
          section(
            id="picker",
            class="mt-[8vh] w-full max-w-xl border border-ink border-t-4 border-t-primary bg-paper p-5 shadow-2xl",
            [
              div(
                class="flex items-start justify-between gap-4 border-b border-rule pb-3",
                [
                  h2(class="font-semibold text-lg", picker_label(target)),
                  button(
                    id="close-picker",
                    class="border-0 bg-transparent p-0 text-xs text-muted underline decoration-rule underline-offset-2 hover:text-vermilion",
                    on_click=emit(@app.PlannerMsg::ClosePicker),
                    "閉じる",
                  ),
                ],
              ),
              input(
                id="catalogue-search",
                class="mt-3 w-full border-b border-rule bg-transparent px-0 py-2 text-sm outline-none focus:border-primary",
                placeholder="科目名で検索",
                value=state.catalogue_query,
                autofocus=true,
                on_input=fn(query) {
                  emit(@app.PlannerMsg::UpdateCatalogueQuery(query~))
                },
              ),
              div(class="mt-1 divide-y divide-rule", items),
            ],
          ),
        ],
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
      class="mt-4 border-l-2 border-rule pl-3 text-sm text-muted",
      "Wでは時間割のグリッドを使いません",
    )
  } else {
    timetable_grid(state, emit)
  }
  let children : Array[Html] = [
    header(class="border-b border-ink pb-4", [
      div(class="flex flex-wrap items-end justify-between gap-3", [
        h1(
          class="text-3xl font-bold tracking-tight md:text-4xl",
          "応物単位くん",
        ),
        p(
          class="text-right text-xs leading-5 text-muted",
          "\{state.profile.advancement_year.year()}年度\n応用物理",
        ),
      ]),
    ]),
    div(class="mt-6 grid gap-6 md:grid-cols-[6rem_minmax(0,1fr)]", [
      term_tabs(state, emit),
      div(class="min-w-0", [
        div(class="flex flex-wrap items-end justify-between gap-3", [
          h2(class="text-2xl font-semibold", state.selected_term.label()),
          div(class="flex flex-wrap items-center gap-2", [
            button(
              id="open-catalogue-picker",
              class="border border-primary bg-primary px-3 py-2 text-xs text-white hover:bg-ink",
              on_click=emit(@app.PlannerMsg::OpenCataloguePicker),
              "科目一覧から追加",
            ),
            range_controls(state, emit),
          ]),
        ]),
        grid,
        off_grid(state, emit),
      ]),
    ]),
    picker_panel(state, emit),
  ]
  match state.error {
    Some(error) =>
      children.push(
        p(
          id="planner-error",
          class="mt-4 border-l-2 border-danger bg-paper px-3 py-2 text-sm text-danger",
          error.message,
        ),
      )
    None => ()
  }
  div(class="mx-auto max-w-6xl px-4 py-6 md:px-6", children)
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
