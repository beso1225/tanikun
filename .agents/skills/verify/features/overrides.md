# Overrides

## Sub-features

- display-name override on a course
- credit override on a course
- one-slot override on an offering
- removal of individual overrides or all overrides
- passed enrollments keep frozen name and credits
- passed timetable slots and conflict checks use the offering's stored slots
- `#override-passed-note` appears only in the override editor
- editor fields change with the schedule; intensive offerings do not expose the
  slot toggle

## How to get to it (user POV)

Click a course block and choose `カスタマイズ`. Change the name, credits, or
toggle the slot override. Save. The timetable, catalogue, and detail use the
effective values. A passed course shows an informational note in the override
editor.

## Driving it with Playwright

`drive.mjs overrides` executes:

- open Physics I, mark it passed with `#status-passed` and `#grade-good`, and
  close the detail
- assert `#override-passed-note` is absent outside the editor
- reopen Physics I, open `#open-override-editor`, assert
  `#override-passed-note` is visible, then close the editor and detail
- open Physics Lab, click `#open-override-editor`, fill `#override-name`, submit
  `#override-submit`, assert the detail title, close, and assert the timetable
  label

Extended coverage, not executed by this mode:

- `tests/integration/browser-phase2.test.mjs` covers a name and slot override
  in the full planner journey
- `tests/integration/browser-display.test.mjs` covers a conflicting slot
  override and field error focus
- `tests/integration/browser-persistence-convergence.test.mjs` covers overrides
  surviving local replica convergence

## Gotchas

- Slot conflict checks compare offerings in the same academic year.
- Passed name and credits come from the passed snapshot. Passed slots use the
  offering's stored slots; conflict checks use those stored slots for passed
  enrollments. A slot override applied before or after passing does not move a
  passed block; this is existing behavior, not a new bug.
- `#override-passed-note` is only in the override editor; the detail dialog and
  timetable do not repeat it.
- Clear names with an empty field, credits with the default empty option, and
  slots by disabling the toggle. Remove-all applies to the edited course and
  offering, not every course.
- The override editor's visible fields change with the schedule; an intensive
  offering does not expose the slot toggle.
