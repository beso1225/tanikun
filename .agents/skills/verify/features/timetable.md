# Timetable and terms

## Sub-features

- term-specific slots in one enrollment, including later-phase conflict checks
- source-backed shared cells with independently actionable course controls
- fictional allocation journey: run `moon run scripts/build-allocation-fixture.mbtx`
  followed by `node --test tests/integration/browser-allocations.test.mjs` inside
  `nix develop`; its owned browser and server close after the journey

- four sidebar term tabs: S1, S2, A1, A2
- W intensives grouped under A1 and A2
- five-to-seven weekday columns and six-to-ten period rows
- scheduled course blocks with status badges
- off-grid intensive entries
- an always-rendered grid when the selected timetable year has no offerings
- W without a weekday grid
- settings dialog for visible range

## How to get to it (user POV)

Open the page. The S1 timetable is visible. Use the `学年` with option `3年（2026年度）`
select to change timetable year, the term tabs to change term, and `設定` to
change visible days or periods.

## Driving it with Playwright

- wait for `heading 応物単位くん`
- assert `nav button` count is 4
- click `#term-S2`, wait for `heading S2`, then click `#term-S1`
- read `#timetable` and `#off-grid`
- open `#open-settings`, change `#add-day` or `#add-period`, close with
  `#close-settings`
- select `#grade-select` option `1`; `#timetable` remains and an empty cell can
  open the slot picker

## Gotchas

- W has no sidebar tab and no weekday grid; its intensives appear under the
  A1/A2 `W（冬期）` subsection.
- The visible year is derived from the grade mapping; changes clear the selected
  offering and picker.
- The initial sample has enrolled 2026 entries but no 2027 enrollments.

At 390px, document scroll width must not exceed viewport width. Open details
using `[id^="mobile-detail-"]`, press Escape, and verify focus restoration.
`#timetable-scope` shows year and term below 1024px. Hidden enrollments appear
in `#hidden-blocks`; `#open-hidden-settings` opens range controls. Expanding
the range reveals the course and removes the notice. The setup is executable
in `tests/integration/browser-display.test.mjs`.
