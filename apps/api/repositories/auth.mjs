import {
  AUTH_STORAGE_LIMITS,
  AuthStorageError,
  databaseError,
  defaultAccountHandle,
  defaultAccountId,
  defaultChallengeId,
  defaultDocumentId,
  normalizeAssertion,
  normalizeCredential,
  normalizeSessionCredentials,
  requireAccountHandle,
  requireBatchLimit,
  requireChallengeId,
  requireCredentialId,
  requireDigest,
  requireDisplayName,
  requirePurpose,
  requireRevokeReason,
  requireTimestamp,
  requireUserId,
  retryAfterSeconds,
  toBytes,
} from "./auth-data.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function timestampOrUnavailable(value) {
  return requireTimestamp(value, "temporarily_unavailable");
}

function stableDocumentId(value) {
  if (typeof value !== "string" || !UUID.test(value))
    throw new AuthStorageError("temporarily_unavailable");
  return value;
}

async function guarded(operation) {
  try {
    return await operation();
  } catch (error) {
    throw databaseError(error);
  }
}

function credentialRow(row) {
  return {
    credentialId: row.credential_id,
    userId: row.user_id,
    publicKey: toBytes(row.public_key),
    counter: row.counter,
    backupEligible: row.backup_eligible === 1,
    backupState: row.backup_state === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    accountHandle: row.handle ?? null,
    displayName: row.display_name ?? null,
  };
}

function sessionRow(row, current) {
  const recentAuthAt = row.recent_auth_at ?? null;
  return {
    digest: toBytes(row.digest),
    userId: row.user_id,
    csrfDigest: toBytes(row.csrf_digest),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    idleExpiresAt: row.idle_expires_at,
    recentAuthAt,
    recentAuthExpiresAt:
      recentAuthAt === null
        ? null
        : recentAuthAt + AUTH_STORAGE_LIMITS.recentAuthWindowMs,
    recentAuth:
      recentAuthAt !== null &&
      recentAuthAt > current - AUTH_STORAGE_LIMITS.recentAuthWindowMs,
    revokedAt: row.revoked_at ?? null,
    revokeReason: row.revoke_reason ?? null,
    account: {
      userId: row.user_id,
      handle: row.handle,
      displayName: row.display_name,
    },
  };
}

