///|
/// Shared field presentation for the custom and override dialogs. Callers keep
/// their own validation field, error ID, and fallback logic.
fn form_field_class(has_error : Bool, base : String) -> String {
  if has_error {
    "\{base} border-danger-text"
  } else {
    base
  }
}

///|
fn form_field_attrs(has_error : Bool, error_id : String) -> @html.Attrs {
  if has_error {
    @html.Attrs::build().aria_invalid("true").aria_describedby(error_id)
  } else {
    @html.Attrs::build()
  }
}

///|
fn form_error_alert(id : String, message : String) -> Html {
  p(
    id~,
    class="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger-text",
    attrs=@html.Attrs::build().role("alert"),
    message,
  )
}

///|
fn form_submit_button(
  id : String,
  label : String,
  message : @app.PlannerMsg,
  emit : Emit[@app.PlannerMsg],
) -> Html {
  button(
    id~,
    class="min-h-11 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90",
    on_click=emit(message),
    label,
  )
}

///|
fn credit_option_items(selected : String, unset? : String) -> Array[Html] {
  let options : Array[Html] = []
  match unset {
    Some(label) =>
      options.push(option(value="", selected=selected.is_empty(), label))
    None => ()
  }
  for half_units in 1..<=20 {
    let value = "\{half_units}"
    options.push(
      option(
        value~,
        selected=selected == value,
        "\{half_units_label(half_units)}単位",
      ),
    )
  }
  options
}

///|
fn weekday_option_items(is_selected : (Int) -> Bool) -> Array[Html] {
  let options : Array[Html] = []
  let days = [
    @tanikun-domain.DayOfWeek::Monday,
    @tanikun-domain.DayOfWeek::Tuesday,
    @tanikun-domain.DayOfWeek::Wednesday,
    @tanikun-domain.DayOfWeek::Thursday,
    @tanikun-domain.DayOfWeek::Friday,
    @tanikun-domain.DayOfWeek::Saturday,
    @tanikun-domain.DayOfWeek::Sunday,
  ]
  for day in days {
    let index = day_index(day)
    let value = "\{index}"
    options.push(option(value~, selected=is_selected(index), day_label(day)))
  }
  options
}

///|
fn period_option_items(is_selected : (Int) -> Bool) -> Array[Html] {
  let options : Array[Html] = []
  for period in 1..<=10 {
    let value = "\{period}"
    options.push(option(value~, selected=is_selected(period), "\{period}限"))
  }
  options
}
