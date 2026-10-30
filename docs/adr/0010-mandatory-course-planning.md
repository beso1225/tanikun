# Project mandatory membership separately from confirmed passes

## Status

accepted

## Context

`AllCoursesPassed` requires confirmed pass evidence in every mode. That remains
useful, but it cannot show whether a graduation plan includes every mandatory
course. Treating planned enrollments as passed would change the meaning of
grades and the Phase 1 contract.

## Decision

Add a separate `MandatoryCourses` leaf, constructed by `Rule::mandatory_courses`.
It counts distinct course IDs in the selected mode's validated course entries:

- confirmed includes passed courses;
- standard adds in-progress courses;
- optimistic adds planned courses.

Failed, not-taken, and absent enrollments do not contribute. Zero-credit courses
can contribute membership. Normal accumulation deduplicates multiple offerings
of a course, and parent rules use the resulting satisfaction normally.

Keep `AllCoursesPassed` unchanged and never synthesize passing enrollments.
The planner labels the new leaf `必修`, shows cumulative counts and statuses,
and identifies required courses absent from the optimistic plan. Credits and
passed snapshots retain their existing meaning.

## Consequences

Curriculum loaders must choose the appropriate leaf explicitly. Existing
requirement trees and the Phase 1 golden fixture retain their results.
This extends the leaf set in ADR-0005 without changing its existing leaves.
