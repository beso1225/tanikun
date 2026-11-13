import {
  SyncError,
  SYNC_LIMITS,
  envelopeFromRow,
  requireDocumentId,
  validateAppend,
} from "../../../packages/sync-contract/contract.mjs";

const encoder = new TextEncoder();
const rowColumns =
  "c.document_id, c.seq, c.change_id, c.payload, c.envelope_version, c.crypto_alg, c.key_version, c.nonce";

// Errors crossing this boundary expose only protocol codes, never SQL, bound
// values, payloads, or the original exception's cause/stack.
function databaseError(error) {
  if (error instanceof SyncError) return error;
  const detail = `${error?.message ?? ""} ${error?.cause?.message ?? ""}`;
  if (detail.includes("NOT NULL constraint failed: changes.envelope")) {
    return new SyncError("change_conflict");
  }
  if (detail.includes("CHECK constraint failed: sync_sequence_range")) {
    return new SyncError("sequence_exhausted");
  }
  return new SyncError("temporarily_unavailable");
}

function requireOwner(ownerId) {
  if (typeof ownerId !== "string" || ownerId.length === 0)
    throw new SyncError("unauthorized");
}

export function createChangeRepository(
  db,
  { newDocumentId = () => crypto.randomUUID(), now = Date.now } = {},
) {
  async function owned(ownerId, documentId) {
    requireOwner(ownerId);
    requireDocumentId(documentId);
    try {
      const row = await db
        .prepare(
          "SELECT id, last_seq FROM documents WHERE id = ?1 AND owner_id = ?2",
        )
        .bind(documentId, ownerId)
        .first();
      if (!row) throw new SyncError("not_found");
      return row;
    } catch (error) {
      throw databaseError(error);
    }
  }

  return {
    async bootstrap(ownerId) {
      requireOwner(ownerId);
      const documentId = newDocumentId();
      requireDocumentId(documentId);
      const createdAt = now();
      try {
        const results = await db.batch([
          db
            .prepare(
              "INSERT INTO users (id, created_at) VALUES (?1, ?2) ON CONFLICT(id) DO NOTHING",
            )
            .bind(ownerId, createdAt),
          db
            .prepare(
              "INSERT INTO documents (id, owner_id, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(owner_id) DO NOTHING",
            )
            .bind(documentId, ownerId, createdAt),
          db
            .prepare("SELECT id, last_seq FROM documents WHERE owner_id = ?1")
            .bind(ownerId),
        ]);
        const document = results[2].results[0];
        return { document_id: document.id, cursor: document.last_seq };
      } catch (error) {
        throw databaseError(error);
      }
    },

    findOwnedDocument: owned,

    // Session-mode provisioning. The user row already exists from verified
    // registration; never create an unauthenticated user here. A missing
    // document for an existing session owner is completed idempotently, and
    // the winner is read on the primary in the same batch. The caller's owner
    // is always the server-resolved session user, never a request field.
    async provisionSessionDocument(ownerId) {
      requireOwner(ownerId);
      const documentId = newDocumentId();
      requireDocumentId(documentId);
      const createdAt = now();
      try {
        const results = await db.batch([
          db
            .prepare(
              "INSERT INTO documents (id, owner_id, last_seq, created_at) SELECT ?1, u.id, 0, ?2 FROM users u WHERE u.id = ?3 ON CONFLICT(owner_id) DO NOTHING",
            )
            .bind(documentId, createdAt, ownerId),
          db
            .prepare("SELECT id, last_seq FROM documents WHERE owner_id = ?1")
            .bind(ownerId),
        ]);
        const document = results[1].results[0];
        if (!document) throw new SyncError("temporarily_unavailable");
        return { document_id: document.id, cursor: document.last_seq };
      } catch (error) {
        throw databaseError(error);
      }
    },

    async append(ownerId, documentId, changes) {
      await owned(ownerId, documentId);
      const validated = validateAppend(changes, documentId);
      const scoped =
        "document_id = ?1 AND EXISTS (SELECT 1 FROM documents WHERE id = ?1 AND owner_id = ?2)";
      const statements = [
        db
          .prepare(
            "UPDATE documents SET last_seq = NULL WHERE id = ?1 AND owner_id = ?2 AND (" +
              "last_seq != (SELECT COUNT(*) FROM changes WHERE document_id = ?1) OR EXISTS (" +
              "SELECT 1 FROM changes WHERE document_id = ?1 AND seq > documents.last_seq))",
          )
          .bind(documentId, ownerId),
      ];
      for (const { wire, payload, nonce, canonical } of validated) {
        statements.push(
          db
            .prepare(
              `UPDATE changes SET envelope = NULL WHERE ${scoped} AND change_id = ?3 AND envelope != ?4`,
            )
            .bind(documentId, ownerId, wire.change_id, canonical),
          db
            .prepare(
              "UPDATE documents SET last_seq = last_seq + 1 WHERE id = ?1 AND owner_id = ?2 AND NOT EXISTS (SELECT 1 FROM changes WHERE document_id = ?1 AND change_id = ?3)",
            )
            .bind(documentId, ownerId, wire.change_id),
          db
            .prepare(
              "INSERT INTO changes (document_id, seq, change_id, payload, envelope_version, crypto_alg, key_version, nonce, envelope, created_at) SELECT ?1, last_seq, ?3, ?4, 1, ?5, ?6, ?7, ?8, ?9 FROM documents WHERE id = ?1 AND owner_id = ?2 AND NOT EXISTS (SELECT 1 FROM changes WHERE document_id = ?1 AND change_id = ?3)",
            )
            .bind(
              documentId,
              ownerId,
              wire.change_id,
              payload,
              wire.crypto_algorithm,
              wire.key_version,
              nonce,
              canonical,
              now(),
            ),
          db
            .prepare(
              `SELECT change_id, seq AS server_sequence FROM changes WHERE ${scoped} AND change_id = ?3`,
            )
            .bind(documentId, ownerId, wire.change_id),
        );
      }
      statements.push(
        db
          .prepare(
            "SELECT last_seq FROM documents WHERE id = ?1 AND owner_id = ?2",
          )
          .bind(documentId, ownerId),
      );
      try {
        const results = await db.batch(statements);
        const last = results.at(-1).results[0];
        if (!last) throw new SyncError("not_found");
        return {
          document_id: documentId,
          accepted: validated.map(
            (_, index) => results[4 + index * 4].results[0],
          ),
          cursor: last.last_seq,
        };
      } catch (error) {
        const detail = `${error?.message ?? ""} ${error?.cause?.message ?? ""}`;
        if (detail.includes("NOT NULL constraint failed: documents.last_seq")) {
          const document = await owned(ownerId, documentId);
          throw new SyncError("log_gap", document.last_seq);
        }
        throw databaseError(error);
      }
    },

    async lookupChange(ownerId, documentId, changeId) {
      await owned(ownerId, documentId);
      try {
        const row = await db
          .prepare(
            `SELECT ${rowColumns} FROM changes c JOIN documents d ON d.id = c.document_id WHERE c.document_id = ?1 AND d.owner_id = ?2 AND c.change_id = ?3`,
          )
          .bind(documentId, ownerId, changeId)
          .first();
        return row ? envelopeFromRow(row) : null;
      } catch (error) {
        throw databaseError(error);
      }
    },

    async pull(
      ownerId,
      documentId,
      { after = 0, limit = SYNC_LIMITS.maxPageChanges } = {},
    ) {
      await owned(ownerId, documentId);
      if (
        !Number.isSafeInteger(after) ||
        after < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > SYNC_LIMITS.maxPageChanges
      )
        throw new SyncError("malformed_request");
      try {
        const results = await db.batch([
          db
            .prepare(
              "SELECT last_seq FROM documents WHERE id = ?1 AND owner_id = ?2",
            )
            .bind(documentId, ownerId),
          db
            .prepare(
              "SELECT COUNT(*) AS count, MAX(c.seq) AS maximum FROM changes c JOIN documents d ON d.id = c.document_id WHERE d.id = ?1 AND d.owner_id = ?2",
            )
            .bind(documentId, ownerId),
          db
            .prepare(
              // Size only the candidate IDs before retrieving BLOBs. Include the
              // first payload crossing the byte budget for exact JSON sizing.
              `WITH candidates AS (
                SELECT c.seq, 4 * ((length(c.payload) + 2) / 3) AS payload_bytes
                FROM changes c JOIN documents d ON d.id = c.document_id
                WHERE d.id = ?1 AND d.owner_id = ?2 AND c.seq > ?3
                ORDER BY c.seq LIMIT ?4
              ), sizes AS (
                SELECT seq, payload_bytes,
                  SUM(payload_bytes) OVER (ORDER BY seq) AS encoded_bytes
                FROM candidates
              )
              SELECT ${rowColumns} FROM sizes s CROSS JOIN changes c
              WHERE c.document_id = ?1 AND c.seq = s.seq
                AND s.encoded_bytes - s.payload_bytes < ?5
              ORDER BY c.seq LIMIT ?4`,
            )
            .bind(
              documentId,
              ownerId,
              after,
              limit + 1,
              SYNC_LIMITS.maxResponseBytes,
            ),
        ]);
        const document = results[0].results[0];
        if (!document) throw new SyncError("not_found");
        const cursor = document.last_seq;
        const integrity = results[1].results[0];
        if (integrity.count !== cursor || (integrity.maximum ?? 0) !== cursor)
          throw new SyncError("log_gap", cursor);
        if (after > cursor) throw new SyncError("cursor_ahead", cursor);
        const rows = results[2].results;
        const response = {
          document_id: documentId,
          changes: [],
          next_cursor: after,
          has_more: rows.length > 0,
          cursor,
        };
        let changeBytes = 0;
        for (const row of rows.slice(0, limit)) {
          const change = envelopeFromRow(row);
          const entryBytes = encoder.encode(JSON.stringify(change)).length;
          const header = {
            ...response,
            changes: [],
            next_cursor: row.seq,
            has_more: row.seq < cursor,
          };
          const total =
            encoder.encode(JSON.stringify(header)).length +
            changeBytes +
            entryBytes +
            response.changes.length;
          if (total > SYNC_LIMITS.maxResponseBytes) {
            response.has_more = true;
            break;
          }
          changeBytes += entryBytes;
          response.changes.push(change);
          response.next_cursor = row.seq;
          response.has_more = row.seq < cursor;
        }
        return response;
      } catch (error) {
        throw databaseError(error);
      }
    },
  };
}
