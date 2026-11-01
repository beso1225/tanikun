# Store planner records in Automerge and exchange local changes

## Status

accepted

## Decision

Extend [ADR-0011](0011-local-planner-persistence.md) with Automerge persistence.
Keep the version 1 source schema and the existing MoonBit validation boundary.
IndexedDB still uses `tanikun-planner`, `documents`, and `planner`. Its version 2
storage envelope contains `storageVersion: 2` and Automerge `bytes` as a
`Uint8Array`. The database version remains 1 because the object store is unchanged.

The Automerge document has its own `version: 1`, scalar `fields`, keyed
`collections`, and collection `orders`. Records are keyed by stable course,
offering, enrollment, override, or category-assignment identity. Each record is
an immutable JSON string. This keeps a passed grade, status, and snapshot atomic,
and preserves term-specific phases and coordination evidence together. Separate
records merge independently. This costs field-level merging within one record:
concurrent edits to the same record use Automerge's deterministic winner.

Custom course deletion takes precedence over concurrent edits and enrollment.
Deletion records a permanent `deleted_custom_course:<course key>` tombstone in
the shared `fields` map, with the deleted offering IDs. Materialization removes
the course, its offerings, membership, category assignments, enrollments, and
overrides together. Later saves cannot revive a tombstoned ID. Keeping metadata
in the existing shared map also supports older documents without creating a
new map independently on each replica. Restore rejects user-namespace catalogue
rows without custom membership and custom members without offerings.
The deleting app transition removes existing course and offering overrides
before validation, so its own save is a complete valid document as well.

Collection order is an atomic list of keys. Materialization retains existing
order, omits removed keys, and appends concurrent additions absent from that
list in sorted key order. Scalars use the same atomic conflict policy. Derived
credits, summaries, requirement results, and display caches remain absent.

Every browser session generates a UUID prefix for new custom course and offering
IDs. The counter remains persisted, but a counter alone cannot distinguish two
replicas that create a course after branching. Restore keeps existing IDs and
uses the current session's prefix for later creations.

## Migration and failures

A legacy version 1 JSON string is validated and restored without modifying its
stored bytes. The next successful source edit upgrades it to the version 2
envelope in one transaction. A missing document commits the seed before showing
`保存済み`. Future source, Automerge, or storage versions fail visibly and remain
untouched until explicit discard. An invalid stored value is never treated as
an absent document.

If the initial seed write fails after a successful empty-store read, show
`保存失敗` and keep editing and save retries available. Read-only load recovery
is reserved for a failed read or an invalid existing document.
If a competing first-open tab has already stored a valid document, hydrate that
winning document instead of leaving the losing tab in a save-failed state.

Writes remain serialized and commit the in-memory Automerge handle only after
IndexedDB transaction completion. An aborted write leaves the last committed
handle and stored plan intact. A five-second timeout aborts an active transaction;
a late database open closes without starting a transaction. Existing shell
statuses, read-only recovery after a failed load, and stale-status rejection
continue to apply.

A timeout does not prove that a transaction failed to commit. Track attempted
write bytes and reconcile them with IndexedDB before a later save or merge.
Adopt a matching local attempt with its full Automerge history; a different
tab's unknown document still fails the comparison. Commit callbacks also update
this tracking after a timeout, with operation versions preventing an older
delayed event from replacing newer state. Save errors carry their recovery
message into the shell, matched to the current source document.

The IndexedDB connection and transaction lifecycle live in
`apps/web/public/persistence-transactions.js`. It receives the database and
timer functions explicitly, so tests can drive blocked, late, timed-out, and
delayed-completion events without patching browser globals.
`apps/web/public/persistence.js` owns validation, CAS comparison, and handle
adoption. It accepts an isolated transaction boundary and builds the browser
entry point `tanikunStorage` from the production dependencies.

Each write compares the stored value with the last value read or committed by
this tab in the same IndexedDB read/write transaction. A stale tab reports a
save failure and keeps its local edit visible instead of overwriting a newer
plan from another tab. Reload it to use the newer plan. Only explicit discard
can bypass this comparison. This is conflict detection, not automatic tab sync.

The browser keeps save acknowledgements, pending write requests, and startup
recovery in one `PersistenceModel` per app instance. Its pure update function
returns read/write requests; `persistence_runtime.mbt` executes them and sends
completion events back. UI-only changes and storage notifications schedule no
writes. Only the Saving label is delayed by 100 ms; writes start immediately.
Each write has an increasing per-instance sequence number, retained through
seed hydration and discard. Completion and status events carry that request;
only the pending request may change acknowledgements or visible outcomes.
This distinguishes repeated source text during rapid edits and Undo.

## Local change exchange

`tanikunStorage.changes()` exports local Automerge changes, including their
history. `merge(changes)` checks that every incoming dependency hash is present
in local history or the incoming batch, applies changes to a candidate handle,
and validates the complete materialized source with
`decode_planner_state` before committing it. Corrupt changes or a merge that
breaks references leave the committed plan intact. Callers reload the planner
after a successful exchange. Repeated delivery is idempotent.

Replicas must branch from a shared Automerge history, copied as stored bytes.
Independently creating two documents from the same JSON does not establish that
history. A merge that creates an invalid plan is rejected as a whole; conflict
resolution UI and network transport belong to later work. This boundary has no
Workers, HTTP, authentication, background peer discovery, or remote storage.

## Verification

`just test` exercises record convergence, source-only encoding, and custom ID
allocation. It also runs browser-package scheduler tests without a browser or
real timers, covering event order, independent instances, load/seed recovery,
stale completions, and Undo. A persistence adapter suite runs the production
`persistence.js` against `fake-indexeddb` and controlled timers. It covers
missing storage, open, transaction, and request failures, blocked and late
opens, active-transaction timeout and abort, delayed commits, retries,
connection cleanup, aborted-attempt cleanup, and reconciliation with a matching
or unrelated stored record. The suite records that `changes()` keeps the last
adopted history immediately after a timeout. The attempted write appears after
a late commit is adopted, or after reconciliation matches the stored bytes.
`just test-browser` covers isolated browser contexts, offline edits,
reload before exchange, repeated exchange, concurrent custom deletion and edits,
JSON migration, interrupted writes, timed-out opens, stale tabs, initial save
failures, and unsupported storage. The Phase 2 journey reloads a plan with passed grades,
snapshots, custom categories, and overrides and checks recomputed summaries.
The allocation journey covers term-specific and coordinated offerings.

The Web build copies the pinned Automerge browser bundle and its MIT license
from `node_modules`. It uses no CDN and adds no package or toolchain pin.

Browser tests serve only the static application over loopback. Offline editing
does not require a network; reloading the application still requires its static
assets to be available. This decision adds persistence, not a service worker or
an offline distribution mechanism.
