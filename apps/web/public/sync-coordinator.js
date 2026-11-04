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

    const retry = async (operation) => {
      for (let attempt = 0; ; attempt += 1) {
        const result = await operation();
        if (!retryable(result) || attempt >= maxRetry) {
          if (retryable(result))
            throw new SyncCoordinatorError(result.kind, result);
          return result;
        }
        const minimum =
          result.retry_after !== undefined ? result.retry_after * 1000 : 0;
        const ceiling = Math.max(minimum, Math.min(30_000, 500 * 2 ** attempt));
        const delay = Math.max(minimum, Math.floor(random() * ceiling));
        await wait(delay);
      }
    };

    const ensureDocument = async () => {
      if (documentId) return;
      const result = await retry(() => transport.bootstrap());
      if (result.kind !== "bootstrapped")
        throw new SyncCoordinatorError(result.kind, result);
      documentId = result.document_id;
      await metadataStore.observe(metadataKey(), result.cursor);
    };

    const enqueueChange = async (change) => {
      if (!documentId) return false;
      const changeId = decodeHash(change);
      const seen = await syncStore.seenHashes();
      if (seen.has(changeId)) return false;
      const outbox = await syncStore.outboxHashes();
      if (outbox.has(changeId)) return false;
      const index = storage
        .changes()
        .findIndex((candidate) => decodeHash(candidate) === changeId);
      await syncStore.enqueue([
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
      void enqueueChange(change).catch(() => {
        emit("error", { code: "outbox_failure" });
      });
    });

    const scanLocalChanges = async () => {
      const changes = storage.changes();
      const seen = await syncStore.seenHashes();
      const outbox = await syncStore.outboxHashes();
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
      await syncStore.enqueue(entries);
    };

    const pushOutbox = async () => {
      while (true) {
        const entries = await syncStore.listOutbox();
        if (entries.length === 0) return;
        const batch = entries.slice(0, maxBatch);
        const result = await retry(() =>
          transport.push(
            documentId,
            batch.map((entry) => entry.envelope),
          ),
        );
        if (result.kind !== "pushed")
          throw new SyncCoordinatorError(result.kind, result);
        await metadataStore.observe(metadataKey(), result.cursor);
        await syncStore.acknowledge(batch.map((entry) => entry.change_id));
      }
    };

    const pullPages = async () => {
      await storage.load();
      let metadata = await metadataStore.read(metadataKey());
      for (let pages = 0; pages < 10_000; pages += 1) {
        const result = await retry(() =>
          transport.pull(documentId, {
            after: metadata.mergedCursor,
            limit: maxPageSize,
          }),
        );
        if (result.kind !== "pulled")
          throw new SyncCoordinatorError(result.kind, result);
        metadata = await metadataStore.observe(metadataKey(), result.cursor);
        if (result.changes.length === 0) {
          if (result.has_more)
            throw new SyncCoordinatorError("empty_page_with_more");
          return metadata;
        }
        const known = new Set(
          storage.changes().map((change) => decodeHash(change)),
        );
        const hashes = [];
        const changes = [];
        for (const envelope of result.changes) {
          const bytes = base64ToBytes(envelope.payload);
          const decoded = globalThis.Automerge.decodeChange(bytes);
          if (decoded.hash !== envelope.change_id)
            throw new SyncCoordinatorError("malformed_response");
          if (decoded.deps.some((dependency) => !known.has(dependency)))
            throw new SyncCoordinatorError("missing_dependency");
          known.add(decoded.hash);
          hashes.push(decoded.hash);
          changes.push(bytes);
        }
        await syncStore.markRemote(hashes);
        await metadataStore.applyPage({
          key: metadataKey(),
          expectedMergedCursor: metadata.mergedCursor,
          changes,
          nextMergedCursor: result.next_cursor,
          observedHighWater: result.cursor,
          validate: (text) => storage.validateText?.(text) === true,
        });
        await storage.load();
        metadata = await metadataStore.read(metadataKey());
        if (!result.has_more) return metadata;
      }
      throw new SyncCoordinatorError("too_many_pages");
    };

    const runSync = async () => {
      await ensureDocument();
      await scanLocalChanges();
      await pushOutbox();
      const metadata = await pullPages();
      emit("synced", {
        cursor: metadata.mergedCursor,
        pending: (await syncStore.listOutbox()).length,
      });
      return {
        kind: "synced",
        document_id: documentId,
        cursor: metadata.mergedCursor,
        observed_high_water: metadata.observedHighWater,
      };
    };

    const sync = () => {
      if (running) return running;
      running = (async () => {
        emit("syncing");
        try {
          await ensureDocument();
          if (locks?.request) {
            return await locks.request(
              `tanikun-sync:${origin}:${documentId}`,
              { mode: "exclusive" },
              runSync,
            );
          }
          return await runSync();
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
      if (running) await running;
      await syncStore.clear();
      if (documentId) await metadataStore.clear(metadataKey());
    };

    const resync = async () => {
      if (running) await running;
      await ensureDocument();
      await metadataStore.reset(metadataKey());
      return sync();
    };

    return {
      sync,
      discard,
      resync,
      status: () => currentStatus,
      documentId: () => documentId,
    };
  };

  globalThis.tanikunSyncCoordinator = {
    createSyncCoordinator,
    SyncCoordinatorError,
  };
}
