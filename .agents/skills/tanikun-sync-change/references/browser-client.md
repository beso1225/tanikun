# Browser sync client

Read this when you change `apps/web/public/sync-*.js`, the sync status shell,
or the client commit order. [ADR-0013](../../../../docs/adr/0013-http-sync-protocol.md)
owns the wire and cursor rules. [D1 sync storage](../../../../docs/SYNC_STORAGE.md)
owns the browser storage boundary. This reference points to the owners and the
failure paths.

## Transport

`sync-transport.js` is stateless. It returns explicit `SYNC_TRANSPORT_KINDS`
results for bootstrap, push, pull, offline, timeout, abort, unauthorized, not
found, malformed response, conflict, rejected request, and server error. It
validates request envelopes and response bodies with the shared contract. It
does not touch IndexedDB or Automerge state.

- Use the shared `SYNC_LIMITS`. Do not add a browser-only limit.
- Keep `credentials: "omit"`, `cache: "no-store"`, and the explicit bearer.
- Retry only `offline`, `timeout`, and `temporarily_unavailable` with
  `retryable: true`. Honor `Retry-After`.
- Do not treat a malformed `200` response as success. Reject it before any
  state change.

## Outbox and seen

`sync-store.js` uses the `tanikun-sync` database with `outbox` and `seen`.
Keys are scoped by `${origin}:${documentId}`. The outbox holds unsynced `none`
envelopes. Seen marks remote and acknowledged changes. `acknowledge` deletes
the outbox entry and writes seen in one transaction.

- Keep the scope on every key. A document rebind must not push another
  document's envelopes.
- Keep the outbox bounded. An oversized push batch is split before it becomes a
  terminal error.
- Do not re-encrypt or rewrite an envelope after a failed push. Retry the exact
  saved bytes and change ID.
- The seen set grows with retained history. A persisted scan boundary is future
  work, not a silent optimization.

## Metadata and commit

`sync-metadata.js` stores `sync:<origin>:<document>` beside the planner in
`tanikun-planner`/`documents`. The record is
`{syncVersion: 1, mergedCursor, observedHighWater}`. `observe` rejects a cursor
below either stored counter and keeps the maximum high-water. `applyPage`
re-reads the planner and metadata in one read/write transaction, checks the
expected planner bytes and merged cursor, applies the page to a candidate,
validates the materialized planner, and writes the planner and next metadata
together. `resetMerged` lowers only the merged cursor and preserves the
high-water. `clear` removes the record.

- Persist the observed high-water before page processing. A failed page must
  remain detectable.
- Commit the validated planner and merged cursor together. A compare-and-set
  failure rejects the whole candidate.
- Do not add sync fields to the planner source or change `storageVersion: 2`.
- `mergedCursor <= observedHighWater` is part of the record contract.

## Coordinator order

`sync-coordinator.js` owns the order:

1. Bootstrap only when no document is configured.
2. Pull before push. A fresh client must adopt the server history before
   uploading local history.
3. For each page, check the cursor fields, persist the observed high-water,
   reject multiple or foreign roots, verify each change hash, require every
   dependency in local history or the page, mark remote hashes, and apply the
   page with compare-and-set.
4. Scan local history into the outbox and push batches of at most 20.
   Acknowledge the pushed batch only after the server accepts it.
5. Emit a narrow status after the push completes.

- Keep pull before push. Reversing it lets a fresh replica upload an independent
  history.
- An empty pull page ends the pull phase. The push phase still runs.
- Keep the page checks in this order. A hash or dependency check after
  `applyPage` is too late.
- Do not advance the merged cursor from an upload acknowledgement. A pull
  advances it.
- A failed page leaves the previous planner and merged cursor intact while
  retaining the observed high-water.

## Locks, retry, and discard

- `withLock` uses the Web Locks API with
  `tanikun-sync:${origin}:${documentId}`. Without Web Locks, one leader is
  required. Compare-and-set rejects cursor rollback, but it does not make
  concurrent leaders safe.
- Retry is bounded at five retries with jitter and `Retry-After`. Retry
  exhaustion keeps the outbox.
- `discard` removes the planner first, drains pending enqueues, then clears the
  sync store and metadata under the same lock. It increments the epoch so a
  late local save cannot enqueue after the reset.
- A missing planner clears stale outbox and seen state before a scan. A
  re-seeded independent root fails with `discard_pending` instead of adopting
  either history.

## Status shell

`sync-shell.js` reads `globalThis["__TANIKUN_SYNC_CONFIG__"]` before its modules
load. It maps states to the visible labels, shows retry only for retryable
codes, and never offers retry for an unsafe identity or not-found error. The
shell is not a protocol owner.

## Focused proofs

- `tests/integration/sync-transport.test.mjs` for request and response
  validation, result kinds, retry metadata, and response bounds.
- `tests/integration/sync-coordinator.test.mjs` for outbox, pull order, roots,
  dependencies, cursor rollback, stale planner, oversized batches, locks,
  discard, and status.
- `tests/integration/persistence.test.mjs` for the metadata record, CAS, and
  transaction behavior.
- `tests/integration/browser-sync-status.test.mjs` uses a fake API. It proves
  status behavior, not real convergence.
- `tests/integration/sync-convergence.test.mjs` and
  `sync-browser-faults.test.mjs` use the real Worker and D1 through
  `SyncHarness`.
