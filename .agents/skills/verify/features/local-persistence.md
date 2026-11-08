# Local persistence

## Sub-features

- user-visible `#persistence-status` with `role="status"` and labels `保存済み`,
  `未保存`, `保存中`, `保存失敗`, and `読み込み失敗`
- source edits save to IndexedDB and survive reload
- UI-only state (open dialog, picker, query, selected offering, undo) is not
  persisted; restore resets it
- load failure is read-only and keeps the seed; save failure keeps the edit
  visible and retryable
- quick undo wins over a pending removal save; async persistence status does not
  expire undo
- legacy JSON migrates on the next edit without changing source state
- stale tabs fail closed instead of overwriting a newer committed plan
- isolated local replicas merge and converge through the test API

## How to get to it (user POV)

Open the page and read the status at the top right. Add a course and watch the
status move through `未保存` and `保存中` to `保存済み`. Reload the page. The
course remains. If storage fails, the page shows `保存失敗` or `読み込み失敗`
and keeps the relevant recovery guidance.

## Driving it with Playwright

`drive.mjs local-persistence` executes:

- clear IndexedDB, reload, wait for `保存済み`, and assert the status role
- install a MutationObserver on `#persistence-status`, then add the `phy302-s`
  offering
- wait for a non-saved label (`未保存` or `保存中`) and then `保存済み`; assert
  the timetable shows `Seminar S2` and the optimistic total is `7単位`
- reload, wait for `保存済み`, assert `Seminar S2` and `7単位` remain, and assert
  no `#planner-error`

The observer reads the user-visible status region only. The journey does not
read `globalThis.tanikunStorage` or committed bytes.

Extended coverage, not executed by this mode:

- `tests/integration/browser-persistence.test.mjs` covers load/save failure,
  retry, migration, aborted writes, quick undo, and custom deletion
- `tests/integration/browser-persistence-convergence.test.mjs` covers isolated
  replicas, stale tabs, and simultaneous first-open seeding
- `apps/web/app/planner_persistence_test.mbt` and
  `planner_persistence_fixture_test.mbt` cover the model and source round trips

## Gotchas

- The driver clears `tanikun-planner` IndexedDB before each mode. Never run it
  against a planner you want to keep.
- `保存中` is delayed; `未保存` can be brief. Observe the status region instead
  of reading storage internals.
- A reload proves only the last committed document. The mode waits for
  `保存済み` after a non-saved label before reloading.
- Local replica merge is test-level, not a user-facing exchange. Use
  `just test-browser`; do not insert bytes through internal setters.
- Configured sync status, outbox, and network are not part of this skill. The
  static page shows `同期未設定`; use the sibling `tanikun-sync-change` skill.
