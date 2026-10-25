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
    ],
  )
}

///|
fn range_controls(
  state : @app.PlannerState,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  div(class="flex items-center gap-1 rounded-md bg-canvas p-0.5 text-xs", [
    button(
      id="remove-day",
      title="表示する曜日を減らす",
      class="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-rule/50 disabled:opacity-30",
      disabled=state.visible_days <= 5,
      on_click=emit(@app.PlannerMsg::DecreaseVisibleDays),
      "-",
    ),
    span(class="min-w-6 text-center text-ink", "\{state.visible_days}日"),
    button(
      id="add-day",
      title="表示する曜日を増やす",
      class="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-rule/50 disabled:opacity-30",
      disabled=state.visible_days >= 7,
      on_click=emit(@app.PlannerMsg::IncreaseVisibleDays),
      "+",
    ),
    span(class="px-1 text-rule", "/"),
    button(
      id="remove-period",
      title="表示する時限を減らす",
      class="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-rule/50 disabled:opacity-30",
      disabled=state.visible_periods <= 6,
      on_click=emit(@app.PlannerMsg::DecreaseVisiblePeriods),
      "-",
    ),
    span(class="min-w-6 text-center text-ink", "\{state.visible_periods}限"),
    button(
      id="add-period",
      title="表示する時限を増やす",
      class="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-rule/50 disabled:opacity-30",
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
      scope=@html.Scope::Col,
      class="w-12 border-b border-rule bg-canvas px-3 py-2 text-left text-xs font-medium text-muted",
      "時限",
    ),
  ]
  for day in days {
    header.push(
      th(
        scope=@html.Scope::Col,
        class="border-b border-rule bg-canvas px-3 py-2 text-left text-xs font-medium text-muted",
        day_label(day),
      ),
    )
  }
  let rows : Array[Html] = []
  for period in state.visible_period_values() {
    let cells : Array[Html] = [
      th(
        scope=@html.Scope::Row,
        class="w-12 border-b border-rule px-3 py-2 text-xs font-normal text-muted",
        "\{period}",
      ),
    ]
    for day in days {
      let cell = match find_block(blocks, day, period) {
        Some(block) =>
          td(class="h-16 border-b border-rule p-1.5 align-top", [
            div(
              class="flex h-full flex-col justify-between rounded-md bg-primary-soft px-2 py-1.5",
              [
                span(
                  class="block break-words text-sm font-medium text-ink",
                  block.course_name,
                ),
                div(class="flex justify-end", [
                  button(
                    id="remove-\{block.offering_id.value}-\{day_label(block.day)}-\{block.period.value()}",
                    title="削除",
                    class="flex h-7 w-7 items-center justify-center rounded text-base leading-none text-muted hover:bg-paper hover:text-danger",
                    on_click=emit(
                      @app.PlannerMsg::RemoveEnrollment(
                        offering_id=block.offering_id,
                      ),
                    ),
                    [span("×"), span(class="sr-only", "削除")],
                  ),
                ]),
              ],
            ),
          ])
        None =>
          td(class="h-16 border-b border-rule p-0 align-middle", [
            button(
              id=slot_id(day, period),
              title="\{day_label(day)}\{period}限に科目を追加",
              class="flex h-full w-full items-center justify-center bg-transparent p-0 text-sm text-primary opacity-0 hover:bg-primary-soft/50 hover:opacity-100 focus:opacity-100",
              on_click=emit(@app.PlannerMsg::OpenSlotPicker(day~, period~)),
              [
                span(attrs=@html.Attrs::build().aria_hidden("true"), "+"),
                span(
                  class="sr-only",
                  "\{day_label(day)}\{period}限に科目を追加",
                ),
              ],
            ),
          ])
      }
      cells.push(cell)
    }
    rows.push(tr(cells))
  }
  let hidden = state.hidden_scheduled_block_count(state.selected_term)
  let children : Array[Html] = [
    div(class="mt-4 overflow-hidden rounded-lg border border-rule bg-paper", [
      div(class="overflow-x-auto", [
        table(
          id="timetable",
          class="w-full min-w-[44rem] table-fixed border-collapse text-sm",
          [thead(header), tbody(rows)],
        ),
      ]),
    ]),
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
      div(
        class="flex min-h-11 w-full items-center justify-between gap-3 border-b border-rule px-3 last:border-b-0",
        [
          div(class="min-w-0 py-2", [
            p(class="truncate text-sm", entry.course_name),
            p(
              class="mt-0.5 text-xs text-muted",
              "\{credits_label(entry.credits)}単位",
            ),
          ]),
          button(
            id="remove-\{entry.offering_id.value}",
            title="削除",
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded text-base text-muted hover:bg-canvas hover:text-danger",
            on_click=emit(
              @app.PlannerMsg::RemoveEnrollment(offering_id=entry.offering_id),
            ),
            [span("×"), span(class="sr-only", "削除")],
          ),
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
        class="min-h-8 rounded-md px-2 text-xs text-primary hover:bg-primary-soft",
        on_click=emit(@app.PlannerMsg::OpenIntensivePicker),
        "追加",
      ),
    ]),
    div(class="overflow-hidden rounded-lg border border-rule bg-paper", items),
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
        let action = if entry.enrolled {
          button(
            id="remove-picker-\{entry.offering_id.value}",
            class="min-h-11 min-w-20 shrink-0 rounded-md px-2 text-sm text-muted hover:bg-canvas hover:text-danger",
            on_click=emit(
              @app.PlannerMsg::RemoveEnrollment(offering_id=entry.offering_id),
            ),
            "削除",
          )
        } else {
          button(
            id="add-offering-\{entry.offering_id.value}",
            class="min-h-11 min-w-20 shrink-0 rounded-md px-2 text-sm font-medium text-primary hover:bg-primary-soft",
            on_click=emit(
              @app.PlannerMsg::AddOffering(offering_id=entry.offering_id),
            ),
            "追加",
          )
        }
        items.push(
          div(
            class="flex min-h-14 items-center justify-between gap-3 border-b border-rule px-4 last:border-b-0",
            [
              div(class="min-w-0 flex-1 py-2", [
                div(
                  class="flex w-full items-baseline justify-between gap-2",
                  name_line,
                ),
                p(class="mt-0.5 truncate text-xs text-muted", detail),
              ]),
              action,
            ],
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
      div(
        class="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4",
        [
          div(
            id="picker-backdrop",
            class="absolute inset-0",
            on_click=emit(@app.PlannerMsg::ClosePicker),
            ([] : Array[Html]),
          ),
          section(
            id="picker",
            class="relative z-10 w-full max-w-md overflow-hidden rounded-xl bg-paper shadow-2xl",
            attrs=@html.Attrs::build()
              .role("dialog")
              .aria_modal("true")
              .aria_labelledby("picker-title"),
            [
              div(
                class="flex min-h-12 items-center justify-between border-b border-rule px-4",
                [
                  h2(
                    id="picker-title",
                    class="text-[17px] font-semibold",
                    picker_label(target),
                  ),
                  button(
                    id="close-picker",
                    class="min-h-11 rounded-md px-2 text-sm text-primary hover:bg-primary-soft",
                    on_click=emit(@app.PlannerMsg::ClosePicker),
                    "完了",
                  ),
                ],
              ),
              div(class="border-b border-rule px-4 py-3", [
                label(
                  for_="catalogue-search",
                  class="sr-only",
                  "科目名で検索",
                ),
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
        h2(class="text-[17px] font-semibold", state.selected_term.label()),
        div(class="flex items-center gap-2", [
          range_controls(state, emit),
          button(
            id="open-catalogue-picker",
            class="flex min-h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-white hover:bg-primary/90",
            on_click=emit(@app.PlannerMsg::OpenCataloguePicker),
            [span("+"), span("科目")],
          ),
        ]),
      ],
    ),
    div(class="flex min-h-0 flex-1 flex-col md:flex-row", [
      term_section(state, emit),
      main_(
        id="main-content",
        class="min-w-0 flex-1 overflow-auto p-4 md:p-5",
        [grid, off_grid(state, emit)],
      ),
    ]),
  ]
  match state.error {
    Some(error) =>
      content.push(
        p(
          id="planner-error",
          class="mx-4 mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger",
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
