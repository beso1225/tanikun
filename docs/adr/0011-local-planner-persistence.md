# Persist planner source state locally with a versioned document

## Status

accepted

## Context

The Phase 2 planner is in memory, so reloads discard enrollment edits. Phase 3
needs a persistence boundary before it adds a CRDT or a different storage
engine. Derived credits, requirement results, and display projections must stay
derived, and a corrupt or unsupported document must not silently replace a valid
plan with an empty seed.

## Decision

- Store one versioned JSON document in IndexedDB under the `tanikun-planner`
  database, `documents` store, and `planner` key.
- Version 1 contains source state only: catalogue, offerings including
  term-specific phases and coordinated allocation evidence, enrollments and
  passed snapshots, overrides, profile, selected timetable grade/term, visible
  day and period ranges, custom course IDs, custom category assignments, and the
  custom course counter.
- Requirement sets are loaded from the bundled baseline, not persisted. The
  profile selects the applicable set after restore.
- Do not persist derived totals, requirement results, scheduled blocks, category
  name caches, open dialogs, form drafts, errors, or Undo state.
- Save after every successful planner update. Serialize writes so a slow write
  cannot overwrite a newer one. Report loading, unsaved, saving, saved, and
  failed-save states in the shell.
- Restore on startup before the first user interaction. A missing document uses
  the seed. A parse error, invalid domain value, or unsupported version reports
  `保存失敗`, keeps the current seed, and surfaces an error instead of applying a
  partial document.
- Version 1 is the first supported schema. Future versions must add an explicit
  migration or reject the document; they must not mutate it in place.
- Custom course IDs and the next counter are persisted so restored entities keep
  collision-safe identity.
- All data remains device-local. Network sync, authentication, portable backup,
  and Automerge changes are separate work.

## Consequences

Persistence stays behind the browser entry point; the app model remains pure and
does not import IndexedDB or JavaScript FFI. The JSON adapter is replaceable by
the Phase 3 Automerge/IndexedDB adapter without changing the planner's source
state contract.

The persisted document can be larger than a normalized database, but it is
simple to validate and migrate. The first version supports replace-on-save and a
single local document; multi-replica convergence is tracked separately.
