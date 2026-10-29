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
  let hidden_blocks : Array[Html] = []
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
    } else {
      hidden_blocks.push(
        li(
          "\{day_label(block.day)}\{block.period.value()}限 · \{block.course_name}",
        ),
      )
    }
  }
  let children : Array[Html] = [
    p(
      id="timetable-scope",
      class="text-sm font-medium text-ink lg:hidden",
      "時間割：\{state.timetable_year.academic_year.year()}年度 \{state.selected_term.label()}",
    ),
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
      div(id="hidden-blocks", class="mt-3 rounded-lg bg-canvas p-3 text-sm", [
        p("表示範囲外に\{hidden}件の履修があります"),
        ul(
          class="mt-1 list-inside list-disc break-words text-muted",
          hidden_blocks,
        ),
        button(
          id="open-hidden-settings",
          class="mt-2 min-h-11 rounded-md px-2 text-primary-text hover:bg-primary-soft",
          on_click=emit(@app.PlannerMsg::OpenSettings),
          "表示範囲を変更",
        ),
      ]),
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
