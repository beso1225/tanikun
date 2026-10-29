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
  let label = "\{node.label}: 修得済 \{confirmed_done} / \{confirmed_total}\{unit}, 履修中込 \{standard_done} / \{standard_total}\{unit}, 履修予定込 \{optimistic_done} / \{optimistic_total}\{unit}"
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
    class="grid grid-cols-2 items-baseline gap-x-2 gap-y-1 rounded-md bg-canvas px-2 py-2 text-xs sm:grid-cols-[minmax(0,1.1fr)_7.5rem_minmax(0,1fr)_minmax(0,1fr)] sm:bg-transparent sm:p-0",
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
    children.push(li(requirement_tree_node(child)))
  }
  div(class="space-y-2 border-l border-rule/60 pl-3", [
    p(class="break-words text-sm font-medium", node.label),
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
      ul(class="space-y-2", attrs=@html.Attrs::build().role("list"), children)
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
            id="summary-scope",
            class="mt-2 text-xs text-muted",
            "すべての学年・学期の履修を集計しています。",
          ),
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
                      class="w-[40%] pb-1 text-left text-xs text-muted sm:w-1/4",
                      "区分",
                    ),
                    th(
                      scope=@html.Scope::Col,
                      class="w-[20%] whitespace-nowrap pb-1 px-1 text-right text-xs text-muted sm:w-1/4 sm:px-2",
                      "修得済",
                    ),
                    th(
                      scope=@html.Scope::Col,
                      class="w-[20%] whitespace-nowrap pb-1 px-1 text-right text-xs text-muted sm:w-1/4 sm:px-2",
                      attrs=@html.Attrs::build().aria_label("履修中込"),
                      [
                        span(class="sr-only sm:not-sr-only", "履修"),
                        span("中込"),
                      ],
                    ),
                    th(
                      scope=@html.Scope::Col,
                      class="w-[20%] whitespace-nowrap pb-1 pl-1 text-right text-xs text-muted sm:w-1/4 sm:pl-2",
                      attrs=@html.Attrs::build().aria_label("履修予定込"),
                      [
                        span(class="sr-only sm:not-sr-only", "履修"),
                        span("予定込"),
                      ],
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
            ul(attrs=@html.Attrs::build().role("list"), [
              li(requirement_tree_node(summary.requirement_root)),
            ]),
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
