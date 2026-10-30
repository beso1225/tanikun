# Phase 2: in-memory timetable planner

## Status

Phase 2 is complete. Its results and evidence are in
[PHASE_2_RESULTS.md](PHASE_2_RESULTS.md). This document is the current contract
for the planner state, transitions, projections, and error boundary. It is
consistent with [ADR-0006](adr/0006-phase-2-planner-state-and-ui-errors.md),
[ADR-0007](adr/0007-custom-course-id-namespace.md),
[ADR-0008](adr/0008-timetable-grade-year-mapping.md), and the Phase 1 contract in
[PHASE_1.md](PHASE_1.md).

## Goal and scope

Phase 2 turns the pure Phase 1 model into one local, in-memory planner:

- four sidebar terms S1, S2, A1, and A2, with W intensives grouped under A;
- planned, in-progress, passed, failed, and not-taken enrollments;
- custom courses and offerings;
- name, credit, and slot overrides;
- program and advancement-year selection for requirements;
- grade and academic-year navigation for the timetable;
- confirmed, in-progress-inclusive, and planned-inclusive summaries.

Phase 2 has no persistence, Workers requests, network API, D1, Automerge, or
multi-device sync. Reloading the page discards the planner.

## Ownership and state

The `apps/web/app/planner_*.mbt` files own state, transitions, projections, and
summary. The `apps/web/cmd/browser/view_*.mbt` files render the shell and
projections, while `main.mbt` owns the entry point and the root view composition. The pure packages own
validation and evaluation; they do not import the planner.

`PlannerState` contains:

| Field                       | Meaning                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| `catalogue`                 | In-memory courses, including custom courses                              |
| `offerings`                 | In-memory offerings for all sample and custom years                      |
| `enrollments`               | One enrollment per offering id                                           |
| `undo_removal`              | At most one previous enrollment list and its revision                    |
| `overrides`                 | Sparse course and offering overrides                                     |
| `profile`                   | Program and advancement year used for requirements                       |
| `timetable_year`            | Selected grade and mapped academic year                                  |
| `requirement_sets`          | Available requirement sets keyed by program/year                         |
| `selected_term`             | S1, S2, A1, A2, or W; W is model-level and never selected by the sidebar |
| `selected_offering`         | Offering shown in the detail dialog                                      |
| `error`                     | Current planner-level `UiError`                                          |
| `catalogue_query`           | Picker search text                                                       |
| `picker`                    | Slot, intensive, or all-catalogue picker, or none                        |
| `settings_open`             | Whether the settings dialog is open                                      |
| `override_form`             | Draft override editor, or none                                           |
| `custom_form`               | Draft custom-course editor, or none                                      |
| `custom_course_ids`         | Courses created in the `user` namespace                                  |
| `custom_categories`         | Category assignments for custom courses                                  |
| `next_custom_course_number` | Session-local custom id counter                                          |
| `visible_days`              | 5 through 7                                                              |
| `visible_periods`           | 6 through 10                                                             |
| `revision`                  | Monotonic UI refresh marker                                              |

No derived credit, category, requirement, catalogue row, scheduled block, or
effective display value is stored in `PlannerState`. The view calls the pure
projection methods and `planner_summary()` from the current state.

`revision` is not history. Every accepted state transition increments it, and
`PlannerState` equality compares only that revision so Rabbita refreshes the
large nested record cheaply.

## Terms and academic years

`PlannerTerm` has S1, S2, A1, A2, and W.

- S1 and S2 belong to semester S.
- A1 and A2 belong to semester A.
- W has no domain `Term`; it is the off-grid winter period and never renders a
  weekday grid.
- W is not a sidebar tab. Its intensive offerings appear under the A1 and A2
  intensive sections, after the A entries.
- YearLong offerings occupy every term.
- Regular offerings occupy only their listed terms.
- Intensive offerings have no slots and appear in the off-grid list for their
  semester. W intensives appear under A1 and A2.

### Timetable grade mapping