export function createAuthRepository(
  db,
  {
    now = Date.now,
    newAccountId = defaultAccountId,
    newAccountHandle = defaultAccountHandle,
    newDocumentId = defaultDocumentId,
    newChallengeId = defaultChallengeId,
  } = {},
) {
  function currentTime() {
    return timestampOrUnavailable(now());
  }

  function generateAccountId() {
    return requireUserId(newAccountId(), "temporarily_unavailable");
  }

  function generateAccountHandle() {
    return requireAccountHandle(newAccountHandle(), "temporarily_unavailable");
  }

  function generateDocumentId() {
    return stableDocumentId(newDocumentId());
  }

  function generateChallengeId() {
    return requireChallengeId(newChallengeId(), "temporarily_unavailable");
  }

  async function sessionState(sessionDigest, userId, current) {
    const row = await guarded(() =>
      db
        .prepare(
          "SELECT s.user_id, s.revoked_at, s.expires_at, s.idle_expires_at, s.recent_auth_at, u.handle, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.digest = ?1",
        )
        .bind(sessionDigest)
        .first(),
    );
    if (
      !row ||
      row.user_id !== userId ||
      row.handle === null ||
      row.display_name === null ||
      row.revoked_at !== null ||
      row.expires_at <= current ||
      row.idle_expires_at <= current
    )
      throw new AuthStorageError("unauthorized");
    return row;
  }

  async function diagnoseSession(sessionDigest, userId, current) {
    const row = await sessionState(sessionDigest, userId, current);
    if (
      row.recent_auth_at === null ||
      row.recent_auth_at <= current - AUTH_STORAGE_LIMITS.recentAuthWindowMs
    )
      throw new AuthStorageError("recent_auth_required");
  }

  async function diagnoseAddCredential(
    sessionDigest,
    userId,
    credentialId,
    current,
  ) {
    await diagnoseSession(sessionDigest, userId, current);
    const existing = await guarded(() =>
      db
        .prepare("SELECT user_id FROM credentials WHERE credential_id = ?1")
        .bind(credentialId)
        .first(),
    );
    if (existing) throw new AuthStorageError("credential_conflict");
    const count = await guarded(() =>
      db
        .prepare("SELECT COUNT(*) AS count FROM credentials WHERE user_id = ?1")
        .bind(userId)
        .first(),
    );
    if (count.count >= AUTH_STORAGE_LIMITS.credentialLimit)
      throw new AuthStorageError("credential_limit");
    throw new AuthStorageError("temporarily_unavailable");
  }

  async function diagnoseRemoveCredential(
    sessionDigest,
    userId,
    credentialId,
    current,
  ) {
    await diagnoseSession(sessionDigest, userId, current);
    const existing = await guarded(() =>
      db
        .prepare(
          "SELECT 1 AS found FROM credentials WHERE credential_id = ?1 AND user_id = ?2",
        )
        .bind(credentialId, userId)
        .first(),
    );
    if (!existing) throw new AuthStorageError("not_found");
    const count = await guarded(() =>
      db
        .prepare("SELECT COUNT(*) AS count FROM credentials WHERE user_id = ?1")
        .bind(userId)
        .first(),
    );
    if (count.count <= 1) throw new AuthStorageError("last_credential");
    throw new AuthStorageError("temporarily_unavailable");
  }

  async function cleanupChallengeRows(limit) {
    const checkedLimit = requireBatchLimit(limit);
    const current = currentTime();
    const result = await guarded(() =>
      db
        .prepare(
          "DELETE FROM challenges WHERE id IN (SELECT id FROM challenges WHERE expires_at <= ?1 ORDER BY expires_at LIMIT ?2)",
        )
        .bind(current, checkedLimit)
        .run(),
    );
    return result.meta.changes;
  }

  async function cleanupSessionRows(limit) {
    const checkedLimit = requireBatchLimit(limit);
    const current = currentTime();
    const result = await guarded(() =>
      db
        .prepare(
          "DELETE FROM sessions WHERE digest IN (SELECT digest FROM sessions WHERE expires_at <= ?1 OR idle_expires_at <= ?1 OR (revoked_at IS NOT NULL AND revoked_at <= ?2) ORDER BY expires_at LIMIT ?3)",
        )
        .bind(
          current,
          current - AUTH_STORAGE_LIMITS.revokedSessionRetentionMs,
          checkedLimit,
        )
        .run(),
    );
    return result.meta.changes;
  }

  async function insertChallenge({
    purpose,
    challengeDigest,
    bindingDigest,
    accountHandle = null,
    displayName = null,
    userId = null,
    sessionDigest = null,
  }) {
    const current = currentTime();
    const challengeId = generateChallengeId();
    const expiresAt = current + AUTH_STORAGE_LIMITS.challengeLifetimeMs;
    const sessionBound = purpose === "add_credential" || purpose === "step_up";
    const sessionGuard = sessionBound
      ? " AND EXISTS (SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.digest = ? AND s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND s.idle_expires_at > ? AND u.handle IS NOT NULL AND u.display_name IS NOT NULL)"
      : "";
    const sql =
      "INSERT INTO challenges (id, challenge_digest, binding_digest, purpose, account_handle, display_name, user_id, session_digest, created_at, expires_at, consumed_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL WHERE (SELECT COUNT(*) FROM challenges WHERE binding_digest = ? AND consumed_at IS NULL AND expires_at > ?) < ?" +
      sessionGuard;
    const bindings = [
      challengeId,
      challengeDigest,
      bindingDigest,
      purpose,
      accountHandle,
      displayName,
      userId,
      sessionDigest,
      current,
      expiresAt,
      bindingDigest,
      current,
      AUTH_STORAGE_LIMITS.challengeCapPerBinding,
    ];
    if (sessionBound) bindings.push(sessionDigest, userId, current, current);
    let results;
    try {
      results = await db.batch([
        db
          .prepare(
            "DELETE FROM challenges WHERE id IN (SELECT id FROM challenges WHERE expires_at <= ?1 ORDER BY expires_at LIMIT ?2)",
          )
          .bind(current, AUTH_STORAGE_LIMITS.challengeCleanupBatch),
        db.prepare(sql).bind(...bindings),
        db
          .prepare(
            "SELECT id, purpose, account_handle, display_name, user_id, session_digest, created_at, expires_at FROM challenges WHERE id = ?1",
          )
          .bind(challengeId),
      ]);
    } catch (error) {
      throw databaseError(error);
    }

    if (results[1].meta.changes === 0) {
      if (sessionBound) await sessionState(sessionDigest, userId, current);
      const oldest = await guarded(() =>
        db
          .prepare(
            "SELECT MIN(expires_at) AS expires_at FROM challenges WHERE binding_digest = ?1 AND consumed_at IS NULL AND expires_at > ?2",
          )
          .bind(bindingDigest, current)
          .first(),
      );
      throw new AuthStorageError("rate_limited", {
        retryAfter:
          oldest?.expires_at === null || oldest?.expires_at === undefined
            ? 1
            : retryAfterSeconds(oldest.expires_at, current),
      });
    }

    const row = results[2].results[0];
    return {
      challengeId: row.id,
      purpose: row.purpose,
      accountHandle: row.account_handle,
      displayName: row.display_name,
      userId: row.user_id,
      sessionDigest: row.session_digest ? toBytes(row.session_digest) : null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  return {
    newAccountHandle() {
      return generateAccountHandle();
    },

    async issueRegistrationChallenge({
      challengeDigest,
      bindingDigest,
      displayName,
    }) {
      const accountHandle = generateAccountHandle();
      const name = requireDisplayName(displayName);
      return insertChallenge({
        purpose: "register",
        challengeDigest: requireDigest(challengeDigest),
        bindingDigest: requireDigest(bindingDigest),
        accountHandle,
        displayName: name,
      });
    },

    async issueSignInChallenge({ challengeDigest, bindingDigest }) {
      return insertChallenge({
        purpose: "sign_in",
        challengeDigest: requireDigest(challengeDigest),
        bindingDigest: requireDigest(bindingDigest),
      });
    },

    async issueSessionChallenge({
      purpose,
      challengeDigest,
      bindingDigest,
      userId,
      sessionDigest,
    }) {
      const checkedPurpose = requirePurpose(purpose);
      if (checkedPurpose !== "add_credential" && checkedPurpose !== "step_up")
        throw new AuthStorageError("malformed_request");
      return insertChallenge({
        purpose: checkedPurpose,
        challengeDigest: requireDigest(challengeDigest),
        bindingDigest: requireDigest(bindingDigest),
        userId: requireUserId(userId),
        sessionDigest: requireDigest(sessionDigest),
      });
    },

    async consumeChallenge({
      challengeId,
      challengeDigest,
      bindingDigest,
      purpose,
      userId,
      sessionDigest,
    }) {
      const checkedId = requireChallengeId(
        challengeId,
        "authentication_failed",
      );
      const checkedDigest = requireDigest(
        challengeDigest,
        "authentication_failed",
      );
      const checkedBinding = requireDigest(
        bindingDigest,
        "authentication_failed",
      );
      const checkedPurpose = requirePurpose(purpose, "authentication_failed");
      const current = currentTime();
      let conditions =
        "id = ?1 AND challenge_digest = ?2 AND binding_digest = ?3 AND purpose = ?4 AND consumed_at IS NULL AND expires_at > ?5";
      const bindings = [
        checkedId,
        checkedDigest,
        checkedBinding,
        checkedPurpose,
        current,
      ];
      if (checkedPurpose === "register") {
        // The pending account belongs to this server-owned challenge row.
        // Registration's verify body does not send an account handle.
        conditions += " AND account_handle IS NOT NULL";
      } else if (checkedPurpose === "sign_in") {
        conditions += " AND account_handle IS NULL";
      } else {
        const checkedUser = requireUserId(userId, "authentication_failed");
        const checkedSession = requireDigest(
          sessionDigest,
          "authentication_failed",
        );
        conditions +=
          " AND user_id = ?6 AND session_digest = ?7 AND EXISTS (SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.digest = ?7 AND s.user_id = ?6 AND s.revoked_at IS NULL AND s.expires_at > ?5 AND s.idle_expires_at > ?5 AND u.handle IS NOT NULL AND u.display_name IS NOT NULL)";
        bindings.push(checkedUser, checkedSession);
      }
      let results;
      try {
        results = await db.batch([
          db
            .prepare(
              `UPDATE challenges SET consumed_at = ?5 WHERE ${conditions}`,
            )
            .bind(...bindings),
          db
            .prepare(
              "SELECT id, purpose, account_handle, display_name, user_id, session_digest, created_at, expires_at, consumed_at FROM challenges WHERE id = ?1",
            )
            .bind(checkedId),
        ]);
      } catch (error) {
        throw databaseError(error);
      }
      if (results[0].meta.changes !== 1)
        throw new AuthStorageError("authentication_failed");
      const row = results[1].results[0];
      return {
        challengeId: row.id,
        purpose: row.purpose,
        accountHandle: row.account_handle,
        displayName: row.display_name,
        userId: row.user_id,
        sessionDigest: row.session_digest ? toBytes(row.session_digest) : null,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        consumedAt: row.consumed_at,
      };
    },

    // Ceremony verification consumes by server-owned challenge ID, purpose,
    // and browser binding before the expensive verifier runs. The stored
    // challenge digest is returned so the verifier's expectedChallenge
    // callback can compare it against the clientDataJSON challenge. No caller
    // supplies a raw challenge or account handle to this primitive.
    async consumeCeremonyChallenge({
      challengeId,
      bindingDigest,
      purpose,
      userId,
      sessionDigest,
    }) {
      const checkedId = requireChallengeId(
        challengeId,
        "authentication_failed",
      );
      const checkedBinding = requireDigest(
        bindingDigest,
        "authentication_failed",
      );
      const checkedPurpose = requirePurpose(purpose, "authentication_failed");
      const current = currentTime();
      let conditions =
        "id = ?1 AND binding_digest = ?2 AND purpose = ?3 AND consumed_at IS NULL AND expires_at > ?4";
      const bindings = [checkedId, checkedBinding, checkedPurpose, current];
      if (checkedPurpose === "register") {
        conditions +=
          " AND account_handle IS NOT NULL AND display_name IS NOT NULL";
      } else if (checkedPurpose === "sign_in") {
        conditions += " AND account_handle IS NULL";
      } else {
        const checkedUser = requireUserId(userId, "authentication_failed");
        const checkedSession = requireDigest(
          sessionDigest,
          "authentication_failed",
        );
        conditions +=
          " AND user_id = ?5 AND session_digest = ?6 AND EXISTS (SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.digest = ?6 AND s.user_id = ?5 AND s.revoked_at IS NULL AND s.expires_at > ?4 AND s.idle_expires_at > ?4 AND u.handle IS NOT NULL AND u.display_name IS NOT NULL)";
        bindings.push(checkedUser, checkedSession);
      }
      let results;
      try {
        results = await db.batch([
          db
            .prepare(
              `UPDATE challenges SET consumed_at = ?4 WHERE ${conditions}`,
            )
            .bind(...bindings),
          db
            .prepare(
              "SELECT id, purpose, challenge_digest, account_handle, display_name, user_id, session_digest, created_at, expires_at, consumed_at FROM challenges WHERE id = ?1",
            )
            .bind(checkedId),
        ]);
      } catch (error) {
        throw databaseError(error);
      }
      if (results[0].meta.changes !== 1)
        throw new AuthStorageError("authentication_failed");
      const row = results[1].results[0];
      return {
        challengeId: row.id,
        purpose: row.purpose,
        challengeDigest: toBytes(row.challenge_digest),
        accountHandle: row.account_handle,
        displayName: row.display_name,
        userId: row.user_id,
        sessionDigest: row.session_digest ? toBytes(row.session_digest) : null,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        consumedAt: row.consumed_at,
      };
    },

    async cleanupChallenges(limit = AUTH_STORAGE_LIMITS.cleanupBatch) {
      return cleanupChallengeRows(limit);
    },

    async completeRegistration({
      challengeId,
      bindingDigest,
      credential,
      session,
    }) {
      const checkedChallengeId = requireChallengeId(
        challengeId,
        "authentication_failed",
      );
      const checkedBinding = requireDigest(
        bindingDigest,
        "authentication_failed",
      );
      const checkedCredential = normalizeCredential(credential);
      const checkedSession = normalizeSessionCredentials(session);
      const userId = generateAccountId();
      const documentId = generateDocumentId();
      const current = currentTime();
      const absoluteExpiry =
        current + AUTH_STORAGE_LIMITS.sessionAbsoluteLifetimeMs;
      const idleExpiry = current + AUTH_STORAGE_LIMITS.sessionIdleLifetimeMs;
      let results;
      try {
        results = await db.batch([
          db
            .prepare(
              "INSERT INTO users (id, handle, display_name, created_at) SELECT ?1, c.account_handle, c.display_name, ?4 FROM challenges c WHERE c.id = ?2 AND c.purpose = 'register' AND c.consumed_at IS NOT NULL AND c.consumed_at <= ?4 AND c.expires_at > ?4 AND c.binding_digest = ?3",
            )
            .bind(userId, checkedChallengeId, checkedBinding, current),
          db
            .prepare(
              "INSERT INTO credentials (credential_id, user_id, public_key, counter, backup_eligible, backup_state, created_at, last_used_at) SELECT ?5, u.id, ?6, ?7, ?8, ?9, ?4, ?4 FROM users u WHERE u.id = ?1",
            )
            .bind(
              userId,
              checkedChallengeId,
              checkedBinding,
              current,
              checkedCredential.credentialId,
              checkedCredential.publicKey,
              checkedCredential.counter,
              checkedCredential.backupEligible ? 1 : 0,
              checkedCredential.backupState ? 1 : 0,
            ),
          db
            .prepare(
              "INSERT INTO documents (id, owner_id, last_seq, created_at) SELECT ?5, u.id, 0, ?4 FROM users u WHERE u.id = ?1",
            )
            .bind(
              userId,
              checkedChallengeId,
              checkedBinding,
              current,
              documentId,
            ),
          db
            .prepare(
              "INSERT INTO sessions (digest, user_id, csrf_digest, created_at, last_seen_at, expires_at, idle_expires_at, recent_auth_at) SELECT ?5, u.id, ?6, ?4, ?4, ?7, ?8, ?4 FROM users u WHERE u.id = ?1",
            )
            .bind(
              userId,
              checkedChallengeId,
              checkedBinding,
              current,
              checkedSession.digest,
              checkedSession.csrfDigest,
              absoluteExpiry,
              idleExpiry,
            ),
          db
            .prepare(
              "SELECT u.id AS user_id, u.handle, u.display_name, d.id AS document_id, d.last_seq, s.digest, s.csrf_digest, s.created_at AS session_created_at, s.last_seen_at, s.expires_at, s.idle_expires_at, s.recent_auth_at, s.revoked_at, s.revoke_reason FROM users u JOIN documents d ON d.owner_id = u.id JOIN sessions s ON s.user_id = u.id WHERE u.id = ?1 AND s.digest = ?2",
            )
            .bind(userId, checkedSession.digest),
        ]);
      } catch (error) {
        throw databaseError(error);
      }
      const row = results[4].results[0];
      if (!row) throw new AuthStorageError("authentication_failed");
      return {
        account: {
          userId: row.user_id,
          handle: row.handle,
          displayName: row.display_name,
        },
        credential: {
          credentialId: checkedCredential.credentialId,
          userId: row.user_id,
          publicKey: checkedCredential.publicKey,
          counter: checkedCredential.counter,
          backupEligible: checkedCredential.backupEligible,
          backupState: checkedCredential.backupState,
          createdAt: current,
          lastUsedAt: current,
        },
        document: { documentId: row.document_id, cursor: row.last_seq },
        session: sessionRow(
          {
            digest: row.digest,
            user_id: row.user_id,
            csrf_digest: row.csrf_digest,
            created_at: row.session_created_at,
            last_seen_at: row.last_seen_at,
            expires_at: row.expires_at,
            idle_expires_at: row.idle_expires_at,
            recent_auth_at: row.recent_auth_at,
            revoked_at: row.revoked_at,
            revoke_reason: row.revoke_reason,
            handle: row.handle,
            display_name: row.display_name,
          },
          current,
        ),
      };
    },

    // Sign-in finalization is one batch: recheck the credential, ownership,
    // backup eligibility, and counter guard; insert the replacement session;
    // and revoke the presented session. A failed guard changes no row, and a
    // failed insert rolls the counter update back with the batch transaction.
    async completeSignIn({
      challengeId,
      bindingDigest,
      credentialId,
      userId,
      newCounter,
      backupEligible,
      backupState,
      session,
      presentedSessionDigest = null,
    }) {
      const checkedChallengeId = requireChallengeId(
        challengeId,
        "authentication_failed",
      );
      const checkedBinding = requireDigest(
        bindingDigest,
        "authentication_failed",
      );
      const checked = normalizeAssertion({
        credentialId,
        userId,
        newCounter,
        backupEligible,
        backupState,
      });
      const checkedSession = normalizeSessionCredentials(session);
      const current = currentTime();
      const absoluteExpiry =
        current + AUTH_STORAGE_LIMITS.sessionAbsoluteLifetimeMs;
      const idleExpiry = current + AUTH_STORAGE_LIMITS.sessionIdleLifetimeMs;
      const statements = [
        db
          .prepare(
            "UPDATE credentials SET counter = CASE WHEN backup_eligible = 1 THEN MAX(counter, ?2) ELSE ?2 END, backup_state = ?3, last_used_at = ?4 WHERE credential_id = ?1 AND user_id = ?5 AND backup_eligible = ?6 AND (backup_eligible = 1 OR ?2 > counter OR (counter = 0 AND ?2 = 0)) AND EXISTS (SELECT 1 FROM challenges c WHERE c.id = ?7 AND c.purpose = 'sign_in' AND c.consumed_at IS NOT NULL AND c.consumed_at <= ?4 AND c.expires_at > ?4 AND c.binding_digest = ?8) AND EXISTS (SELECT 1 FROM users u WHERE u.id = ?5 AND u.handle IS NOT NULL AND u.display_name IS NOT NULL)",
          )
          .bind(
            checked.credentialId,
            checked.newCounter,
            checked.backupState ? 1 : 0,
            current,
            checked.userId,
            checked.backupEligible ? 1 : 0,
            checkedChallengeId,
            checkedBinding,
          ),
      ];
      const insertIndex = statements.length;
      statements.push(
        db
          .prepare(
            "INSERT INTO sessions (digest, user_id, csrf_digest, created_at, last_seen_at, expires_at, idle_expires_at, recent_auth_at) SELECT ?1, u.id, ?2, ?3, ?3, ?4, ?5, ?3 FROM users u WHERE u.id = ?6 AND u.handle IS NOT NULL AND u.display_name IS NOT NULL AND changes() = 1",
          )
          .bind(
            checkedSession.digest,
            checkedSession.csrfDigest,
            current,
            absoluteExpiry,
            idleExpiry,
            checked.userId,
          ),
      );
      if (
        presentedSessionDigest !== undefined &&
        presentedSessionDigest !== null
      ) {
        statements.push(
          db
            .prepare(
              "UPDATE sessions SET revoked_at = ?2, revoke_reason = 'sign_in_rotation' WHERE digest = ?1 AND digest != ?3 AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM sessions s2 WHERE s2.digest = ?3 AND s2.user_id = ?4 AND s2.revoked_at IS NULL)",
            )
            .bind(
              requireDigest(presentedSessionDigest, "authentication_failed"),
              current,
              checkedSession.digest,
              checked.userId,
            ),
        );
      }
      const selectIndex = statements.length;
      statements.push(
        db
          .prepare(
            "SELECT s.digest, s.user_id, s.csrf_digest, s.created_at, s.last_seen_at, s.expires_at, s.idle_expires_at, s.recent_auth_at, s.revoked_at, s.revoke_reason, u.handle, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.digest = ?1",
          )
          .bind(checkedSession.digest),
      );
      let results;
      try {
        results = await db.batch(statements);
      } catch (error) {
        throw databaseError(error);
      }
      if (results[insertIndex].meta.changes !== 1)
        throw new AuthStorageError("authentication_failed");
      const row = results[selectIndex].results[0];
      if (!row) throw new AuthStorageError("temporarily_unavailable");
      return {
        session: sessionRow(row, current),
      };
    },

    // Step-up finalization keeps the presented session and only raises recent
    // auth. The credential counter update and the session recent-auth update
    // run in the same batch, guarded by changes() from the credential update.
    async completeStepUp({
      challengeId,
      bindingDigest,
      credentialId,
      userId,
      newCounter,
      backupEligible,
      backupState,
      sessionDigest,
    }) {
      const checkedChallengeId = requireChallengeId(
        challengeId,
        "authentication_failed",
      );
      const checkedBinding = requireDigest(
        bindingDigest,
        "authentication_failed",
      );
      const checkedSession = requireDigest(
        sessionDigest,
        "authentication_failed",
      );
      const checked = normalizeAssertion({
        credentialId,
        userId,
        newCounter,
        backupEligible,
        backupState,
      });
      const current = currentTime();
      let results;
      try {
        results = await db.batch([
          db
            .prepare(
              "UPDATE credentials SET counter = CASE WHEN backup_eligible = 1 THEN MAX(counter, ?2) ELSE ?2 END, backup_state = ?3, last_used_at = ?4 WHERE credential_id = ?1 AND user_id = ?5 AND backup_eligible = ?6 AND (backup_eligible = 1 OR ?2 > counter OR (counter = 0 AND ?2 = 0)) AND EXISTS (SELECT 1 FROM challenges c WHERE c.id = ?7 AND c.purpose = 'step_up' AND c.consumed_at IS NOT NULL AND c.consumed_at <= ?4 AND c.expires_at > ?4 AND c.binding_digest = ?8 AND c.user_id = ?5 AND c.session_digest = ?9) AND EXISTS (SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.digest = ?9 AND s.user_id = ?5 AND s.revoked_at IS NULL AND s.expires_at > ?4 AND s.idle_expires_at > ?4 AND u.handle IS NOT NULL AND u.display_name IS NOT NULL)",
            )
            .bind(
              checked.credentialId,
              checked.newCounter,
              checked.backupState ? 1 : 0,
              current,
              checked.userId,
              checked.backupEligible ? 1 : 0,
              checkedChallengeId,
              checkedBinding,
              checkedSession,
            ),
          db
            .prepare(
              "UPDATE sessions SET recent_auth_at = ?3 WHERE digest = ?1 AND user_id = ?2 AND revoked_at IS NULL AND expires_at > ?3 AND idle_expires_at > ?3 AND EXISTS (SELECT 1 FROM users u WHERE u.id = sessions.user_id AND u.handle IS NOT NULL AND u.display_name IS NOT NULL) AND changes() = 1",
            )
            .bind(checkedSession, checked.userId, current),
          db
            .prepare(
              "SELECT s.digest, s.user_id, s.csrf_digest, s.created_at, s.last_seen_at, s.expires_at, s.idle_expires_at, s.recent_auth_at, s.revoked_at, s.revoke_reason, u.handle, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.digest = ?1 AND s.user_id = ?2 AND s.revoked_at IS NULL AND s.expires_at > ?3 AND s.idle_expires_at > ?3 AND u.handle IS NOT NULL AND u.display_name IS NOT NULL",
            )
            .bind(checkedSession, checked.userId, current),
        ]);
      } catch (error) {
        throw databaseError(error);
      }
      if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1)
        throw new AuthStorageError("authentication_failed");
      const row = results[2].results[0];
      if (!row) throw new AuthStorageError("authentication_failed");
      return sessionRow(row, current);
    },

    async createSession({ userId, digest, csrfDigest, recentAuthAt }) {
      const checkedUser = requireUserId(userId);
      const checkedDigest = requireDigest(digest);
      const checkedCsrf = requireDigest(csrfDigest);
      const current = currentTime();
      const recent = requireTimestamp(
        recentAuthAt ?? current,
        "malformed_request",
      );
      if (recent > current) throw new AuthStorageError("malformed_request");
      const absoluteExpiry =
        current + AUTH_STORAGE_LIMITS.sessionAbsoluteLifetimeMs;
      const idleExpiry = current + AUTH_STORAGE_LIMITS.sessionIdleLifetimeMs;
      let results;
      try {
        results = await db.batch([
          db
            .prepare(
              "INSERT INTO sessions (digest, user_id, csrf_digest, created_at, last_seen_at, expires_at, idle_expires_at, recent_auth_at) SELECT ?1, u.id, ?2, ?3, ?3, ?4, ?5, ?6 FROM users u WHERE u.id = ?7 AND u.handle IS NOT NULL AND u.display_name IS NOT NULL",
            )
            .bind(
              checkedDigest,
              checkedCsrf,
              current,
              absoluteExpiry,
              idleExpiry,
              recent,
              checkedUser,
            ),
          db
            .prepare(
              "SELECT s.digest, s.user_id, s.csrf_digest, s.created_at, s.last_seen_at, s.expires_at, s.idle_expires_at, s.recent_auth_at, s.revoked_at, s.revoke_reason, u.handle, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.digest = ?1",
            )
            .bind(checkedDigest),
        ]);
      } catch (error) {
        throw databaseError(error);
      }
      if (results[0].meta.changes !== 1)
        throw new AuthStorageError("not_found");
      return sessionRow(results[1].results[0], current);
    },

    async resolveSession(digest, { touch = true } = {}) {
      const checkedDigest = requireDigest(digest);
      const current = currentTime();
      const statements = [];
      if (touch) {
        statements.push(
          db
            .prepare(
              "UPDATE sessions SET last_seen_at = ?2, idle_expires_at = ?3 WHERE digest = ?1 AND revoked_at IS NULL AND expires_at > ?2 AND idle_expires_at > ?2 AND last_seen_at <= ?4",
            )
            .bind(
              checkedDigest,
              current,
              current + AUTH_STORAGE_LIMITS.sessionIdleLifetimeMs,
              current - AUTH_STORAGE_LIMITS.sessionLastSeenWriteMs,
            ),
        );
      }
      statements.push(
        db
          .prepare(
            "SELECT s.digest, s.user_id, s.csrf_digest, s.created_at, s.last_seen_at, s.expires_at, s.idle_expires_at, s.recent_auth_at, s.revoked_at, s.revoke_reason, u.handle, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.digest = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2 AND s.idle_expires_at > ?2 AND u.handle IS NOT NULL AND u.display_name IS NOT NULL",
          )
          .bind(checkedDigest, current),
      );
      let results;
      try {
        results = await db.batch(statements);
      } catch (error) {
        throw databaseError(error);
      }
      const row = results.at(-1).results[0];
      return row ? sessionRow(row, current) : null;
    },

    async recordRecentAuth({ sessionDigest, userId }) {
      const checkedDigest = requireDigest(sessionDigest);
      const checkedUser = requireUserId(userId);
      const current = currentTime();
      let results;
      try {
        results = await db.batch([
          db
            .prepare(
              "UPDATE sessions SET recent_auth_at = ?3 WHERE digest = ?1 AND user_id = ?2 AND revoked_at IS NULL AND expires_at > ?3 AND idle_expires_at > ?3 AND EXISTS (SELECT 1 FROM users u WHERE u.id = sessions.user_id AND u.handle IS NOT NULL AND u.display_name IS NOT NULL)",
            )
            .bind(checkedDigest, checkedUser, current),
          db
            .prepare(
              "SELECT s.digest, s.user_id, s.csrf_digest, s.created_at, s.last_seen_at, s.expires_at, s.idle_expires_at, s.recent_auth_at, s.revoked_at, s.revoke_reason, u.handle, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.digest = ?1 AND s.user_id = ?2 AND s.revoked_at IS NULL AND s.expires_at > ?3 AND s.idle_expires_at > ?3 AND u.handle IS NOT NULL AND u.display_name IS NOT NULL",
            )
            .bind(checkedDigest, checkedUser, current),
        ]);
      } catch (error) {
        throw databaseError(error);
      }
      const row = results[1].results[0];
      if (!row || results[0].meta.changes !== 1)
        throw new AuthStorageError("unauthorized");
      return sessionRow(row, current);
    },

    async rotateSession({ presentedDigest, userId, digest, csrfDigest }) {
      const checkedUser = requireUserId(userId);
      const checkedDigest = requireDigest(digest);
      const checkedCsrf = requireDigest(csrfDigest);
      const current = currentTime();
      const absoluteExpiry =
        current + AUTH_STORAGE_LIMITS.sessionAbsoluteLifetimeMs;
      const idleExpiry = current + AUTH_STORAGE_LIMITS.sessionIdleLifetimeMs;
      const statements = [];
      let revokeIndex = -1;
      if (presentedDigest !== undefined && presentedDigest !== null) {
        const checkedPresented = requireDigest(presentedDigest);
        revokeIndex = statements.length;
        statements.push(
          db
            .prepare(
              "UPDATE sessions SET revoked_at = ?2, revoke_reason = 'sign_in_rotation' WHERE digest = ?1 AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM users u WHERE u.id = ?3 AND u.handle IS NOT NULL AND u.display_name IS NOT NULL)",
            )
            .bind(checkedPresented, current, checkedUser),
        );
      }
      const insertIndex = statements.length;
      statements.push(
        db
          .prepare(
            "INSERT INTO sessions (digest, user_id, csrf_digest, created_at, last_seen_at, expires_at, idle_expires_at, recent_auth_at) SELECT ?1, u.id, ?2, ?3, ?3, ?4, ?5, ?3 FROM users u WHERE u.id = ?6 AND u.handle IS NOT NULL AND u.display_name IS NOT NULL",
          )
          .bind(
            checkedDigest,
            checkedCsrf,
            current,
            absoluteExpiry,
            idleExpiry,
            checkedUser,
          ),
      );
      const selectIndex = statements.length;
      statements.push(
        db
          .prepare(
            "SELECT s.digest, s.user_id, s.csrf_digest, s.created_at, s.last_seen_at, s.expires_at, s.idle_expires_at, s.recent_auth_at, s.revoked_at, s.revoke_reason, u.handle, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.digest = ?1",
          )
          .bind(checkedDigest),
      );
      let results;
      try {
        results = await db.batch(statements);
      } catch (error) {
        throw databaseError(error);
      }
      if (results[insertIndex].meta.changes !== 1)
        throw new AuthStorageError("not_found");
      return {
        session: sessionRow(results[selectIndex].results[0], current),
        revokedPrevious:
          revokeIndex >= 0 && results[revokeIndex].meta.changes === 1,
      };
    },

    async revokeSession({
      sessionDigest,
      reason = "logout",
      csrfDigest = null,
    }) {
      const checkedDigest = requireDigest(sessionDigest);
      const checkedReason = requireRevokeReason(reason);
      const checkedCsrf =
        csrfDigest === null ? null : requireDigest(csrfDigest);
      const current = currentTime();
      const csrfGuard = checkedCsrf === null ? "" : " AND csrf_digest = ?4";
      const bindings = [checkedDigest, current, checkedReason];
      if (checkedCsrf !== null) bindings.push(checkedCsrf);
      const result = await guarded(() =>
        db
          .prepare(
            `UPDATE sessions SET revoked_at = ?2, revoke_reason = ?3 WHERE digest = ?1${csrfGuard} AND revoked_at IS NULL`,
          )
          .bind(...bindings)
          .run(),
      );
      return result.meta.changes === 1;
    },

    async revokeAllSessions({ userId, reason = "logout_all" }) {
      const checkedUser = requireUserId(userId);
      const checkedReason = requireRevokeReason(reason);
      const current = currentTime();
      const result = await guarded(() =>
        db
          .prepare(
            "UPDATE sessions SET revoked_at = ?2, revoke_reason = ?3 WHERE user_id = ?1 AND revoked_at IS NULL",
          )
          .bind(checkedUser, current, checkedReason)
          .run(),
      );
      return result.meta.changes;
    },

    // Logout-all is a sensitive auth mutation: the update rechecks the
    // presented session and its recent-auth window in the same SQL statement
    // that revokes every account session. A concurrent revocation or an
    // expired recent-auth window changes no row; diagnosis then maps the race
    // to 401 or 403 without revoking extra sessions.
    async revokeAllSessionsForSession({
      sessionDigest,
      userId,
      csrfDigest,
      reason = "logout_all",
    }) {
      const checkedDigest = requireDigest(sessionDigest);
      const checkedUser = requireUserId(userId);
      const checkedCsrf = requireDigest(csrfDigest);
      const checkedReason = requireRevokeReason(reason);
      const current = currentTime();
      const recentCutoff = current - AUTH_STORAGE_LIMITS.recentAuthWindowMs;
      let result;
      try {
        result = await db
          .prepare(
            "UPDATE sessions SET revoked_at = ?2, revoke_reason = ?3 WHERE user_id = ?1 AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.digest = ?4 AND s.user_id = ?1 AND s.csrf_digest = ?6 AND s.revoked_at IS NULL AND s.expires_at > ?2 AND s.idle_expires_at > ?2 AND s.recent_auth_at IS NOT NULL AND s.recent_auth_at > ?5 AND u.handle IS NOT NULL AND u.display_name IS NOT NULL)",
          )
          .bind(
            checkedUser,
            current,
            checkedReason,
            checkedDigest,
            recentCutoff,
            checkedCsrf,
          )
          .run();
      } catch (error) {
        throw databaseError(error);
      }
      if (result.meta.changes === 0) {
        await diagnoseSession(checkedDigest, checkedUser, current);
        throw new AuthStorageError("recent_auth_required");
      }
      return result.meta.changes;
    },

    async cleanupSessions(limit = AUTH_STORAGE_LIMITS.cleanupBatch) {
      return cleanupSessionRows(limit);
    },

    async cleanup({
      challengeLimit = AUTH_STORAGE_LIMITS.cleanupBatch,
      sessionLimit = AUTH_STORAGE_LIMITS.cleanupBatch,
    } = {}) {
      return {
        challenges: await cleanupChallengeRows(challengeLimit),
        sessions: await cleanupSessionRows(sessionLimit),
      };
    },

    async findCredential(credentialId) {
      const checkedId = requireCredentialId(credentialId);
      const row = await guarded(() =>
        db
          .prepare(
            "SELECT c.credential_id, c.user_id, c.public_key, c.counter, c.backup_eligible, c.backup_state, c.created_at, c.last_used_at, u.handle, u.display_name FROM credentials c JOIN users u ON u.id = c.user_id WHERE c.credential_id = ?1 AND u.handle IS NOT NULL AND u.display_name IS NOT NULL",
          )
          .bind(checkedId)
          .first(),
      );
      return row ? credentialRow(row) : null;
    },

    async listCredentials(userId) {
      const checkedUser = requireUserId(userId);
      const results = await guarded(() =>
        db
          .prepare(
            "SELECT credential_id, user_id, counter, backup_eligible, backup_state, created_at, last_used_at FROM credentials WHERE user_id = ?1 ORDER BY created_at, credential_id",
          )
          .bind(checkedUser)
          .all(),
      );
      return results.results.map((row) => ({
        credentialId: row.credential_id,
        userId: row.user_id,
        counter: row.counter,
        backupEligible: row.backup_eligible === 1,
        backupState: row.backup_state === 1,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
      }));
    },

    async countCredentials(userId) {
      const checkedUser = requireUserId(userId);
      const row = await guarded(() =>
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM credentials WHERE user_id = ?1",
          )
          .bind(checkedUser)
          .first(),
      );
      return row.count;
    },

    async addCredential({
      sessionDigest,
      userId,
      credential,
      challengeId = null,
      bindingDigest = null,
    }) {
      const checkedSession = requireDigest(sessionDigest);
      const checkedUser = requireUserId(userId);
      const checkedCredential = normalizeCredential(credential);
      const challengeBound = challengeId !== null && challengeId !== undefined;
      if (
        challengeBound !==
        (bindingDigest !== null && bindingDigest !== undefined)
      )
        throw new AuthStorageError("malformed_request");
      const checkedChallenge = challengeBound
        ? requireChallengeId(challengeId, "authentication_failed")
        : null;
      const checkedBinding = challengeBound
        ? requireDigest(bindingDigest, "authentication_failed")
        : null;
      const current = currentTime();
      const recentCutoff = current - AUTH_STORAGE_LIMITS.recentAuthWindowMs;
      const challengeGuard = checkedChallenge
        ? " AND EXISTS (SELECT 1 FROM challenges ch WHERE ch.id = ?11 AND ch.purpose = 'add_credential' AND ch.consumed_at IS NOT NULL AND ch.binding_digest = ?12 AND ch.user_id = ?2 AND ch.session_digest = ?8 AND ch.expires_at > ?7)"
        : "";
      const bindings = [
        checkedCredential.credentialId,
        checkedUser,
        checkedCredential.publicKey,
        checkedCredential.counter,
        checkedCredential.backupEligible ? 1 : 0,
        checkedCredential.backupState ? 1 : 0,
        current,
        checkedSession,
        recentCutoff,
        AUTH_STORAGE_LIMITS.credentialLimit,
      ];
      if (checkedChallenge) bindings.push(checkedChallenge, checkedBinding);
      let results;
      try {
        results = await db.batch([
          db
            .prepare(
              "INSERT INTO credentials (credential_id, user_id, public_key, counter, backup_eligible, backup_state, created_at, last_used_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7 WHERE EXISTS (SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.digest = ?8 AND s.user_id = ?2 AND s.revoked_at IS NULL AND s.expires_at > ?7 AND s.idle_expires_at > ?7 AND s.recent_auth_at IS NOT NULL AND s.recent_auth_at > ?9 AND u.handle IS NOT NULL AND u.display_name IS NOT NULL) AND (SELECT COUNT(*) FROM credentials c WHERE c.user_id = ?2) < ?10" +
                challengeGuard,
            )
            .bind(...bindings),
          db
            .prepare(
              "SELECT credential_id, user_id, public_key, counter, backup_eligible, backup_state, created_at, last_used_at FROM credentials WHERE credential_id = ?1 AND user_id = ?2",
            )
            .bind(checkedCredential.credentialId, checkedUser),
        ]);
      } catch (error) {
        throw databaseError(error);
      }
      if (results[0].meta.changes !== 1) {
        if (checkedChallenge) {
          const challenge = await guarded(() =>
            db
              .prepare(
                "SELECT 1 AS found FROM challenges WHERE id = ?1 AND purpose = 'add_credential' AND consumed_at IS NOT NULL AND binding_digest = ?2 AND user_id = ?3 AND session_digest = ?4 AND expires_at > ?5",
              )
              .bind(
                checkedChallenge,
                checkedBinding,
                checkedUser,
                checkedSession,
                current,
              )
              .first(),
          );
          if (!challenge) throw new AuthStorageError("authentication_failed");
        }
        await diagnoseAddCredential(
          checkedSession,
          checkedUser,
          checkedCredential.credentialId,
          current,
        );
      }
      return {
        credentialId: results[1].results[0].credential_id,
        userId: results[1].results[0].user_id,
        counter: results[1].results[0].counter,
        backupEligible: results[1].results[0].backup_eligible === 1,
        backupState: results[1].results[0].backup_state === 1,
        createdAt: results[1].results[0].created_at,
        lastUsedAt: results[1].results[0].last_used_at,
      };
    },

    async removeCredential({ sessionDigest, userId, credentialId }) {
      const checkedSession = requireDigest(sessionDigest);
      const checkedUser = requireUserId(userId);
      const checkedCredential = requireCredentialId(credentialId);
      const current = currentTime();
      const recentCutoff = current - AUTH_STORAGE_LIMITS.recentAuthWindowMs;
      let results;
      try {
        results = await db.batch([
          db
            .prepare(
              "DELETE FROM credentials WHERE credential_id = ?1 AND user_id = ?2 AND (SELECT COUNT(*) FROM credentials c WHERE c.user_id = ?2) > 1 AND EXISTS (SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.digest = ?3 AND s.user_id = ?2 AND s.revoked_at IS NULL AND s.expires_at > ?4 AND s.idle_expires_at > ?4 AND s.recent_auth_at IS NOT NULL AND s.recent_auth_at > ?5 AND u.handle IS NOT NULL AND u.display_name IS NOT NULL)",
            )
            .bind(
              checkedCredential,
              checkedUser,
              checkedSession,
              current,
              recentCutoff,
            ),
          db
            .prepare(
              "UPDATE sessions SET revoked_at = ?2, revoke_reason = 'credential_removed' WHERE user_id = ?1 AND revoked_at IS NULL AND changes() = 1",
            )
            .bind(checkedUser, current),
        ]);
      } catch (error) {
        throw databaseError(error);
      }
      if (results[0].meta.changes !== 1) {
        await diagnoseRemoveCredential(
          checkedSession,
          checkedUser,
          checkedCredential,
          current,
        );
      }
      return {
        removed: true,
        revokedSessions: results[1].meta.changes,
      };
    },

    async recordAssertion({
      credentialId,
      userId,
      newCounter,
      backupEligible,
      backupState,
      counter,
    }) {
      const checked = normalizeAssertion({
        credentialId,
        userId,
        newCounter: newCounter ?? counter,
        backupEligible,
        backupState,
      });
      const current = currentTime();
      let results;
      try {
        results = await db.batch([
          db
            .prepare(
              "UPDATE credentials SET counter = CASE WHEN backup_eligible = 1 THEN MAX(counter, ?2) ELSE ?2 END, backup_state = ?3, last_used_at = ?4 WHERE credential_id = ?1 AND user_id = ?5 AND backup_eligible = ?6 AND (backup_eligible = 1 OR ?2 > counter OR (counter = 0 AND ?2 = 0))",
            )
            .bind(
              checked.credentialId,
              checked.newCounter,
              checked.backupState ? 1 : 0,
              current,
              checked.userId,
              checked.backupEligible ? 1 : 0,
            ),
          db
            .prepare(
              "SELECT credential_id, user_id, public_key, counter, backup_eligible, backup_state, created_at, last_used_at FROM credentials WHERE credential_id = ?1 AND user_id = ?2",
            )
            .bind(checked.credentialId, checked.userId),
        ]);
      } catch (error) {
        throw databaseError(error);
      }
      if (results[0].meta.changes !== 1) {
        const row = results[1].results[0];
        if (!row) throw new AuthStorageError("not_found");
        throw new AuthStorageError("authentication_failed");
      }
      return {
        credentialId: results[1].results[0].credential_id,
        userId: results[1].results[0].user_id,
        counter: results[1].results[0].counter,
        backupEligible: results[1].results[0].backup_eligible === 1,
        backupState: results[1].results[0].backup_state === 1,
        createdAt: results[1].results[0].created_at,
        lastUsedAt: results[1].results[0].last_used_at,
      };
    },
  };
}
