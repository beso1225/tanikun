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
  (result.kind === "server_error" && result.retryable === true);

{
  const maxBatch = 20;
  const maxPageSize = 100;
  const maxRetries = 5;

  class SyncCoordinatorError extends Error {
    constructor(code, result) {
      super(code);
      this.name = "SyncCoordinatorError";
      this.code = code;
      if (result !== undefined) this.result = result;
    }
  }

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
          result.retry_after !== undefined ? result.retry_after * 1000 : 0;
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

    const pushOutbox = async () => {
      while (true) {
        const entries = await syncStore.listOutbox(syncScope());
        if (entries.length === 0) return;
        await pushBatch(entries.slice(0, maxBatch));
      }
    };

    const pullPages = async () => {
      await storage.load();
      let snapshot = storage.snapshot();
      if (snapshot?.storageVersion === 1)
        throw new SyncCoordinatorError("planner_not_migrated");
      let metadata = await metadataStore.read(metadataKey());
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

    const runSync = async () => {
      await ensureDocument();
      // Pull first: a fresh client must obtain the server history before it
      // uploads local history. The first page root check rejects independent
      // Automerge roots instead of silently merging two histories.
      await pullPages();
      await scanLocalChanges();
      await pushOutbox();
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
          await ensureDocument();
          return await withLock(runSync);
        } catch (error) {
          const code = error?.code ?? "sync_failed";
          const state =
            code === "offline" || code === "timeout" ? "offline" : "error";
          emit(state, { code });
          return { kind: state, code };
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
