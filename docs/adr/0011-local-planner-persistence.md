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
- Save only when the encoded source document changes. UI-only updates keep the
  last saved document and never enqueue a write. Serialize writes so a slow write
  cannot overwrite a newer one. Report loading, unsaved, saving, saved,
  load-failed, and save-failed states in the shell.
- Status messages carry the encoded document text. Apply a status only when it
  still matches the current source document, so a stale completion cannot
  overwrite a newer edit.
- Restore on startup before the first user interaction. Keep the shell
  landmarks available while loading. A load that does not settle within five
  seconds fails visibly and falls back to the seed. Auto-save stays suppressed
  while the load state is failed, so a timeout or unavailable store cannot
  overwrite an existing document with the seed. A later successful load or an
  explicit recovery path may resume saving.
- A missing document uses the seed. A parse error, unsupported version, scalar
  invalid value, or broken reference reports `読み込み失敗`, keeps the current
  seed, and surfaces an error instead of applying a partial document. Validate
  duplicate course/offering/enrollment IDs, offering-to-course and
  enrollment-to-offering references, override targets, custom category
  references, and the profile's requirement set before constructing state.
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
