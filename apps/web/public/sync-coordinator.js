// Client sync coordinator. It owns ordering, retries, the outbox, and the
// two-phase pull commit. The transport stays stateless and the planner storage
// remains the only owner of the stored document and its merge metadata.
const bytesToBase64 = (bytes) => {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
};

const retryable = (result) =>
  result.kind === "offline" ||
  result.kind === "timeout" ||
  ((result.kind === "server_error" || result.kind === "rate_limited") &&
    result.retryable === true);

{
  const maxRetries = 5;

  class SyncCoordinatorError extends Error {
    constructor(code, result) {
      super(code);
      this.name = "SyncCoordinatorError";
      this.code = code;
      if (result !== undefined) this.result = result;
    }
  }

  // The shared sync contract owns the wire limits. This classic script cannot
  // import ESM synchronously, so the already-async sync lifecycle loads the
  // contract once. The factory stays synchronous, and callers that omit
  // optional limits do not get a duplicated numeric fallback.
  let protocolLimitsPromise;
  const loadProtocolLimits = () => {
    protocolLimitsPromise ??= (async () => {
      let contract;
      try {
        contract = await import("./sync-contract.mjs");
      } catch {
        throw new SyncCoordinatorError("sync_failed");
      }
      const { SYNC_LIMITS } = contract;
      const { maxBatchChanges, maxPageChanges } = SYNC_LIMITS ?? {};
      if (
        !Number.isSafeInteger(maxBatchChanges) ||
        maxBatchChanges < 1 ||
        !Number.isSafeInteger(maxPageChanges) ||
        maxPageChanges < 1
      )
        throw new SyncCoordinatorError("sync_failed");
      return { maxBatchChanges, maxPageChanges };
    })().catch((error) => {
      protocolLimitsPromise = undefined;
      throw error;
    });
    return protocolLimitsPromise;
  };

  const decodeHash = (change) => {
    const automerge = globalThis.Automerge;
    if (!automerge) throw new SyncCoordinatorError("missing_automerge");
    return automerge.decodeChange(change).hash;
  };

  const base64ToBytes = (value) => {
    let binary;
    try {
      binary = atob(value);
    } catch {
      throw new SyncCoordinatorError("malformed_response");
    }
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  };

  const envelopeFor = (change, documentId) => {
    const changeId = decodeHash(change);
    return {
      document_id: documentId,
      change_id: changeId,
      envelope_version: 1,
      payload_encoding: "base64",
      crypto_algorithm: "none",
      key_version: 0,
      nonce: null,
      aad: {
        api_version: 1,
        document_id: documentId,
        change_id: changeId,
        envelope_version: 1,
        key_version: 0,
      },
      payload: bytesToBase64(change),
    };
  };

  const createSyncCoordinator = ({
    storage,
    transport,
    documentId: initialDocumentId,
    apiOrigin,
    syncStore,
    metadataStore,
    onStatus = () => {},
    locks = globalThis.navigator?.locks,
    sleep,
    random = Math.random,
    maxRetry = maxRetries,
  } = {}) => {
    if (!storage || !transport || !apiOrigin || !syncStore || !metadataStore)
      throw new Error("同期の依存関係が不足しています");
    let documentId = initialDocumentId;
    let currentStatus = "starting";
    let running;
    let epoch = 0;
    let discarding = false;
    const pendingEnqueues = new Set();
    let origin;
    try {
      origin = new URL(apiOrigin).origin;
    } catch {
      throw new Error("apiOrigin が不正です");
    }
    const wait =
      sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));

    const emit = (state, detail = {}) => {
      currentStatus = state;
      try {
        onStatus({ state, documentId, ...detail });
      } catch {
        // A status observer must not break synchronization.
      }
    };

    const metadataKey = () => "sync:" + JSON.stringify([origin, documentId]);
    const syncScope = () => `${origin}:${documentId}`;

    const retry = async (operation) => {
      for (let attempt = 0; ; attempt += 1) {
        const result = await operation();
        if (!retryable(result) || attempt >= maxRetry) {
          if (retryable(result))
            throw new SyncCoordinatorError(result.code ?? result.kind, result);
          return result;
        }
        const minimum =
          result.retry_after !== undefined
            ? result.retry_after * 1000
            : result.kind === "rate_limited"
              ? 1_000
              : 0;
        const ceiling = Math.max(minimum, Math.min(30_000, 500 * 2 ** attempt));
        const delay = Math.max(minimum, Math.floor(random() * ceiling));
        await wait(delay);
      }
    };

    const withLock = (operation) => {
      if (locks?.request) {
        return locks.request(
          `tanikun-sync:${origin}:${documentId}`,
          { mode: "exclusive" },
          operation,
        );
      }
      return operation();
    };

    const ensureDocument = async () => {
      if (documentId) return;
      const result = await retry(() => transport.bootstrap());
      if (result.kind !== "bootstrapped")
        throw new SyncCoordinatorError(result.code ?? result.kind, result);
      documentId = result.document_id;
      await metadataStore.observe(metadataKey(), result.cursor);
    };

    const enqueueChange = async (change, expectedEpoch = epoch) => {
      if (discarding || !documentId || epoch !== expectedEpoch) return false;
      const changeId = decodeHash(change);
      const seen = await syncStore.seenHashes(syncScope());
      if (seen.has(changeId)) return false;
      const outbox = await syncStore.outboxHashes(syncScope());
      if (outbox.has(changeId)) return false;
      if (discarding || epoch !== expectedEpoch) return false;
      const index = storage
        .changes()
        .findIndex((candidate) => decodeHash(candidate) === changeId);
      if (discarding || epoch !== expectedEpoch) return false;
      await syncStore.enqueue(syncScope(), [
        {
          change_id: changeId,
          envelope: envelopeFor(change, documentId),
          order: index < 0 ? Number.MAX_SAFE_INTEGER : index,
        },
      ]);
      return true;
    };

    storage.onLocalChange?.((change) => {
      if (!documentId) return;
      const expectedEpoch = epoch;
      const pending = enqueueChange(change, expectedEpoch).catch(() => {
        emit("error", { code: "outbox_failure" });
      });
      pendingEnqueues.add(pending);
      void pending.finally(() => pendingEnqueues.delete(pending));
    });

    const scanLocalChanges = async () => {
      const changes = storage.changes();
      const seen = await syncStore.seenHashes(syncScope());
      const outbox = await syncStore.outboxHashes(syncScope());
      const entries = [];
      for (const [index, change] of changes.entries()) {
        const changeId = decodeHash(change);
        if (seen.has(changeId) || outbox.has(changeId)) continue;
        entries.push({
          change_id: changeId,
          envelope: envelopeFor(change, documentId),
          order: index,
        });
      }
      await syncStore.enqueue(syncScope(), entries);
    };

    const pushBatch = async (batch) => {
      const result = await retry(() =>
        transport.push(
          documentId,
          batch.map((entry) => entry.envelope),
        ),
      );
      if (
        batch.length > 1 &&
        (result.kind === "invalid_request" ||
          result.kind === "request_rejected") &&
        result.code === "request_too_large"
      ) {
        const middle = Math.ceil(batch.length / 2);
        await pushBatch(batch.slice(0, middle));
        await pushBatch(batch.slice(middle));
        return;
      }
      if (result.kind !== "pushed") {
        if (Number.isSafeInteger(result.cursor))
          await metadataStore.observe(metadataKey(), result.cursor);
        throw new SyncCoordinatorError(result.code ?? result.kind, result);
      }
      await metadataStore.observe(metadataKey(), result.cursor);
      await syncStore.acknowledge(
        syncScope(),
        batch.map((entry) => entry.change_id),
      );
    };

    const pushOutbox = async (maxBatch) => {
      while (true) {
        const entries = await syncStore.listOutbox(syncScope());
        if (entries.length === 0) return;
        await pushBatch(entries.slice(0, maxBatch));
      }
    };

    const pullPages = async (maxPageSize) => {
      await storage.load();
      let snapshot = storage.snapshot();
      if (snapshot?.storageVersion === 1)
        throw new SyncCoordinatorError("planner_not_migrated");
      let metadata = await metadataStore.read(metadataKey());
      if (snapshot === null) {
        // A missing planner means any outbox/seen entries belong to a plan
        // that no longer exists. Clear them before a scan can re-upload a
        // discarded plan. If the metadata still points past the start of the
        // log, reset only the merged cursor and preserve the high-water.
        if (documentId) await syncStore.clear(syncScope());
        if (metadata.mergedCursor > 0)
          metadata = await metadataStore.resetMerged(metadataKey());
      } else if (metadata.mergedCursor > 0) {
        const localRoots = new Set(
          storage
            .changes()
            .map((change) => globalThis.Automerge.decodeChange(change))
            .filter((change) => change.deps.length === 0)
            .map((change) => change.hash),
        );
        const seen = documentId
          ? await syncStore.seenHashes(syncScope())
          : new Set();
        const rootIsKnown =
          localRoots.size > 0 &&
          [...localRoots].every((root) => seen.has(root));
        if (!rootIsKnown) {
          // A re-seeded independent root cannot belong to the merged cursor.
          // Clear its stale sync state and fail closed; explicit discard is
          // required before adopting either history.
          if (documentId) await syncStore.clear(syncScope());
          throw new SyncCoordinatorError("discard_pending");
        }
      }
      for (let pages = 0; pages < 10_000; pages += 1) {
        const result = await retry(() =>
          transport.pull(documentId, {
            after: metadata.mergedCursor,
            limit: maxPageSize,
          }),
        );
        if (result.kind !== "pulled") {
          if (Number.isSafeInteger(result.cursor))
            await metadataStore.observe(metadataKey(), result.cursor);
          throw new SyncCoordinatorError(result.code ?? result.kind, result);
        }
        const after = metadata.mergedCursor;
        if (
          !Number.isSafeInteger(result.cursor) ||
          !Number.isSafeInteger(result.next_cursor)
        )
          throw new SyncCoordinatorError("inconsistent_cursor");
        if (result.cursor < after) throw new SyncCoordinatorError("rollback");
        if (result.next_cursor > result.cursor)
          throw new SyncCoordinatorError("inconsistent_cursor");
        if (result.has_more !== result.next_cursor < result.cursor)
          throw new SyncCoordinatorError("inconsistent_cursor");
        if (result.changes.length === 0) {
          if (
            result.has_more ||
            result.next_cursor !== after ||
            result.cursor !== after
          )
            throw new SyncCoordinatorError("inconsistent_cursor");
          metadata = await metadataStore.observe(metadataKey(), result.cursor);
          return metadata;
        }
        if (result.next_cursor <= after)
          throw new SyncCoordinatorError("inconsistent_cursor");
        // ADR-0013 requires the observed high-water commit before page
        // processing. Keep it even if dependency or root validation rejects
        // this page, so a later rollback is still detectable.
        metadata = await metadataStore.observe(metadataKey(), result.cursor);

        const local = storage.changes().map((change) => ({
          bytes: change,
          decoded: globalThis.Automerge.decodeChange(change),
        }));
        const page = result.changes.map((envelope) => {
          const bytes = base64ToBytes(envelope.payload);
          return {
            envelope,
            bytes,
            decoded: globalThis.Automerge.decodeChange(bytes),
          };
        });
        const localRoots = new Set(
          local
            .filter((entry) => entry.decoded.deps.length === 0)
            .map((entry) => entry.decoded.hash),
        );
        const pageRoots = new Set(
          page
            .filter((entry) => entry.decoded.deps.length === 0)
            .map((entry) => entry.decoded.hash),
        );
        if (localRoots.size > 1 || pageRoots.size > 1)
          throw new SyncCoordinatorError("history_mismatch");
        if (
          localRoots.size > 0 &&
          pageRoots.size > 0 &&
          [...pageRoots].some((root) => !localRoots.has(root))
        )
          throw new SyncCoordinatorError("history_mismatch");

        const known = new Set(local.map((entry) => entry.decoded.hash));
        const hashes = [];
        const changes = [];
        for (const entry of page) {
          if (entry.decoded.hash !== entry.envelope.change_id)
            throw new SyncCoordinatorError("malformed_response");
          if (entry.decoded.deps.some((dependency) => !known.has(dependency)))
            throw new SyncCoordinatorError("missing_dependency");
          known.add(entry.decoded.hash);
          hashes.push(entry.decoded.hash);
          changes.push(entry.bytes);
        }

        await syncStore.markRemote(syncScope(), hashes);
        await metadataStore.applyPage({
          key: metadataKey(),
          expectedMergedCursor: metadata.mergedCursor,
          expectedPlannerBytes: snapshot?.bytes ?? null,
          changes,
          nextMergedCursor: result.next_cursor,
          observedHighWater: result.cursor,
          validate: (text) => storage.validateText?.(text) === true,
        });
        await storage.load();
        snapshot = storage.snapshot();
        metadata = await metadataStore.read(metadataKey());
        if (!result.has_more) return metadata;
      }
      throw new SyncCoordinatorError("too_many_pages");
    };

    const runSync = async ({ maxBatchChanges, maxPageChanges }) => {
      await ensureDocument();
      // Pull first: a fresh client must obtain the server history before it
      // uploads local history. The first page root check rejects independent
      // Automerge roots instead of silently merging two histories.
      await pullPages(maxPageChanges);
      await scanLocalChanges();
      await pushOutbox(maxBatchChanges);
      const metadata = await metadataStore.read(metadataKey());
      emit("synced", {
        cursor: metadata.mergedCursor,
        pending: (await syncStore.listOutbox(syncScope())).length,
      });
      return {
        kind: "synced",
        document_id: documentId,
        cursor: metadata.mergedCursor,
        observed_high_water: metadata.observedHighWater,
      };
    };

    const sync = () => {
      if (discarding)
        return Promise.resolve({
          kind: "error",
          code: "discard_in_progress",
        });
      if (running) return running;
      running = (async () => {
        emit("syncing");
        try {
          const limits = await loadProtocolLimits();
          await ensureDocument();
          return await withLock(() => runSync(limits));
        } catch (error) {
          const code = error?.code ?? "sync_failed";
          const state =
            code === "offline" || code === "timeout" ? "offline" : "error";
          const retryAfter = error?.result?.retry_after;
          const detail =
            retryAfter !== undefined ? { retry_after: retryAfter } : {};
          emit(state, { code, ...detail });
          return { kind: state, code, ...detail };
        } finally {
          running = null;
        }
      })();
      return running;
    };

    const discard = async () => {
      discarding = true;
      try {
        if (running) await running;
        epoch += 1;
        await withLock(async () => {
          // Remove the planner first so an in-flight save queues behind this
          // operation, then drain any hook that had already started before
          // the discarding flag was set, and only then clear sync state.
          await storage.discard?.();
          await Promise.allSettled(pendingEnqueues);
          if (documentId) {
            await syncStore.clear(syncScope());
            await metadataStore.clear(metadataKey());
          }
        });
      } finally {
        discarding = false;
      }
    };

    return {
      sync,
      discard,
      status: () => currentStatus,
      documentId: () => documentId,
    };
  };

  globalThis.tanikunSyncCoordinator = {
    createSyncCoordinator,
    SyncCoordinatorError,
  };
}
