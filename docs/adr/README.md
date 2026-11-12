# Architecture decision records

| ADR                                                       | Title                                                                    | Status   |
| --------------------------------------------------------- | ------------------------------------------------------------------------ | -------- |
| [0001](0001-course-identity-by-stable-id.md)              | Course identity uses a stable course ID                                  | accepted |
| [0002](0002-freeze-course-data-at-pass-time.md)           | A passed enrollment freezes course data                                  | accepted |
| [0003](0003-override-semantics.md)                        | Overrides use one generic record and do not rewrite frozen pass data     | accepted |
| [0004](0004-category-defined-by-requirement-set.md)       | The requirement set defines categories                                   | accepted |
| [0005](0005-requirement-rules-and-credit-semantics.md)    | Requirements form a tree and leaves count credits                        | accepted |
| [0006](0006-phase-2-planner-state-and-ui-errors.md)       | Phase 2 keeps planner state in the web app and errors at the UI boundary | accepted |
| [0007](0007-custom-course-id-namespace.md)                | Custom courses use the user ID namespace                                 | accepted |
| [0008](0008-timetable-grade-year-mapping.md)              | Timetable grades map to academic years from the advancement year         | accepted |
| [0009](0009-term-specific-and-coordinated-allocations.md) | Offerings own term-specific and coordinated allocations                  | accepted |
| [0010](0010-mandatory-course-planning.md)                 | Mandatory membership projects separately from confirmed passes           | accepted |
| [0011](0011-local-planner-persistence.md)                 | Persist planner source state locally with a versioned document           | accepted |
| [0012](0012-automerge-planner-document.md)                | Store planner records in Automerge and exchange local changes            | accepted |
| [0013](0013-http-sync-protocol.md)                        | Exchange opaque changes through a versioned HTTP sync log                | accepted |
| [0014](0014-local-development-auth.md)                    | Restrict temporary sync identities to local development                  | accepted |
| [0015](0015-passkey-session-account-boundary.md)          | Use passkey accounts and opaque cookie sessions at one HTTPS origin      | proposed |

ADR-0013 and ADR-0014 are implemented. The
[Phase 4 results](../PHASE_4_RESULTS.md) record the implementation evidence and
local-development limits.

ADR-0015 is proposed. It becomes current only after the
[#176](https://github.com/beso1225/tanikun/issues/176) verifier evidence and
final review. ADR-0014 remains current for the separate local-bearer mode.

See the [documentation index](../README.md) for current contracts.
