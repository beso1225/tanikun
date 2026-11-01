# Phase 3 results

Phase 3 is complete. It adds local-first persistence and local Automerge
replica convergence to the Phase 2 planner.

## Done criterion

The [initial design](INITIAL_DESIGN.md#phase-3--local-first) defines Phase 3
Done as offline edits surviving reload and multiple replicas converging. The
model, adapter, document, and browser suites below exercise both conditions.
The implementation contract is in
[ADR-0011](adr/0011-local-planner-persistence.md) and
[ADR-0012](adr/0012-automerge-planner-document.md).

## What Phase 3 provides

- one local planner document stored in IndexedDB and restored before the first
  edit
- a versioned source schema that survives reload without storing derived
  summaries, requirement results, or display projections
- an Automerge document envelope with per-record merge behavior and local
  change exchange
- legacy version 1 JSON migration on the next successful source edit
- serialized writes with compare-and-set protection against a stale tab
- explicit load and save results between JavaScript and MoonBit
- controlled timeout, late-open, and late-commit recovery
- custom course deletion with permanent tombstones that win over concurrent
  edits
- session-scoped custom ID prefixes so replicas do not allocate the same new
  course ID after branching
- visible load-failure, save-failure, saving, unsaved, and saved states
- persistence failure guidance that clears only after a matching successful
  save

Network synchronization is not part of Phase 3. Local change exchange is tested
through `tanikunStorage.changes()` and `merge()`; it has no Workers, HTTP,
authentication, peer discovery, or remote storage.

## Persisted boundary

The persisted source document contains:

- catalogue courses and their status
- offerings, including schedule, terms, semester, slots, term-specific phases,
  status, and coordinated allocation evidence
- enrollments with status, passing and failing grades, and passed snapshots
- course, offering, and category overrides
- program, advancement year, timetable grade, and selected term
- visible day and period ranges
- custom course IDs, custom category assignments, and the next custom course
  counter

The following are deliberately not stored:

- requirement sets, which come from the bundled baseline
- derived credit totals, category credits, requirement results, and summary
  projections
- scheduled blocks and category name caches
- open dialogs, picker state, form drafts, catalogue queries, errors, and Undo
  state
- persistence status and pending write bookkeeping
- network, identity, or authentication state

[`planner_persistence_schema.mbt`](../apps/web/app/planner_persistence_schema.mbt)
defines the DTOs. The fixture suite mutates UI-only state and asserts that the
encoded document and restored state do not contain it.

## Storage and adapter behavior

IndexedDB uses the `tanikun-planner` database, the `documents` object store, and
the `planner` key. The database version remains 1 because the object store did
not change.

A legacy value is a version 1 JSON string. The current envelope is
`storageVersion: 2` with Automerge `bytes` as a `Uint8Array`. The Automerge
document has its own `version: 1`, scalar `fields`, keyed `collections`, and
collection `orders`. Each record is an immutable JSON string, so a passed grade,
status, and snapshot stay atomic. Concurrent edits to the same record use
Automerge's deterministic winner; separate records merge independently.

A legacy document is validated and restored without changing its stored bytes.
The next successful source edit upgrades it in one transaction. Missing storage
seeds a new document. Corrupt, unsupported, or future-version data fails
visibly and remains untouched until explicit discard.

`apps/web/public/persistence.js` owns validation, compare-and-set, and handle
adoption. `apps/web/public/persistence-transactions.js` owns the IndexedDB
connection and transaction lifecycle. `apps/web/cmd/browser/storage.mbt` decodes
explicit wire arrays into `StorageLoadResult` and `StorageSaveResult`.
`apps/web/cmd/browser/persistence_scheduler.mbt` owns one pending write per app
instance, request sequence numbers, startup recovery, and stale-result
rejection.

Writes commit the in-memory Automerge handle only after the IndexedDB
transaction completes. A five-second timeout aborts the active transaction. A
late open closes without writing. Because a timeout does not prove that the
transaction failed, a later save reconciles the attempted bytes with storage and
adopts a matching local attempt with its full history. Operation versions stop
an older delayed callback from replacing newer state.

## Failure behavior

- A load failure keeps the current seed, shows `読み込み失敗`, and suppresses
  auto-save, so the existing document cannot be overwritten by the seed.
- The shell offers an explicit discard action. Only that action resumes saving.
- A save failure keeps the edit visible, reports `保存失敗`, and leaves the last
  committed document intact. A later source edit retries.
- A stale tab reports a save failure and reloads the newer committed plan. It
  does not overwrite newer bytes.
- A failed retry keeps the latest save guidance. A matching successful save
  clears only save-failure guidance; load-failure guidance and unrelated
  domain/form validation errors remain visible.
- Unsupported storage values and aborted writes preserve the last committed
  plan.
- Invalid peer changes, missing dependencies, and merges that break references
  are rejected as a whole. Repeated delivery is idempotent.

## Model and document evidence

Run the model, adapter, and document suites from the repository root:

```sh
nix develop -c just test
```

The command currently reports 285 passing MoonBit tests and 36 passing Node
tests. The Node tests are the Automerge document contract and the persistence
adapter suite; they need `pnpm install --frozen-lockfile`.

Persistence model and scheduler tests:

- [`planner_persistence_test.mbt`](../apps/web/app/planner_persistence_test.mbt):
  source round trips, validation, restoration, migration, failure guidance, and
  Undo behavior
- [`planner_persistence_fixture_test.mbt`](../apps/web/app/planner_persistence_fixture_test.mbt):
  fixed fixture decoding and absence of UI-only state
- [`persistence_scheduler_wbtest.mbt`](../apps/web/cmd/browser/persistence_scheduler_wbtest.mbt):
  event order, startup recovery, repeated source, stale completions, and Undo
- [`storage_wbtest.mbt`](../apps/web/cmd/browser/storage_wbtest.mbt): explicit
  load and save wire outcomes

Node suites:

- [`planner-document.test.mjs`](../tests/integration/planner-document.test.mjs):
  complete fictional fixtures through the MoonBit decoder, fixed-actor delivery
  matrices, collection order, same-identity additions, tombstones, and missing
  references
- [`persistence.test.mjs`](../tests/integration/persistence.test.mjs):
  production adapter behavior against `fake-indexeddb`, including missing,
  blocked, late, timed-out, aborted, retried, and reconciled writes

## Browser evidence

```sh
nix develop -c just test-browser
```

`just test-browser` builds the static page and the allocation fixture, then runs
29 Chromium tests across six files: 28 in the main browser command and one
allocation journey. The persistence portion is 24 tests across:

- [`browser-persistence.test.mjs`](../tests/integration/browser-persistence.test.mjs):
  reload recovery, save and load failures, rejected and malformed wire results,
  legacy migration, unsupported storage, stale tabs, late opens and commits,
  custom deletion, and retry guidance
- [`browser-persistence-convergence.test.mjs`](../tests/integration/browser-persistence-convergence.test.mjs):
  isolated replicas with offline edits, concurrent custom edits, stale tabs, and
  simultaneous first-open seeding

The suites run against the local build and the Nix-built assets. They inspect
committed IndexedDB bytes without calling the production load path, wait for the
intended committed source after edits, and use explicit barriers for timeout and
ordering tests. Multi-page failures keep a screenshot per page and a trace per
context under `.cache/verify/`.

The mapped verification journeys drive the same built page independently:

```sh
nix develop -c node .agents/skills/verify/scripts/doctor.mjs
nix develop -c node .agents/skills/verify/scripts/drive.mjs all
```

## Verification

- Phase 3 issues #114, #118, #122, #123, #124, #125, #126, #127, and #129 are
  closed.
- `just test` passes with 285 MoonBit tests and 36 Node tests.
- `just test-browser` passes 28 tests in the main browser command and the
  allocation journey against local and Nix-built assets.
- `just lint` passes.
- `nix build path:.#web --no-link` passes.
- `main` CI passes on merge commit `06ba5da`.
- The Phase 3 milestone is closed after this evidence page lands.

## Scope limits

- Chromium is the only browser target.
- Replica exchange is a local test API. There is no automatic peer discovery,
  network transport, conflict-resolution UI, authentication, or E2EE.
- Portable backup and restore (#115) is separate work.
- Fixtures are fictional. Real catalogue, curriculum, historical, future-year,
  and on-demand data remain out of scope.
- The static application still needs its assets to be served after reload; this
  phase does not add a service worker or offline distribution.

## Next phase

Phase 4 adds Workers and HTTP change exchange between replicas. The persisted
source schema and local Automerge document remain the input boundary.
