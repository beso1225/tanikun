# Enrollment status and grades

## Sub-features

- planned, in progress, passed, failed, and not-taken statuses
- passing grades 優上 / 優 / 良 / 可 / 合
- failing grades 不可 / 否
- passed snapshots shown in the detail popup and timetable
- undo after removing an enrollment

## How to get to it (user POV)

Click a course block. The detail dialog shows the current status controls.
Choose `合格`, then a grade. Close the dialog and read the block badge. Remove
an enrollment with `履修から削除`; use the bottom `元に戻す` toast.

## Driving it with Playwright

- click the `#timetable` block by its exact course name
- wait for `#course-detail-dialog`
- click `#status-passed`, then `#grade-good`; wait for
  `#grade-good[aria-pressed='true']`
- close with `#close-detail` and assert the block badge
- reopen the course detail, then click `#remove-detail`; wait for `#undo-removal`; click
  `#undo-removal-button` and wait for the tile to return

## Gotchas

- A passed course keeps its snapshot; later name/credit/slot overrides do not
  change the timetable display.
- The undo affordance expires after the next unrelated state change.
- `EnrollmentStatus` is not directly comparable in tests; use the public
  `is_passed` and snapshot accessors.