ADR-0008 defines the mapping. The profile advancement year is grade 3.

| Grade | Academic year        |
| ----- | -------------------- |
| 1     | advancement year - 2 |
| 2     | advancement year - 1 |
| 3     | advancement year     |
| 4     | advancement year + 1 |

The sidebar shows one grade selector with the mapped year in each option, for
example `3年（2026年度）`. Changing the profile remaps by preserving the grade.
The selected term is preserved when the grade, year, or profile changes.
Scheduled blocks, off-grid entries, catalogue rows, and placement are filtered
by `timetable_year.academic_year`.

A year with no offered courses still shows the grid cells. The sidebar has no W
tab; W intensives are listed under A1 and A2 instead.

## Derived projections

These methods return fresh values:

- `catalogue_entries(term)`: effective name, credits, and slots for offerings in
  the selected year and term that are offered. A1 and A2 include W intensives.
- `picker_entries()`: catalogue entries narrowed by the open picker target.
- `scheduled_blocks(term)`: enrolled offerings for the selected year and term,
  one block per effective slot.
- `off_grid_entries(term)`: enrolled intensive offerings for the selected year
  and term. A1 and A2 include W intensives with `winter = true`.
- `offering_display(offering_id)`: effective name, credits, and slots for the
  detail dialog.
- `planner_summary()`: all three totals, category credits, and the requirement
  tree.

Effective display rules:

- A course's category name comes from the effective requirement set, including
  custom course assignments.
- A non-passed enrollment uses current course and offering overrides.
- A passed enrollment uses the frozen name and credits from its snapshot.
- A passed enrollment's timetable and catalogue slots use the offering's stored
  slots, not a slot override.
- The catalogue name and credits for a passed offering also use the snapshot.
- The summary uses `evaluate()` exactly once per render and passes the result to
  the header, sidebar, and summary panel.

### Visibility and outside-range blocks

The grid renders only visible days and periods. A scheduled enrollment outside
the range remains in state and in `scheduled_blocks()`, but is not drawn. The
view shows `表示範囲外にN件の履修があります` when
`hidden_scheduled_block_count(term) > 0`. The notice lists each hidden block's
day, period, and course name and opens the display settings.

The grid says `空き時間を選んで科目を追加できます。` above its cells. At
phone widths, a list below the grid repeats visible scheduled blocks with their
day, period, name, and status. Both the grid and the list open course details.
The list remains empty when there are no visible scheduled blocks.

Visible range bounds are:

- days: 5 through 7;
- periods: 6 through 10.

The settings dialog changes those bounds immediately and keeps changes after
closing. It also owns the program and advancement-year selectors; the timetable
grade selector stays in the sidebar. The selected term and timetable year are
not changed by the settings dialog.

## Message catalog

`update_planner(state, msg)` is the only planner transition function. Every
message increments `revision` unless the message is an explicit no-op at a
boundary.

