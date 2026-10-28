# Summary, profile, and year

## Sub-features

- three projection labels: 確定, 確定＋履修中, 確定＋履修中＋履修予定
- category credits and a requirement tree with all three projections
- program and advancement-year selectors in the settings dialog
- grade and timetable-year selector through the grade mapping
- missing requirement-set error and recovery
- summary recomputation after status or override changes

## How to get to it (user POV)

Read the `単位・要件` panel below the timetable. Open `設定` and use the
`プロファイル` selects there for program and advancement year. Use the
`時間割` grade select for the displayed year. Every requirement node shows
one stacked bar with `確定`, `確定＋履修中`, and `確定＋履修中＋履修予定` segments.

## Driving it with Playwright

- read `#summary-total-confirmed`, `#summary-total-standard`,
  `#summary-total-optimistic`
- read `#summary-categories` and `#summary-requirements`
- assert one `[data-requirement-bar]` per requirement node and the labels
  `確定`, `確定＋履修中`, and `確定＋履修中＋履修予定`
- open `#open-settings`; select `#program-select` = `applied-chemistry` and
  wait for `要件（確定＋履修中＋履修予定）: あと少し`
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
