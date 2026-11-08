# Custom courses

## Sub-features

- create a custom course from the catalogue picker or an empty-slot picker
- `#open-intensive-picker` creates an intensive custom course and returns to
  that picker
- new form prefills the current timetable year and selected term; day and period
  come from the clicked slot only, otherwise they default to Tuesday period 4
- regular multi-term selections must share one semester; YearLong and Intensive
  are separate schedules
- create a W intensive from A1 or A2; the current autumn tab stays selected and
  the added course appears in that tab's W subsection
- place the custom offering
- edit a custom course from its picker row; the form uses the stored offering's
  year, term, schedule, and slots
- custom course and offering IDs persist; only new IDs use the current session
  prefix
- delete only when unenrolled
- empty-name submission keeps the form open, shows `#custom-form-error`, and
  focuses `#custom-name`

## How to get to it (user POV)

Open `+ 科目` or an empty cell, then choose `独自科目を作成`. Fill the form and
submit. The picker returns to the context that opened it. A custom picker row
exposes `編集`; the edit form owns deletion.

## Driving it with Playwright

`drive.mjs custom-courses` executes:

- open `#open-catalogue-picker`, wait for `#picker`, click
  `#open-custom-course`
- assert `#custom-year` is `2026` and `#custom-term-s1` is pressed
- submit an empty name and assert the alert plus focus on `#custom-name`
- fill `#custom-name`, submit, add `[id^="add-offering-user-offering-"]`, and
  assert the timetable label
- reopen the picker, capture the `[id^="edit-custom-"]` id, open the editor,
  assert the stored name/year, rename, submit, and assert the edit id is
  unchanged and the timetable shows the new name
- switch to A1, create a W intensive from `#open-intensive-picker`, add it,
  close the picker, and assert A1 stays selected with the course in the
  `W（冬期）` subsection; reload and assert the persisted plan still shows both

Extended coverage, not executed by this mode:

- `tests/integration/browser-phase2.test.mjs` covers custom creation inside the
  full planner journey and the winter custom add/reload path
- `tests/integration/browser-display.test.mjs` covers a hidden custom course and
  range recovery
- `tests/integration/browser-persistence.test.mjs` covers deleting a custom
  course with overrides and reloading

## Gotchas

- IDs persist. Existing course and offering IDs stay stable across edit and
  reload; only newly created IDs use the session-scoped prefix from ADR-0012.
- A new form follows the current selection. An edit form follows the stored
  offering, not the current term or timetable year.
- Regular multi-term selections must be in the same semester. `通年` and
  `集中講義` are separate schedule choices.
- `編集` is only on picker rows. Do not expect it on timetable tiles.
- Deleting an enrolled custom course is blocked; remove the enrollment first.
- A selected category is merged into the active requirement set for category
  credits and display; `未分類` is the default.
- W has no sidebar tab. Creating or saving a W intensive keeps the current A1
  or A2 tab and falls back to A1 from S1, S2, or a stored W selection. The
  offering keeps `Semester::W` and no slots, so the course is visible in the W
  subsection immediately after adding.
