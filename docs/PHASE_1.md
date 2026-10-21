# Phase 1: pure domain and graduation-requirement evaluation

## Status

Design contract for Phase 1. Implementation is tracked by issues #7–#19.

This document fixes the model before code so that the domain, requirement,
credit, and evaluation issues share the same semantics. It is consistent with
[the initial design](INITIAL_DESIGN.md), [the technical review](TECH_REVIEW.md),
[ADR-0001](adr/0001-course-identity-by-stable-id.md) through
[ADR-0005](adr/0005-requirement-rules-and-credit-semantics.md), and
[the glossary](../GLOSSARY.md).

Phase 1 is deliberately pure MoonBit. UI, Workers, D1, Automerge, IndexedDB,
persistence, JSON contracts, and HTTP APIs are out of scope.

## Goal and Done criteria

Phase 1 must deterministically derive, from fictional in-memory input:

- confirmed, standard projected, and optimistic projected credits;
- per-category credits and total credits;
- satisfied, partially satisfied, or unsatisfied requirement trees for each
  projection mode.

It is complete when the golden test from issue #17 demonstrates those values
and the checks from issue #18 pass on Linux CI.

## Module ownership

| Module                  | Contents                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`       | `Credits`, ID types, calendar values, `Course`, `CourseOffering`, `AcademicProfile`, `Program`, `Enrollment`, `Override`, pass snapshot |
| `packages/requirements` | `Category`, `CategoryTable`, `RequirementSet`, `Rule`, `CreditSummary`, `RuleResult`, `Evaluation`, validation and evaluation           |

`packages/requirements` depends on `packages/domain`. Neither module may depend
on `apps/web`, `apps/api`, Workers APIs, or JavaScript FFI.

Both modules declare `preferred_target = "js"` and `supported_targets = "js"`
to match the JavaScript workspace and its CI commands. This is a build-target
declaration, not a dependency on JavaScript: the modules use no FFI, and
broadening their supported targets is deferred until another target is
actually exercised.

## Value objects

### Credits

Credits are stored as half-credit units to represent 0.5-credit courses without
floating-point arithmetic.

```moonbit
struct Credits {
  half_units : Int
}
```

- `1` half-unit = 0.5 credits; `2` half-units = 1 credit; `5` half-units = 2.5 credits.
- `half_units < 0` is rejected.
- `0` credits is allowed. This permits zero-credit seminars and similar courses.
- There is no arbitrary upper bound. Data-quality checks belong to fixtures and
  import validation, not to the unit type.
- Arithmetic (`add`, `sum`, comparisons) operates on `half_units` exactly.
- Display and parsing happen at boundaries. Display uses `1`, `1.5`, `2.5`;
  parsing accepts only non-negative multiples of 0.5. No `Double` is used.

All course credits, requirement thresholds, and credit summaries use
`Credits`. `AtLeast` child counts use `Int`, not `Credits`.

### IDs

Each aggregate has a dedicated ID type so that IDs cannot be mixed.

- `CourseId` has a namespace and a local part. Both are non-empty after trimming,
  contain no control characters, and are equality-significant.
  Example namespaces are `master` and `user`; Phase 1 does not enforce a fixed
  namespace catalogue.
- `OfferingId`, `ProgramId`, and `CategoryId` are non-empty validated string
  wrappers.
- IDs are stable. Names are display attributes and never participate in
  identity.

### Calendar values

- `AcademicYear(Int)` is a positive calendar year.
- `Semester` is `S`, `A`, or `W`.
- `Term` is `S1`, `S2`, `A1`, or `A2`. `W` has no term.
- `DayOfWeek` is Monday through Sunday.
- `Period(Int)` is validated as 1 through 10.
- `Slot` is `(day, period)`.

Phase 1 uses explicit `AcademicYear` values on offerings. It does not derive an
academic year from `advancement_year`; that mapping needs a study-year/UI
decision and is deferred to Phase 2.

## Courses, programs, and profiles

### Course

```moonbit
struct Course {
  id : CourseId
  name : String
  credits : Credits
  status : CourseStatus // Active | Retired
}
```

- Names are non-empty display values.
- Categories are not part of `Course` (ADR-0004).
- Retired courses remain referenceable so that historical passes can be
  represented. Passed enrollments may reference them; planned and in-progress
  enrollments may not.

### Program and profile

- `Program` has a `ProgramId` and a display name.
- `AcademicProfile` has a `ProgramId` and an `AdvancementYear`.
- `AdvancementYear` uses `AcademicYear`. It is the year in which the student
  enters the third year and is used only to select a requirement set in Phase 1.

## Offerings

```moonbit
enum OfferingSchedule {
  Regular { terms : Array[Term] }
  YearLong
  Intensive { semester : Semester }
}

enum OfferingStatus {
  Offered
  NotOffered
}

