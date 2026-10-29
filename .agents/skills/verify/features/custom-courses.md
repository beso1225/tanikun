# Custom courses

## Sub-features

- create a custom course from the catalogue picker
- prefill day, period, term, and selected timetable year
- place the custom offering
- edit a custom course without changing its ids
- delete only when unenrolled

## How to get to it (user POV)

Open `+ 科目` or an empty cell, then choose `独自科目を作成`. Fill the form and
submit. The picker returns to the context that opened it. A custom row exposes
`編集`; the edit form owns deletion.

## Driving it with Playwright

- open `#open-catalogue-picker`, wait for `#picker`, click
  `#open-custom-course`
- fill `#custom-name`, choose `#custom-year` and `#custom-category`, submit with
  `#custom-submit`
- add `#add-offering-user-offering-1`
- open `#edit-custom-user-offering-1` to edit; use `#delete-custom-course`
  only after removing any enrollment
- an empty cell uses `#slot-0-3` and returns to a slot picker

## Gotchas

- IDs use the `user` namespace and are session-local.
- A selected category is merged into the active requirement set for category
  credits and display; `未分類` is the default.
- The form year follows the selected timetable year.
- Deleting an enrolled custom course is blocked; remove the enrollment first.

Another entry is `#open-intensive-picker`; custom creation returns to that
picker. Regular supports multiple terms; YearLong and Intensive are separate
schedule choices. Empty-name submission keeps the form open, shows
`#custom-form-error[role=alert]`, and focuses the invalid `#custom-name`.
