# Phase 2 keeps planner state in the web app and errors at the UI boundary

## Status

accepted

## Context

Phase 2 adds a five-term timetable UI with in-memory state. The current web app is
still the Phase 0 counter, and the pure packages expose one flat `DomainError`
with 41 variants.

The UI needs error context that the pure enum does not carry: which field failed,
which offering caused a slot conflict, and which course a message belongs to.
Phase 2 also introduces planner rules that are not domain invariants, such as
duplicate placement and term mismatch.

Phase 3 will add persistence and Automerge. Phase 4 will add an HTTP API. Both
will need stable error contracts, but those contracts do not exist yet.

## Decision

- Keep the Phase 2 planner state in `apps/web/app`.
- Keep `packages/domain` and `packages/requirements` pure. They do not import
  the web app or UI errors.
- Keep the flat `DomainError` through Phase 2.
- Add `UiError` at the app boundary with a target, kind, and message.
- Add `TimetableError` for planner conflicts:
  - duplicate enrollment;
  - slot conflict;
  - offering not available in the selected term;
  - unknown offering.
- Convert `DomainError` and `TimetableError` to `UiError` before the view uses
  them.
- Do not store derived credit or requirement values in the planner state.
- Revisit the error split when Phase 3 persistence or the Phase 4 API defines
  stable error codes.

## Consequences

- The pure API remains stable for Phase 2.
- The UI mapping must be exhaustive enough to catch new domain variants at
  compile time.
- Planner errors stay out of the domain model.
- The app temporarily owns state that may move to a document model in Phase 3.
- A future split can use real persistence and API requirements instead of
  guessing from the current UI.

## Alternatives considered

- Split `DomainError` by package now. This changes many tests and still does not
  provide field or entity context to the UI.
- Add planner conflicts to `DomainError`. This mixes UI rules with domain
  invariants.
- Put planner state in a new pure package now. Phase 2 has no serialization or
  persistence boundary yet, so the package would only move the same state
  without proving a stable API.