struct CourseOffering {
  id : OfferingId
  course_id : CourseId
  academic_year : AcademicYear
  schedule : OfferingSchedule
  status : OfferingStatus
  slots : Array[Slot]
}
```

Validation:

- `Regular`: `terms` is non-empty, contains no duplicates, contains no `W`, and
  all terms belong to one semester (S1/S2 or A1/A2). Offered offerings have at
  least one unique slot.
- `YearLong`: spans S and A, has no explicit term list, and has at least one
  unique slot when offered.
- `Intensive`: has a semester (S, A, or W), has no terms, and has no slots.
- `NotOffered`: has no slots. Passed historical enrollments may still reference
  it; planned and in-progress enrollments may not.
- Multiple offerings may share a slot. Duplicate slots within one offering are
  rejected.

## Enrollments

An `Enrollment` is keyed by `OfferingId`; there is at most one enrollment per
offering.

```moonbit
enum EnrollmentState {
  Planned
  InProgress
  Confirmed(ConfirmedGrade)
}

enum ConfirmedGrade {
  Passed { grade : PassingGrade, snapshot : PassedCourseSnapshot }
  Failed { grade : FailingGrade }
  NotTaken
}
```

- `PassingGrade`: 優上, 優, 良, 可, 合.
- `FailingGrade`: 不可, 否.
- `Passed`, `Failed`, and `NotTaken` are confirmed outcomes. Planned and
  in-progress enrollments have no grade.
- `is_passed` is true only for `Passed`.
- `PassedCourseSnapshot` contains `course_id`, `name`, and `credits`. It does not
  contain a category; categories belong to the requirement set.
- At confirmation, the snapshot is built from the effective course data at that
  moment, including an active name/credits override. Later master revisions and
  override changes do not alter it.
- A retired course or an offering that is not offered may be referenced only by
  a passed enrollment.

### Explicit correction

`Enrollment` is an immutable value. A mistake is corrected by constructing a
replacement `Enrollment` and explicitly replacing the entry for the previous
offering. Only this explicit correction may regenerate a passed snapshot.
Normal master revisions and overrides never do.

Phase 1 does not keep revision history. Phase 3 may retain CRDT history, but the
evaluation model only sees the current corrected enrollment.

The pure replacement helper has the shape:

```moonbit
fn correct_enrollment(
  input : EvaluationInput,
  previous_offering : OfferingId,
  corrected : Enrollment,
) -> Result[EvaluationInput, DomainError]
```

It validates the corrected enrollment and the resulting dataset, removes the
previous entry, inserts the corrected one, and does not mutate the input.

## Overrides

```moonbit
enum OverrideTarget {
  Course(CourseId)
  Offering(OfferingId)
}

enum OverrideAttribute {
  DisplayName
  Credits
  Slots
}

enum OverrideValue {
  Text(String)
  Credits(Credits)
  Slots(Array[Slot])
}

struct Override {
  target : OverrideTarget
  attribute : OverrideAttribute
  value : OverrideValue
}
```

Allowed combinations:

| Target   | Attribute     | Value     | Notes                            |
| -------- | ------------- | --------- | -------------------------------- |
| Course   | `DisplayName` | `Text`    | display only                     |
| Course   | `Credits`     | `Credits` | applies before a pass            |
| Offering | `Slots`       | `Slots`   | must satisfy offering slot rules |

- Category overrides are not representable.
- A duplicate `(target, attribute)` pair is rejected.
- Overrides apply to planned, in-progress, and display data. For passed
  enrollments, the frozen snapshot wins.
- An override may remain in the input after a pass; it has no effect on the
  frozen snapshot.
- Slot overrides are validated against the offering schedule: regular and
  year-long offerings need at least one unique slot; intensive offerings need
  none.

## Categories and requirement sets

- `Category` has a `CategoryId` and a display name.
- `CategoryTable` maps course IDs to exactly one category. Duplicate course
  assignments and unknown categories are rejected.
- A course absent from the table is valid and counts only toward total credits.
- `RequirementSetKey` is `(ProgramId, AdvancementYear)`.
- `RequirementSet` contains its key, the category definitions, its category
  table, and one rule tree.
- The profile's program and advancement year must match the requirement-set key.

## Rule tree

The leaves and nodes follow ADR-0005.

Leaves:

- category-group minimum credits (a single category is a group of one);
- total minimum credits;
- all specified courses passed;
- minimum credits from a specified course set.

Nodes:

- `All(children)`;
- `Any(children)`;
- `AtLeast(count, children)`.

Validation:

- credit thresholds and course-set thresholds are positive multiples of 0.5;
- `AtLeast` count is at least 1 and at most the number of children;
- `All`, `Any`, and `AtLeast` have non-empty children;
- course lists and category lists are non-empty and duplicate-free;
- every referenced course and category exists;
- the rule contains no evaluation logic.

The tree is a value; child order is preserved for result rendering but has no
effect on satisfaction.

## Credit accumulation

For each projection mode, count each `CourseId` at most once.

| Mode                 | Included enrollment states             |
| -------------------- | -------------------------------------- |
| Confirmed            | passed only                            |
| Standard projected   | passed, then in-progress               |
| Optimistic projected | passed, then in-progress, then planned |

Selection rules:

- A passed enrollment always wins and uses its frozen snapshot.
- Otherwise an in-progress enrollment uses the current effective course credits.
- Otherwise a planned enrollment uses the current effective course credits.
- A failed enrollment contributes nothing and does not block a later
  in-progress or planned enrollment for the same course.
- Duplicate passed enrollments for one course are rejected.
- Multiple in-progress or planned records for one course count once; the course
  and override determine the credits, so the result is deterministic.

Totals and categories:

- Total credits are the sum of all counted courses, including uncategorized
  courses.
- A categorized course belongs to at most one category through the category
  table. Category credits are disjoint and do not affect the total.
- Zero-credit courses contribute zero but still count for course-based rules.
- Per-category output contains every category defined by the requirement set,
  including zero-credit categories, sorted by `CategoryId`.

## Requirement evaluation

```moonbit
enum Satisfaction {
  Satisfied
  Partial
  Unsatisfied
}

