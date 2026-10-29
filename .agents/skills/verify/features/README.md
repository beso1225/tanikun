# Feature map

Each file describes one user-facing planner surface, how to reach it, how to
drive it in Chromium, and what end state proves it works. Run `drive.mjs all` for one live path per feature. Extended recipes
remain in the map; a passing mode does not prove every sub-feature.

| Feature                      | File                                               |
| ---------------------------- | -------------------------------------------------- |
| Timetable and terms          | [timetable.md](timetable.md)                       |
| Enrollment status and grades | [enrollment-status.md](enrollment-status.md)       |
| Custom courses               | [custom-courses.md](custom-courses.md)             |
| Overrides                    | [overrides.md](overrides.md)                       |
| Summary, profile, and year   | [summary-profile-year.md](summary-profile-year.md) |

All journeys start from the deterministic `sample_state()` data. Selectors are
the production ids and roles in `apps/web/cmd/browser/view_*.mbt`; do not replace
them with coordinates or nth-child selectors.
