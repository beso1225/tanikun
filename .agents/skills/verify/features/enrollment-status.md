# Enrollment status and grades

## Sub-features

- planned, in progress, passed, failed, and not-taken statuses
- passing grades 優上 / 優 / 良 / 可 / 合
- failing grades 不可 / 否
- status badges 予定 / 履修中 / 合格 / 不合格 / 未履修
- passed snapshots shown in the detail popup and timetable
- passed timetable slots come from the offering's stored slots
- undo after removing an enrollment
- undo expires on revision-changing user content, not on async persistence status

## How to get to it (user POV)

Click a course block. The detail dialog shows the current status controls.
Choose `合格`, then a grade. Close the dialog and read the block badge. Remove
an enrollment with `履修から削除`; use the bottom `元に戻す` toast.

## Driving it with Playwright

`drive.mjs enrollment-status` executes:

- click the `#timetable` block by its exact course name
- wait for `#course-detail-dialog`
- click `#status-passed`, then `#grade-good`; wait for
  `#grade-good[aria-pressed='true']`
- close with `#close-detail` and assert the tile contains `合格`
- assert the summary totals `2単位`, `2単位`, `6単位`
- reopen Physics Lab, click `#remove-detail`, assert the optimistic total drops
  to `5単位`
- click `#undo-removal-button`, assert the total returns to `6単位`, the tile
  returns with the `予定` badge, and focus returns to its detail control

Extended coverage, not executed by this mode:

- `tests/integration/browser-phase2.test.mjs` covers undo expiry after a term
  change and the broader status path
- `tests/integration/browser.test.mjs` covers dialog keyboard and focus behavior
- `tests/integration/browser-persistence.test.mjs` covers quick undo against a
  pending removal save

## Gotchas

- A passed course keeps the snapshot's name and credits. Later name or credit
  overrides do not change the passed display.
- Passed timetable slots use the offering's stored slots. For passed
  enrollments, conflict checks use those stored slots; the snapshot and a slot
  override do not move them. A slot override applied before passing is ignored
  while passed; this is existing behavior, not a new bug.
- The undo affordance expires on revision-changing user content. Async
  persistence status, save failure, and retry updates refresh the view without
  expiring it.
- `#override-passed-note` appears only inside the override editor, not in the
  detail dialog or timetable.
- `EnrollmentStatus` is not directly comparable in tests; use the public
  `is_passed` and snapshot accessors.
