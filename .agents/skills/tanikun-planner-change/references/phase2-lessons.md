# Phase 2 maintenance decisions

Read this when reassessing the planner workflow. These records explain why the
skill points to existing owners and tests rather than adding blanket rules.

| Mistake class                                            | Evidence                                                                                                                              | Chosen enforcement                                                            | Why not a higher level                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| UI proof misses narrow-screen behavior                   | #101 responsive changes, #102 review of wrapped headers and duplicated scope                                                          | Existing display and shell browser tests, plus the mapped 390px journey       | Types cannot establish rendered width or focus behavior                                 |
| Verification instructions drift from executable behavior | Enrollment map omitted reopening detail; profile map requested 2025 while chemistry offers only 2026; driver supported only timetable | Executable modes for every mapped feature, map/mode agreement check, Linux CI | Product architecture already supports these paths; the verification procedure was wrong |
| Formatting and derived values acquire multiple owners    | #104 review found repeated half-unit logic in app and view, plus a test-only category lookup                                          | Canonical app formatter, view delegation, existing model tests                | The ownership consolidation already landed; a new syntax lint would duplicate it        |

The pre-maintenance timetable-only coverage fails the new map/mode agreement
check. Current five-mode coverage passes. This is a coverage check, not a claim
that every extended recipe or assistive-technology combination is automated.

Issue acceptance remains a review judgment. In #104, a move-only refactor did
not satisfy helper-consolidation acceptance until the shared owner was fixed.
The PR skill therefore checks acceptance before closing linked issues.

Review sources:

- [PR #101](https://github.com/beso1225/tanikun/pull/101)
- [PR #102 review](https://github.com/beso1225/tanikun/pull/102#pullrequestreview)
- [PR #104 review](https://github.com/beso1225/tanikun/pull/104#pullrequestreview)
