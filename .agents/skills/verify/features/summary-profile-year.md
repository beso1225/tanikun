# Summary, profile, and year

## Sub-features

- three projection totals: confirmed, standard, optimistic
- category credits and requirement tree
- program and advancement-year selectors
- grade and timetable-year selector through the grade mapping
- missing requirement-set error and recovery
- summary recomputation after status or override changes

## How to get to it (user POV)

Read the `単位・要件` panel below the timetable. Use the `プロファイル` selects
in the sidebar for program and advancement year. Use the `時間割` grade select
for the displayed year. The requirement tree uses the optimistic projection.

## Driving it with Playwright

- read `#summary-total-confirmed`, `#summary-total-standard`,
  `#summary-total-optimistic`
- read `#summary-categories` and `#summary-requirements`
- select `#program-select` = `applied-chemistry` and wait for
  `要件: 部分充足`
- select `#year-select` = `2025`, then restore `2026`
- select `#grade-select` = `4` and wait for `#term-context` to include `2027年度`
- select grade `1` and wait for `#empty-year`

## Gotchas

- Program/advancement year selects the requirement profile; grade select
  controls timetable navigation. They are separate.
- Missing profiles keep the selection and show `要件: 要件セットが見つかりません`.
- The requirement tree shows the optimistic mode and uses 区分 vocabulary.
- The sidebar one-line summary and the panel share one `planner_summary()` call.