enum Progress {
  Credits { achieved : Credits, required : Credits }
  Courses { passed : Int, total : Int }
  Children { satisfied : Int, partial : Int, total : Int }
}

struct RuleResult {
  satisfaction : Satisfaction
  progress : Progress
  children : Array[RuleResult]
}
```

Leaf progress:

- credit leaves return `Credits`;
- `AllCoursesPassed` returns `Courses`;
- nodes return `Children`.

Leaf satisfaction:

- credits: `achieved == 0` is unsatisfied, `0 < achieved < required` is partial,
  and `achieved >= required` is satisfied;
- courses: zero passed is unsatisfied, some but not all is partial, all is
  satisfied.

Node satisfaction:

- `All`: satisfied if all children are satisfied; unsatisfied if all are
  unsatisfied; otherwise partial.
- `Any`: satisfied if any child is satisfied; partial if none are satisfied but
  at least one is partial; otherwise unsatisfied.
- `AtLeast(N)`: satisfied if at least N children are satisfied; partial if fewer
  than N are satisfied but satisfied plus partial reaches N; otherwise
  unsatisfied.

`RuleResult.children` preserves the rule tree's child order. Leaves have an
empty children array.

## Evaluation result and API

```moonbit
struct Projection[T] {
  confirmed : T
  standard : T
  optimistic : T
}

struct Evaluation {
  credits : Projection[CreditSummary]
  requirements : Projection[RuleResult]
}
```

Public API:

```moonbit
struct EvaluationInput {
  profile : AcademicProfile
  requirement_set : RequirementSet
  courses : Array[Course]
  offerings : Array[CourseOffering]
  enrollments : Array[Enrollment]
  overrides : Array[Override]
}

fn validate(input : EvaluationInput) -> Array[DomainError]
fn evaluate(input : EvaluationInput) -> Result[Evaluation, DomainError]
fn credit_summary(input : EvaluationInput) -> Result[Projection[CreditSummary], DomainError]
fn evaluate_rule(rule : Rule, context : RuleContext) -> RuleResult
```

`RuleContext` is the mode-specific input for rule evaluation:

```moonbit
struct RuleContext {
  total : Credits
  by_category : Array[(CategoryId, Credits)]
  by_course : Array[(CourseId, Credits)]
  passed_courses : Array[CourseId]
}
```

`by_category` and `by_course` are sorted by ID. `passed_courses` is the set of
courses with a passed enrollment in that mode.

- Constructors validate scalar invariants and return
  `Result[T, DomainError]`.
- `validate` collects dataset-level errors; the order is deterministic
  (entity kind, then ID).
- `evaluate`, `credit_summary`, and `correct_enrollment` fail fast with the first
  validation error.
- Evaluation is pure and independent of input array order. The only sorted
  output is the category array; rule children preserve tree order.
- `DomainError` is a typed enum, not a message string. It covers at least: invalid
  credits, empty IDs, duplicate IDs, duplicate passed courses, duplicate
  enrollments, duplicate overrides, unknown references, invalid offering
  schedules, invalid override combinations, invalid rule references, and
  profile/requirement-set mismatch.

## Fixture plan

Issue #17 will add one fictional program with:

- categories and a category table, including an uncategorized course;
- courses with 0.5, 1, 1.5, and 2 credits, plus a retired course;
- regular, year-long, intensive, and not-offered offerings;
- passed, failed, not-taken, in-progress, and planned enrollments;
- an override before a pass, an override after a pass, and an explicit
  correction;
- a rule tree containing every Phase 1 leaf and node type.

The golden test will record confirmed, standard projected, and optimistic
projected totals, per-category credits, and each rule result. The fixture lives
in the requirements test package; no JSON serialization is needed in Phase 1.

## Out of scope and deferred decisions

- UI, Workers, D1, Automerge, IndexedDB, and persistence.
- JSON/HTTP contracts and migrations.
- Revision history and audit logging for corrections (Phase 3 may add history).
- Deriving academic years from `advancement_year` (deferred to Phase 2; offerings
  carry explicit years).
- A credit upper bound or a policy for importing malformed data.
- Requirement-set effective periods beyond `(program, advancement year)`.
- Category display ordering beyond sorting by `CategoryId` in credit output.
