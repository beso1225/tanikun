# Map timetable grades to academic years

## Status

Accepted.

## Context

The planner shell can show one timetable year at a time. The profile has an
advancement year, defined in the Phase 1 contract as the year the student enters
the third year. That year selects the requirement set, but the timetable also
needs a grade and an academic year that move together.

The grade and academic-year selectors must not create combinations outside the
supported four-year span.

## Decision

Use the advancement year as grade 3:

| Grade | Academic year        |
| ----- | -------------------- |
| 1     | advancement year - 2 |
| 2     | advancement year - 1 |
| 3     | advancement year     |
| 4     | advancement year + 1 |

- `TimetableYear` stores the selected grade and academic year together.
- Changing the grade updates the academic year, and changing the academic year
  updates the grade, using this mapping.
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

## Consequences

- Grade 3 is the profile's advancement year, matching the Phase 1 meaning.
- Grades 1, 2, and 4 are derived from that anchor, so the four year options stay
  consistent.
- Timetable navigation and requirement-profile selection remain separate
  concepts even though both use `AcademicYear`.
- Future persistence must store both values or store the grade and the profile
  advancement year, not two independently editable years.
