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
  h3,
  header,
  input,
  label,
  li,
  main_,
  nav,
  option,
  p,
  section,
  select,
  span,
  table,
  tbody,
  td,
  th,
  thead,
  tr,
  ul,
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
  @app.credits_label(credits)
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
fn enrollment_status_view(
  status : @tanikun-domain.EnrollmentStatus,
) -> (String, String) {
  match status {
    @tanikun-domain.EnrollmentStatus::Planned => ("予定", "text-muted-tile")
    @tanikun-domain.EnrollmentStatus::InProgress =>
      ("履修中", "text-primary-text")
    @tanikun-domain.EnrollmentStatus::Confirmed(
      @tanikun-domain.ConfirmedGrade::Passed(..)
    ) => ("合格", "text-success-text-tile")
    @tanikun-domain.EnrollmentStatus::Confirmed(
      @tanikun-domain.ConfirmedGrade::Failed(..)
    ) => ("不合格", "text-danger-text")
    @tanikun-domain.EnrollmentStatus::Confirmed(
      @tanikun-domain.ConfirmedGrade::NotTaken
    ) => ("未履修", "text-muted-tile")
  }
}

///|
fn enrollment_status_badge(status : @tanikun-domain.EnrollmentStatus) -> Html {
  let (label, class_name) = enrollment_status_view(status)
  span(
    class="shrink-0 whitespace-nowrap text-[0.6875rem] font-medium \{class_name}",
    label,
  )
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
fn program_label(value : String) -> String {
  match value {
    "applied-physics" => "応用物理"
    "applied-chemistry" => "応用化学"
    _ => value
  }
}

///|
fn half_units_label(half_units : Int) -> String {
  @app.half_units_label(half_units)
}
