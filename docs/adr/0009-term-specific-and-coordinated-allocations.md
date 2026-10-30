# Keep term-specific and coordinated allocations on offerings

## Status

accepted

## Context

An offering can meet in different slots in successive terms. Splitting it into
unrelated enrollments duplicates status, grades, and pass evidence. Separate
courses can also reserve common periods while meeting on coordinated dates.
Matching printed periods alone does not establish that coordination.

## Decision

- One `CourseOffering` and one enrollment represent every schedule phase.
- `with_term_slots` accepts exactly one validated slot set per active term and
  copies its inputs. Missing, duplicate, and inactive terms are rejected.
- `slots_in_term` returns a copy of the selected phase. `slots` returns the
  union for compatibility with existing offering-wide APIs.
- An offering-wide slot override replaces every active phase. Passed enrollments
  keep the stored phase slots, consistent with the existing snapshot policy.
- Rendering, detail, picker filtering, and conflict checks use the same phase
  allocation. Addition checks all active terms before changing enrollment state.
- `CoordinatedAllocation` contains a nonempty group and verification source.
  Attaching it asserts that the source establishes coordinated meeting dates;
  the constructor does not verify an external source.
- Distinct offerings in the same academic year can share a conflicting printed
  allocation only when both carry matching coordination evidence and their
  effective slots in that term equal their stored slots.
- Changing slots revokes that exception for the changed allocation. Ordinary
  overlaps remain errors. Every shared-cell enrollment remains actionable.
- Replacing term phases clears existing coordination evidence. An importer must
  verify and attach evidence again after changing the stored allocation.

## Consequences

Status, grade, removal, Undo, credits, and mandatory membership naturally apply
once to a phased offering. Separate attempts retain duplicate-pass validation.
Importers must validate source evidence before attaching coordination metadata.
The UI explains that exact meeting dates require the course instructions.
