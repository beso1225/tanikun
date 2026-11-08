# Feature map

Each file describes one user-facing planner surface, how to reach it, how to
drive it in Chromium, and what end state proves it works. `drive.mjs all` runs
one live path for each file; a passing mode does not prove every sub-feature.
The extended coverage column names the tests that cover the rest.

| Feature                      | File                                               | `drive.mjs` mode       | Extended coverage                                                                                                                |
| ---------------------------- | -------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Timetable and terms          | [timetable.md](timetable.md)                       | `timetable`            | `browser-display`, `browser`, `browser-allocations`                                                                              |
| Enrollment status and grades | [enrollment-status.md](enrollment-status.md)       | `enrollment-status`    | `browser-phase2`, `browser`, `browser-persistence`                                                                               |
| Custom courses               | [custom-courses.md](custom-courses.md)             | `custom-courses`       | `browser-phase2`, `browser-display`, `browser-persistence`                                                                       |
| Overrides                    | [overrides.md](overrides.md)                       | `overrides`            | `browser-phase2`, `browser-display`, `browser-persistence-convergence`                                                           |
| Summary, profile, and year   | [summary-profile-year.md](summary-profile-year.md) | `summary-profile-year` | `browser`, `browser-allocations`, `planner_profile_test.mbt`                                                                     |
| Local persistence            | [local-persistence.md](local-persistence.md)       | `local-persistence`    | `browser-persistence`, `browser-persistence-convergence`, `planner_persistence_test.mbt`, `planner_persistence_fixture_test.mbt` |

`browser*` names are `tests/integration/browser*.test.mjs`; `*.mbt` names are
under `apps/web/app/`.

`drive.mjs all` is static-only. It starts its own loopback static server and
Chromium; it does not start a Worker, D1, or the fixed sync origin. The
unconfigured page shows `同期未設定`, which is not HTTP sync evidence.
Configured sync status, outbox, network, convergence, and fault verification
route to the sibling `tanikun-sync-change` skill at
`../tanikun-sync-change/SKILL.md` and `just test-sync`.

All journeys start from the deterministic `sample_state()` data. Selectors are
the production ids and roles in `apps/web/cmd/browser/view_*.mbt`; do not replace
them with coordinates or nth-child selectors.

`drive.mjs` fails when a feature file has no mode or a mode has no feature file.
Keep the six-entry set explicit when adding a feature.
