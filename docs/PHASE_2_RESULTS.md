# Phase 2 results

Phase 2 is complete. It adds a local, in-memory planner UI on top of the pure
Phase 1 model.

## Done criterion

The [initial design](INITIAL_DESIGN.md#phase-2--時間割ui) defines Phase 2 Done
as passing the main user flows in Playwright. The browser suites below cover
those flows against the built static page, and the verify skill drives the same
built page independently.

The implementation contract is in [PHASE_2.md](PHASE_2.md).

## What Phase 2 provides

- a responsive timetable shell with S1, S2, A1, and A2 tabs; W intensives are
  grouped under A1/A2
- term-specific slots within one enrollment, with conflict checks across all
  active terms
- source-backed coordinated allocations with separate controls in shared cells
- catalogue and slot pickers for planned enrollment
- enrollment status and passing/failing grade editing
- frozen passed snapshots, including frozen timetable slots
- custom courses and offerings with optional category assignment
- name, credit, and slot overrides
- one-step undo for enrollment removal
- grade and academic-year navigation using the advancement-year mapping
- program and advancement-year selection in the settings dialog
- confirmed, in-progress-inclusive, and planned-inclusive totals
- category credits and a cumulative requirement tree with stacked progress bars
- projected mandatory-course counts under `必修`, including names of required
  courses absent from the plan
- accessible dialogs, live status regions, keyboard paths, and sticky table
  headers

## Browser evidence

Run the browser suites from the repository root:

```sh
nix develop -c just test-browser
```

`just test-browser` builds the static page and the fictional allocation fixture,
then runs five Chromium tests across four files:

- [`browser-display.test.mjs`](../tests/integration/browser-display.test.mjs):
  hidden-course slot labels and display settings, plus half-credit labels
- [`browser.test.mjs`](../tests/integration/browser.test.mjs): the broad shell,
  accessibility audit, responsive layout, dialogs, status changes, custom
  courses, overrides, and summary behavior
- [`browser-phase2.test.mjs`](../tests/integration/browser-phase2.test.mjs): the
  deterministic Phase 2 journey covering scheduled and intensive adds, removal,
  a passed grade, a custom course, name and slot overrides, all three totals,
  and a requirement result
- [`browser-allocations.test.mjs`](../tests/integration/browser-allocations.test.mjs):
  term-specific slot counts, actionable shared cells, mandatory projections,
  removal and Undo with focus restoration, and the 390px layout

All four files use the shared
[planner harness](../tests/integration/planner-harness.mjs) static server. The
shell, Phase 2 journey, and allocation suites also collect page errors and console
errors and assert the list is empty. The Phase 2 and allocation journeys preserve
a screenshot and trace under `.cache/verify/` on failure. The display suite
currently uses only the harness server and does not yet capture failure artifacts.

The allocation fixture uses an isolated generated workspace with its own
dependencies. Linux CI installs Warren before building the fixture and running
its browser test. The fixture contains no real university or enrollment data.

The local verification skill is in
[`.agents/skills/verify/`](../.agents/skills/verify/SKILL.md):

```sh
nix develop -c node .agents/skills/verify/scripts/doctor.mjs
nix develop -c node .agents/skills/verify/scripts/drive.mjs timetable
```

## Model evidence

Model tests are split by feature:

- [`planner_terms_test.mbt`](../apps/web/app/planner_terms_test.mbt)
- [`planner_timetable_test.mbt`](../apps/web/app/planner_timetable_test.mbt)
- [`planner_enrollment_test.mbt`](../apps/web/app/planner_enrollment_test.mbt)
- [`planner_custom_test.mbt`](../apps/web/app/planner_custom_test.mbt)
- [`planner_override_test.mbt`](../apps/web/app/planner_override_test.mbt)
- [`planner_profile_test.mbt`](../apps/web/app/planner_profile_test.mbt)
- [`planner_summary_test.mbt`](../apps/web/app/planner_summary_test.mbt)
- [`planner_allocations_test.mbt`](../apps/web/app/planner_allocations_test.mbt):
  phased conflicts, coordinated allocations, overrides, and enrollment identity
- [`planner_mandatory_test.mbt`](../apps/web/app/planner_mandatory_test.mbt):
  mandatory projections, parent satisfaction, missing courses, and profile changes
- shared fixtures in
  [`planner_test_support_test.mbt`](../apps/web/app/planner_test_support_test.mbt)
- the pre-existing Rabbita demo model in
  [`model_test.mbt`](../apps/web/app/model_test.mbt), which contributes two tests
  to the same package run

Run them with:

```sh
nix develop -c just test
```

The pure-package tests also cover phase validation and coordination in
[`offering_phases_test.mbt`](../packages/domain/offering_phases_test.mbt), and
projected membership in
[`mandatory_test.mbt`](../packages/requirements/mandatory_test.mbt).

`just test` currently reports 236 passing MoonBit tests across the API, domain,
requirements, and web app packages, plus the JavaScript export test. The total
includes the two demo-model tests.

## In-memory boundary

Phase 2 keeps the planner in memory. There is no persistence, reload recovery,
network API, IndexedDB, Automerge connection, or multi-device sync in
`apps/web`. Reloading the page discards the planner.

`PlannerState` stores source data and UI state only. Credit totals, category
credits, requirement results, catalogue rows, scheduled blocks, and category
names are derived. The summary is evaluated once per render, and category names
are built once per render for the view.

The one-step undo list is the only retained previous state. It expires after the
next unrelated state change and is not a revision history.

## Scope limits

- fixtures are fictional; there is no real university import
- Chromium is the only browser target for Phase 2
- there are no visual regression screenshots
- custom categories assign existing requirement categories; they do not create
  new requirement rules
- W has no sidebar tab and no weekday grid; its intensives render under A1/A2
- persistence, history, sync, authentication, and deployment remain later-phase
  work

## Mutation evidence

The pure-package baseline is in [MUTATION.md](MUTATION.md):

| Package      | Mutants | Killed | Survived | Timeout |  Score |
| ------------ | ------: | -----: | -------: | ------: | -----: |
| domain       |     167 |    166 |        0 |       1 | 99.40% |
| requirements |     238 |    222 |       15 |       1 | 93.28% |

The baseline was refreshed on 2026-10-30 after the term-specific allocation,
coordination, and mandatory-planning changes for #111, #112, and #113. No new
survivors were accepted. Mutation remains local evidence, not a CI gate.

## Verification

- Phase 2 milestone issues #50 through #71 and the implementation refactor
  #87 / #97 / #98 / #99 are closed.
- `just test` passes with 236 MoonBit tests and the JavaScript export test.
- `just test-browser` passes five Chromium tests across four files.
- `just lint` and `just test-css` pass.
- `nix build path:.#web path:.#pure --no-link` passes locally.
- Linux CI runs the Nix checks, the browser suites, and the remaining Worker
  spikes.
- Both GitHub Actions runs for `f26bc3b` passed `linux` and `lint`, including
  the allocation fixture and the Worker, Automerge, and D1 tests.
- No persistence or sync code was added to the planner.

## Next phase

Phase 3 starts local-first persistence with Automerge and IndexedDB. Phase 2's
in-memory state is the input to that work, not a storage contract.
