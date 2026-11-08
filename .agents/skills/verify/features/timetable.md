# Timetable and terms

## Sub-features

- four sidebar term tabs: S1, S2, A1, A2
- W intensives grouped under A1 and A2
- five-to-seven weekday columns and six-to-ten period rows
- scheduled course blocks with status badges: 予定, 履修中, 合格, 不合格, 未履修
- off-grid intensive entries
- hidden scheduled-block notice and display-range settings
- an always-rendered grid when the selected timetable year has no offerings
- term-specific slots in one enrollment, including later-phase conflict checks
- source-backed shared cells with independently actionable course controls
- fictional allocation journey: run `moon run scripts/build-allocation-fixture.mbtx`
  followed by `node --test tests/integration/browser-allocations.test.mjs` inside
  `nix develop`; its owned browser and server close after the journey

## How to get to it (user POV)

Open the page. The S1 timetable is visible. Use the `学年` select with option
`3年（2026年度）` to change timetable year, the term tabs to change term, and
`設定` to change visible days or periods.

## Driving it with Playwright

`drive.mjs timetable` executes:

- wait for `heading 応物単位くん`
- assert `nav button` count is 4
- click `#term-S2`, wait for `heading S2`, then click `#term-A1`
- assert `#off-grid` shows `W（冬期）` and `Winter Workshop`, then repeat for A2
- return to S1 and assert the Physics I tile contains the `予定` badge
- at 390px assert document scroll width does not exceed the viewport
- open `[id^="mobile-detail-phy101-s1"]`, press Escape, and assert focus returns
  to the mobile detail control

Extended coverage, not executed by this mode:

- `tests/integration/browser-display.test.mjs` creates a Saturday period 7
  custom course, checks `#hidden-blocks`, and expands the range
- `tests/integration/browser.test.mjs` covers keyboard navigation, dialog focus,
  summary bars, and display ranges
- `tests/integration/browser-allocations.test.mjs` covers the fictional
  allocation fixture

## Gotchas

- W is not a sidebar tab. The normal UI cannot select W; winter intensives are
  listed under A1 and A2. Do not assert a W grid state from the user path. A
  crafted persisted `selected_term: W` is outside this journey.
- The hidden-block notice counts scheduled blocks, not distinct enrollments. One
  enrollment can contribute more than one hidden block.
- The visible year is derived from the grade mapping; changes clear the selected
  offering and picker.
- The initial sample has enrolled 2026 entries but no 2027 enrollments.
- The mobile nav source declares five grid columns for four tabs. The journey
  checks document overflow, not column balance; visual inspection decides
  whether this is a product issue.
- `#timetable-scope` shows year and term below 1024px.