| Message                                       | State change                                                                                                                                                                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SelectTerm(term)`                            | Sets `selected_term`; clears `selected_offering`, `error`, `picker`, and `catalogue_query`.                                                                                                                                                              |
| `SelectOffering(offering_id)`                 | Sets `selected_offering` if the offering exists and clears `error`; otherwise reports `UnknownOffering`.                                                                                                                                                 |
| `ClearOfferingSelection`                      | Clears `selected_offering` and `error`.                                                                                                                                                                                                                  |
| `AddOffering(offering_id)`                    | Validates year, term availability, and slot conflicts; appends a planned enrollment and closes a slot picker. Repeated add is a no-op. Failed validation leaves enrollments unchanged and sets `error`.                                                  |
| `RemoveEnrollment(offering_id)`               | Removes the matching enrollment, closes the detail, and stores the previous enrollment list plus the new revision in `undo_removal`. Missing enrollment changes no enrollment but still closes the detail, clears the error, and expires a pending undo. |
| `UndoEnrollmentRemoval`                       | Restores the captured enrollment list only when the stored revision still matches; otherwise clears the stale undo.                                                                                                                                      |
| `UpdateEnrollmentStatus(offering_id, target)` | Replaces the enrollment status, builds a pass snapshot when entering passed, preserves an existing pass snapshot across passing-grade changes, and clears `error`.                                                                                       |
| `SelectProgram(program_id)`                   | Resolves a program from the requirement-set keys, preserves the current year when available, falls back to the first year, and applies the profile atomically. An unknown program id or a program with no requirement-set years reports an error.        |
| `SelectAdvancementYear(year)`                 | Applies the year to the current program and reports `MissingRequirementSet` when no set exists. The selected profile stays visible for recovery.                                                                                                         |
| `SelectGrade(grade)`                          | Parses grade 1–4 and builds the mapped `timetable_year`; clears selected offering, picker, override editor, and error. The term is preserved.                                                                                                            |
| `OpenSettings`                                | Opens settings; clears picker, detail, override form, custom form, and error.                                                                                                                                                                            |
| `CloseSettings`                               | Closes settings and clears `error`.                                                                                                                                                                                                                      |
| `OpenOverrideEditor(offering_id)`             | Builds an override draft from current overrides and closes the detail and picker. Missing targets report an error.                                                                                                                                       |
| `CloseOverrideEditor`                         | Closes the editor and reopens the detail for the edited offering.                                                                                                                                                                                        |
| `UpdateOverrideField(field, value)`           | Updates name or credits text; clears the form error and planner error.                                                                                                                                                                                   |
| `UpdateOverrideDay(value)`                    | Parses and updates the draft slot day; clears form and planner errors.                                                                                                                                                                                   |
| `UpdateOverridePeriod(value)`                 | Parses and updates the draft slot period; clears form and planner errors.                                                                                                                                                                                |
| `ToggleOverrideSlots`                         | Toggles the slot override when the offering supports slots.                                                                                                                                                                                              |
| `RemoveAllOverrides`                          | Removes the course name/credits and offering slots overrides for the form target, closes the editor, and reopens the detail.                                                                                                                             |
| `SubmitOverride`                              | Validates and saves the draft override set. Failed name, credit, slot, or conflict validation keeps the editor open with a field error. On success closes the editor and reopens the detail.                                                             |
| `OpenCustomCourseForm`                        | Builds a draft from the current picker context, selected timetable year, and selected term; clears the picker, detail, override form, and error.                                                                                                         |
| `CloseCustomCourseForm`                       | Closes the form and restores the picker that opened it.                                                                                                                                                                                                  |
| `UpdateCustomCourseField(field, value)`       | Updates one draft field and clears form/planner errors.                                                                                                                                                                                                  |
| `ToggleCustomTerm(term)`                      | Adds or removes a regular term in the draft.                                                                                                                                                                                                             |
| `OpenEditCustomCourse(offering_id)`           | Opens the custom edit form for a `user` course/offering and preserves the return picker.                                                                                                                                                                 |
| `DeleteCustomCourse(course_id)`               | Deletes a custom course and its offerings only when unenrolled; otherwise keeps state and reports an error.                                                                                                                                              |
| `SubmitCustomCourse`                          | Validates and creates or edits a custom course/offering. Invalid input keeps the form open with a field error. Creation appends to the catalogue/offerings and uses the next custom number.                                                              |
| `OpenSlotPicker(day, period)`                 | Opens the slot picker and clears the catalogue query.                                                                                                                                                                                                    |
| `OpenIntensivePicker`                         | Opens the intensive picker and clears the catalogue query.                                                                                                                                                                                               |
| `OpenCataloguePicker`                         | Opens the all-catalogue picker and clears the catalogue query.                                                                                                                                                                                           |
| `ClosePicker`                                 | Closes the picker and clears the catalogue query.                                                                                                                                                                                                        |
| `UpdateCatalogueQuery(query)`                 | Updates the picker search text only.                                                                                                                                                                                                                     |
| `IncreaseVisibleDays`                         | Adds one visible day up to 7.                                                                                                                                                                                                                            |
| `DecreaseVisibleDays`                         | Removes one visible day down to 5.                                                                                                                                                                                                                       |
| `IncreaseVisiblePeriods`                      | Adds one visible period up to 10.                                                                                                                                                                                                                        |
| `DecreaseVisiblePeriods`                      | Removes one visible period down to 6.                                                                                                                                                                                                                    |
| `DismissError`                                | Clears planner `error`.                                                                                                                                                                                                                                  |

Grouped modal rule: opening settings, an override editor, or a custom editor
closes the other modal surfaces. A picker cannot open a second modal; only the
picker's own create action replaces it with the custom form.

## Empty states

- No enrollments or blocks in a term: the visible cells render empty.
- No intensive entries in the current year/term: `集中講義はありません`.
- No offered courses in the selected academic year: the grid still renders empty
  cells, so a custom course can be added for that year.
- All scheduled blocks are inside the visible range: the outside-range note is
  absent.
- No picker matches: `該当する科目がありません`.
- There is no W sidebar tab. W intensives render under A1 and A2, with
  `Wの集中講義はありません` when that subsection is empty.
- Missing requirement set: summary shows `要件: 要件セットが見つかりません`;
  invalid evaluation shows `要件: 要件を評価できません`.

## Errors and feedback

`UiError` has a target, a kind, and a Japanese message. Targets are general,
course, or offering. Kinds are:

- `DomainValidation`
- `SlotConflict`
- `NotOfferedInTerm`
- `UnknownOffering`
- `UnknownEnrollment`
- `MissingRequirementSet`
- `DifferentAcademicYear`
- `General`

`TimetableError` covers slot conflict, not offered in the selected term, and
unknown offering; it converts to `UiError`.

- Planner errors render in `#planner-error` with `role="alert"`.
- Successful selection, navigation, modal open/close, add/remove/undo, and form
  submission clear the planner error.
