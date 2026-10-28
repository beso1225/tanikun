# Overrides

## Sub-features

- display-name override on a course
- credit override on a course
- one-slot override on an offering
- removal of individual overrides or all overrides
- passed enrollments keep frozen name, credits, and timetable slot
- conflict checks use the frozen slot for passed enrollments

## How to get to it (user POV)

Click a course block and choose `カスタマイズ`. Change the name, credits, or
toggle the slot override. Save. The timetable, catalogue, and detail use the
effective values. A passed course shows an informational frozen-display note.

## Driving it with Playwright

- open a block and `#course-detail-dialog`
- click `#open-override-editor`
- fill `#override-name`, select `#override-credits`, or toggle
  `#override-slots-enabled` and set `#override-day` / `#override-period`
- submit `#override-submit`; use `#remove-overrides` to clear all
- assert the timetable label/slot and `#summary` values
- for passed Physics I, assert `#override-passed-note`

## Gotchas

- Slot conflict checks only compare offerings in the selected academic year.
- Passed slots are frozen; saving a slot override on a passed course does not
  move the block and skips the no-op conflict re-check.
- The override editor's visible fields change with the schedule; an intensive
  offering does not expose the slot toggle.
