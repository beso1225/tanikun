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

Writes remain serialized and commit the in-memory Automerge handle only after
IndexedDB transaction completion. An aborted write leaves the last committed
handle and stored plan intact. A five-second timeout aborts an active transaction;
a late database open closes without starting a transaction. Existing shell
statuses, read-only recovery after a failed load, and stale-status rejection
continue to apply.

## Local change exchange

`tanikunStorage.changes()` exports local Automerge changes, including their
history. `merge(changes)` applies them to a candidate handle, rejects missing
dependencies, and validates the complete materialized source with
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
allocation. `just test-browser` covers isolated browser contexts, offline edits,
reload before exchange, repeated exchange, JSON migration, interrupted writes,
and unsupported storage. The Phase 2 journey reloads a plan with passed grades,
snapshots, custom categories, and overrides and checks recomputed summaries.
The allocation journey covers term-specific and coordinated offerings.

The Web build copies the pinned Automerge browser bundle and its MIT license
from `node_modules`. It uses no CDN and adds no package or toolchain pin.

Browser tests serve only the static application over loopback. Offline editing
does not require a network; reloading the application still requires its static
assets to be available. This decision adds persistence, not a service worker or
an offline distribution mechanism.