- `DismissError` clears it explicitly.
- Form validation errors are stored on the form (`error_field`,
  `error_message`) and keep the dialog open. They render with `role="alert"` and
  connect `aria-invalid` and `aria-describedby` to the offending control.
- A rejected form submission moves focus to the invalid control when one is
  available. After undo, focus returns to the restored course control if it is
  visible; otherwise it moves to the catalogue button.
- A rejected status or delete action keeps state unchanged and reports a
  planner error.
- `#requirement-summary` uses `role="status"` in the summary header; `#summary-error`
  is also a status.
- The undo toast is a `role="status"` surface and keyboard-reachable.

## Passed enrollments, overrides, and removal

One offering may have a different slot set in each active term. The timetable,
picker, detail, and conflict checks use the selected phase; addition checks every
phase atomically. It remains one enrollment with one status, grade, snapshot,
removal, and Undo. An offering-wide slot override replaces all active phases.

Distinct same-year offerings may share periods only with matching verified
coordination metadata and unchanged stored slots for the affected term.
Changing either allocation triggers ordinary conflict checks. Shared cells show
every enrollment, and detail identifies the verification source and the need to
check actual meeting dates. See [ADR-0009](adr/0009-term-specific-and-coordinated-allocations.md).

Passing an enrollment freezes its effective name and credits in
`PassedCourseSnapshot`. Later master edits and name/credit overrides do not
change the frozen values. The timetable, detail popup, catalogue, and summary
read the snapshot for passed enrollments.

Slot overrides are not applied to passed enrollments. The timetable and
catalogue use the offering's stored slots, and conflict checks compare those
frozen slots. The override editor shows an informational note for passed enrollments; the
course detail keeps the frozen values visible without repeating the explanation.

Removing an enrollment is allowed regardless of status. The exact previous
enrollment list is captured for one-step undo. Undo restores passed grades and
snapshots. The undo affordance expires after the next unrelated state change. There is
no general revision history.

## Custom courses and ids

