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
