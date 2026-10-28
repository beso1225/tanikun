# Timetable and terms

## Sub-features

- five term tabs: S1, S2, A1, A2, W
- five-to-seven weekday columns and six-to-ten period rows
- scheduled course blocks with status badges
- off-grid intensive entries
- empty-year state when the selected timetable year has no offerings
- settings dialog for visible range

## How to get to it (user POV)

Open the page. The S1 timetable is visible. Use the sidebar `学年 (2026年度)`
select to change timetable year, the term tabs to change term, and `設定` to
change visible days or periods.

## Driving it with Playwright

- wait for `heading 応物単位くん`
- assert `nav button` count is 5
- click `#term-S2`, wait for `heading S2`, then click `#term-S1`
- read `#timetable` and `#off-grid`
- open `#open-settings`, change `#add-day` or `#add-period`, close with
  `#close-settings`
- select `#grade-select` option `1` and wait for `#empty-year`

## Gotchas

- W has no grid; `#timetable` is absent and the W message replaces it.
- The visible year is derived from the grade mapping; changes clear the selected
  offering and picker.
- The initial sample has enrolled 2026 entries but no 2027 enrollments.