Custom courses use the `user` namespace and session-local numbers:

- course: `course-N`;
- offering: `user-offering-N`.

A failed validation consumes no number. A deleted course's number is never
reused. Editing preserves ids. Deleting is allowed only when none of the
course's offerings are enrolled. The next number is session-local; Phase 3
persistence must replace it with a collision-safe allocator.

The custom form may assign the course to one of the active requirement set's
categories. The assignment is merged into the effective category table, so it
affects category credits and display. `未分類` is the default. Deleting the
custom course removes the assignment.

## Requirement profile and summary

`MandatoryCourses` appears as `必修`. It counts distinct passed courses in
confirmed mode, adds in-progress courses in standard mode, and adds planned
courses in optimistic mode. Failed and not-taken enrollments do not count.
The summary lists mandatory courses absent from the optimistic plan and
propagates each mode's result through parent rules. `AllCoursesPassed` keeps
its confirmed-only semantics. See [ADR-0010](adr/0010-mandatory-course-planning.md).

Available program and advancement-year choices come from
`RequirementSets::keys()`. They live in the settings dialog; the timetable grade
selector remains in the sidebar. The active set is always derived from the
profile; `PlannerState` stores no active requirement set. Selecting a profile is
one atomic state transition. A missing set keeps the profile, reports
`MissingRequirementSet`, and can be recovered by selecting a valid profile.

The summary uses these user-facing labels:

- `修得済` for passed credits;
- `履修中込` for passed plus in-progress credits;
- `履修予定込` for passed, in-progress, and planned credits.

The timetable identifies the selected academic year and term. On wide screens,
the header supplies this context; on narrower screens, it appears above the grid.
The summary
states that its totals cover enrollments across all grades and terms, regardless
of the timetable selection.

It shows:

- the three totals and category credits;
- one requirement tree with all three cumulative projections at every node;
- rule labels, status labels, progress text, remaining text, and one stacked bar
  with `合格済`, `履修中`, and `履修予定` segments;
- a legend that labels those three segments, plus a note that each cumulative
  stage includes the earlier stages.

The bar and its legend stop at the required amount. The note
`バーと凡例は必要数までの内訳です。` distinguishes those segments from
the uncapped cumulative progress shown in the rows and bar's accessible name.
On narrow screens, each projection uses two rows so the status, progress, and
remaining amount remain readable without horizontal scrolling.
The requirement tree uses nested lists to expose its parent-child structure to
assistive technology. The category table gives names more space on narrow screens.

Requirement status labels distinguish when the result is actually achieved:

- `達成` when the passed credits alone satisfy the requirement;
- `不足` when no projection satisfies it;
- `履修中で充足見込` when in-progress credits would satisfy it;
- `計画上充足` when planned credits would satisfy it.

The rule labels do not repeat a status word. The optimistic result supplies the
one-line `要件（履修予定込）: ...` status in the summary header.

Status and override changes are reflected on the next render because the summary
is derived, not cached.

## Testing and verification

- Model tests live in the `apps/web/app/planner_*_test.mbt` files, split by
  feature, and cover transitions, projections, frozen snapshots, custom ids,
  profile/year mapping, summary, and error paths.
- Playwright regressions live in
  `tests/integration/browser-display.test.mjs`,
  `tests/integration/browser.test.mjs`, and
  `tests/integration/browser-phase2.test.mjs`. The shared harness is
  `tests/integration/planner-harness.mjs`.
- `.agents/skills/verify/` drives the built page in Chromium and captures
  evidence under `.cache/verify/`.
- Browser tests fail on page errors and console errors. The Phase 2 journey
  captures a screenshot and trace on failure.

Run:

```sh
just test
just lint
just test-css
just test-browser
nix build path:.#web --no-link
```

## Out of scope

- persistence, reload recovery, sync, and history;
- Workers APIs, D1, Automerge, and network data;
- real university data;
- editing requirement rules;
- visual regression screenshots;
- Firefox and WebKit.
