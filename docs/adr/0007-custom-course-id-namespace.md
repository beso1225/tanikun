# Custom courses use the user ID namespace

## Status

accepted

## Context

Phase 2 lets a user create a course and its first offering in memory. Generated
course IDs must not collide with the sample master catalogue, and they need to
stay stable across edits within the session.

The master catalogue currently uses the `master` namespace. Custom courses are
not part of the shared master and will eventually move to persistence.

## Decision

- Generated custom courses use the `user` course namespace.
- The local part is `course-N`, where `N` starts at 1 and increases only after a
  successful create.
- The first offering uses the offering ID `user-offering-N` with the same `N`.
- The next number lives in `PlannerState.next_custom_course_number`.
- Custom courses and offerings are appended to the in-memory catalogue and
  offering arrays.
- Editing a custom course or offering preserves both IDs.
- Deleting a custom course is allowed only when none of its offerings are
  enrolled. Deleting the course removes its offerings as well.
- A regular custom offering may list one or both terms in the same semester.
- The namespace and counter are session-local. Phase 3 persistence must replace
  the counter with a collision-safe allocator before documents merge.

## Consequences

- Custom IDs cannot collide with the `master` namespace.
- A failed validation consumes no ID.
- The ID namespace is visible and testable without exposing generated IDs in the
  UI.
- Edits cannot change course identity, so enrollments and pass snapshots remain
  attached to the same course.
- Enrolled custom courses cannot be deleted, which avoids silent loss of
  enrollment history.

## Alternatives considered

- Reuse the `master` namespace. This mixes user data with the sample master.
- Generate random IDs. This is harder to reproduce in tests and gives no stable
  namespace.
- Add a UUID dependency. Phase 2 is in-memory and does not need one yet.
