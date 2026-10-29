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
