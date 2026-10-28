# Summary, profile, and year

## Sub-features

- three projection labels: 確定, 履修中まで, 履修予定まで
- category credits and a requirement tree with all three projections
- program and advancement-year selectors in the settings dialog
- grade and timetable-year selector through the grade mapping
- missing requirement-set error and recovery
- summary recomputation after status or override changes

## How to get to it (user POV)

Read the `単位・要件` panel below the timetable. Open `設定` and use the
`プロファイル` selects there for program and advancement year. Use the
`時間割` grade select for the displayed year. Every requirement node shows
`確定`, `履修中まで`, and `履修予定まで` progress bars.

## Driving it with Playwright

- read `#summary-total-confirmed`, `#summary-total-standard`,
  `#summary-total-optimistic`
- read `#summary-categories` and `#summary-requirements`
- assert three `progress` bars per requirement node and the labels
  `確定`, `履修中まで`, and `履修予定まで`
- open `#open-settings`; select `#program-select` = `applied-chemistry` and
  wait for `要件: あと少し`
- select `#year-select` = `2025`, then restore `2026`
- close with `#close-settings`
- select `#grade-select` = `4` and wait for `#term-context` to include `2027年度`
- select grade `1`; `#timetable` remains for custom-course placement

## Gotchas

- Program/advancement year selects the requirement profile; grade select
  controls timetable navigation. They are separate.
- Missing profiles keep the selection and show `要件: 要件セットが見つかりません`.
- The requirement tree shows all three modes and uses 区分 vocabulary.
- Profile controls are only in the settings dialog; grade remains in the
  sidebar.
- `#requirement-summary` is the optimistic one-line status in the summary
  header, not the settings dialog.
