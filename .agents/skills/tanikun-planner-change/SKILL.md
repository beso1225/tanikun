---
name: tanikun-planner-change
description: "Change Tanikun's planner model or browser UI. Use for apps/web transitions, projections, views, responsive layout, dialogs, or planner refactors; use tanikun-moonbit-change for pure packages."
---

# Tanikun planner change

Read the current contracts before changing behavior:
[Phase 2 planner contract](../../../docs/PHASE_2.md),
[accessibility baseline](../../../docs/ACCESSIBILITY.md), and, for persistence
or sync-adjacent work, [ADR-0011](../../../docs/adr/0011-local-planner-persistence.md),
[ADR-0012](../../../docs/adr/0012-automerge-planner-document.md),
[ADR-0013](../../../docs/adr/0013-http-sync-protocol.md),
[ADR-0014](../../../docs/adr/0014-local-development-auth.md), and
[D1 sync storage](../../../docs/SYNC_STORAGE.md). Phase 2 is no longer the whole
contract: Phase 3 owns local persistence and Phase 4 owns local HTTP sync.
Inspect the feature's model, view, and tests together, and keep a UI change out
of storage and sync ownership unless the task names that boundary.

## Find the owner

- MoonBit planner model: `apps/web/app/planner_state.mbt` owns source and UI
  state; `planner_transitions.mbt` routes messages. Feature operations live in
  `planner_custom.mbt`, `planner_overrides.mbt`, and `planner_profile.mbt`.
- MoonBit projections: `planner_projections.mbt` derives display rows and
  blocks; `planner_summary.mbt` owns summaries, category names, and credit
  formatting. Reuse `credits_label` / `half_units_label` instead of copying
  `.5` logic.
- Persistence model: `planner_persistence_schema.mbt`,
  `planner_persistence_records.mbt`, and `planner_persistence_restore.mbt`
  validate and rebuild source state. The runtime transaction lifecycle is
  `apps/web/public/persistence-transactions.js`; the compare-and-set and handle
  boundary is `persistence.js`; `planner-document.js` owns the Automerge codec.
- Views: `apps/web/cmd/browser/view_*.mbt` renders feature views. `main.mbt` owns
  the entry point and root composition, computing summary and category names once
  per render. Pass those values down instead of recomputing them per row.
- Sync: the browser transport, outbox, metadata, coordinator, Worker, D1, and
  local auth belong to `tanikun-sync-change`. Do not duplicate their procedures
  here.
- Tests: model tests are `apps/web/app/planner_<feature>_test.mbt`, with shared
  fixtures in `planner_test_support_test.mbt`. Browser suites share
  `tests/integration/planner-harness.mjs`.

Keep totals, requirement evaluation, and effective display values derived.
Passed enrollment display freezes names and credits from the snapshot. Slots
come from the offering's stored slots, not the snapshot or slot overrides.
Rendering and conflict checks must use those frozen display values. An override on a passed
course must explain why the visible enrollment remains frozen.

## Change and prove

For a behavior change, first reproduce it in the focused model or browser test
when practical. For a refactor, keep selectors, fixture expectations, and
behavior stable. Moving files alone does not finish a consolidation: search
for duplicate helpers and verify every linked issue's acceptance criteria
before using a closing keyword in the PR.

Run commands inside `nix develop`:

```sh
just test
just lint
just test-browser
```

For CSS or responsive changes also run `just test-css`. The browser command
builds the static page and includes display, shell, and Phase 2 journeys. Its
sync status suite uses a fake API, so it does not prove real convergence.
Use [verify](../verify/SKILL.md) for independent mapped journeys and evidence.

For a persistence change, `just test` covers the storage and coordinator
suites. For a sync, Worker, D1, or local auth change, use
`tanikun-sync-change` and its real harness instead of adding a second browser
procedure.

For UI changes, inspect the resulting screen at desktop and phone widths
(including 390px). Exercise long labels, changed grade and term, and expanded
day/period ranges. Neither the document nor timetable should require
horizontal scrolling; shortening visible labels must preserve full accessible
names. Check keyboard opening, focus trapping, Escape, focus restoration, and
Undo restoration on the affected dialog path.

Chromium accessibility checks do not prove screen-reader speech. Requirement
lists need explicit list semantics when CSS removes markers; inspect root
and nested lists. Actual assistive-technology audio verification is tracked
separately in #103. Report automated, visual, keyboard, and audio evidence
according to what was actually exercised.

Update the verification feature map when entry points or prerequisites change.
Use `tanikun-docs-update` for contract changes and `tanikun-moonbit-change`
plus `tanikun-mutation-refresh` when the change reaches the pure packages.

For the historical evidence behind these choices, read
[Phase 2 maintenance decisions](references/phase2-lessons.md).
