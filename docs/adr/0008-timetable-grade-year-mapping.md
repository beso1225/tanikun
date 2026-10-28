# Timetable grades map to academic years from the advancement year

## Status

accepted

## Context

The planner shell can show one timetable year at a time. The profile has an
advancement year, defined in the Phase 1 contract as the year the student enters
the third year. That year selects the requirement set, but the timetable also
needs a grade and an academic year that move together.

A single timetable selector must show both values without creating
combinations outside the supported four-year span.

## Decision

Use the advancement year as grade 3:

| Grade | Academic year        |
| ----- | -------------------- |
| 1     | advancement year - 2 |
| 2     | advancement year - 1 |
| 3     | advancement year     |
| 4     | advancement year + 1 |

- `TimetableYear` stores the selected grade and academic year together.
- The timetable uses one grade selector. Each option shows both values, for
  example `3年（2026年度）`, so there is no second editable year control.
- Changing the grade updates the academic year through this mapping.
- Changing the requirement profile remaps the timetable year by preserving the
  selected grade.
- Scheduled blocks, off-grid entries, picker entries, and course placement are
  filtered by the selected academic year.
- Credit and requirement evaluation remain whole-plan; the timetable filter does
  not remove enrollments from credit totals.
- The selected term is preserved when the grade or academic year changes.
- A timetable year with no offerings shows an empty state instead of an empty
  grid.
- A newly created custom offering defaults to the selected timetable year.
- The custom course form lists the four timetable years. A course created for a
  year other than the displayed one is intentionally omitted from the current
  grid and appears in that year's picker.

## Consequences

- Grade 3 is the profile's advancement year, matching the Phase 1 meaning.
- Grades 1, 2, and 4 are derived from that anchor, so the four combined options
  stay consistent and the academic year is always visible.
- Timetable navigation and requirement-profile selection remain separate
  concepts even though both use `AcademicYear`.
- Future persistence must store both values or store the grade and the profile
  advancement year, not two independently editable years.
