# Summary, profile, and year

## Sub-features

- three cumulative projection labels: 修得済, 履修中込, 履修予定込
- category credits and a requirement tree with all three projections
- one stacked bar per requirement node with 合格済, 履修中, and 履修予定 legend
  chips
- status labels 達成, 不足, 履修中で充足見込, and 計画上充足
- program and advancement-year selectors in the settings dialog
- grade and timetable-year selector through the grade mapping
- summary covers all grades and terms
- summary recomputation after status or override changes
- projected mandatory membership and the list of courses absent from the plan;
  covered by `browser-allocations.test.mjs` with the isolated fictional fixture

## How to get to it (user POV)

Read the `単位・要件` panel below the timetable. Open `設定` and use the
`プロファイル` selects there for program and advancement year. Use the
`時間割` grade select for the displayed year. Every requirement node shows one
stacked bar with `合格済`, `履修中`, and `履修予定` segments.

## Driving it with Playwright

`drive.mjs summary-profile-year` executes:

- assert `#summary-scope` contains `すべての学年・学期`
- assert three `[data-requirement-bar]` nodes and the three legend labels
- assert `#requirement-summary` has `role="status"` and reads
  `要件（履修予定込）: 計画上充足`
- open `#open-settings`; select `#program-select` = `applied-chemistry` and
  wait for `要件（履修予定込）: 不足`
- restore `#program-select` = `applied-physics`, then select `#year-select` =
  `2025`, then restore `2026`
- close with `#close-settings`
- select `#grade-select` = `4` and wait for `#term-context` to include
  `2027年度`
- assert totals remain `0単位`, `0単位`, `6単位`

Extended coverage, not executed by this mode:

- `tests/integration/browser.test.mjs` covers the full requirement tree,
  category credits, bar labels, and profile controls
- `tests/integration/browser-allocations.test.mjs` covers missing mandatory
  courses with the fictional fixture
- `apps/web/app/planner_profile_test.mbt` covers the missing-profile branches

## Gotchas

- The profile program and advancement year select the requirement set. The
  displayed grade and timetable year are separate; changing the grade does not
  change the profile.
- The summary aggregates all grades and terms; `#summary-scope` states that.
- A missing advancement year keeps the selection, shows
  `要件: 要件セットが見つかりません` in the summary, and explains the missing
  set in the planner error.
- Selecting a program with no requirement set keeps the old profile and shows a
  planner error; the previous profile still evaluates.
- The sample UI cannot select a year or program without a requirement set. The
  missing advancement-year and missing-program branches are
  `verified-unreachable` here: `#year-select` has only 2025 and 2026 for applied
  physics, and both sample programs have sets. Cover them in
  `planner_profile_test.mbt`, not by inserting a fake option or internal setter.
- Profile controls are only in the settings dialog; grade remains in the
  sidebar.
- `#requirement-summary` is the optimistic one-line status in the summary
  header, not the settings dialog.
