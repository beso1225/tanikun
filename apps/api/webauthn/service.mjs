import {
  decodeAttestationObject,
  decodeClientDataJSON,
} from "@simplewebauthn/server/helpers";

import {
  AuthStorageError,
  decodeBase64Url,
  normalizeCredential,
  randomBytes,
  requireAccountHandle,
  requireDigest,
  requireUserId,
} from "../repositories/auth-data.mjs";
import { createAuthRepository } from "../repositories/auth.mjs";
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
} from "./options.mjs";
import {
  constantTimeEqual,
  createSessionMaterial as defaultSessionMaterial,
  sha256,
} from "./session-material.mjs";
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "./verify.mjs";
import {
  parseAssertionVerification,
  parseRegistrationVerification,
} from "./wire.mjs";

const SUPPORTED_ALGORITHM_IDS = [-7];

function fail(code = "authentication_failed") {
  throw new AuthStorageError(code);
}

function challengeCallback(storedDigest) {
  return async (encodedChallenge) => {
    try {
      const bytes = decodeBase64Url(encodedChallenge, "authentication_failed");
      if (bytes.length !== 32) return false;
      return constantTimeEqual(await sha256(bytes), storedDigest);
    } catch {
      return false;
    }
  };
}

function decodeClientData(encoded, { type, config }) {
  let clientData;
  try {
    clientData = decodeClientDataJSON(encoded);
  } catch {
    fail();
  }
  if (
    !clientData ||
    typeof clientData !== "object" ||
    Array.isArray(clientData)
  )
    fail();
  if (clientData.type !== type) fail();
  if (clientData.origin !== config.origin) fail();
  if (clientData.crossOrigin !== false) fail();
  if (clientData.topOrigin !== undefined) fail();
  // The verifier's expectedChallenge callback owns challenge decoding,
  // length, and digest comparison, including malformed values.
}

function precheckAttestation(encoded) {
  let attestationObject;
  try {
    attestationObject = decodeAttestationObject(
      decodeBase64Url(encoded, "authentication_failed"),
    );
  } catch (error) {
    if (error instanceof AuthStorageError) throw error;
    fail();
  }
  if (!(attestationObject instanceof Map)) fail();
  if (attestationObject.get("fmt") !== "none") fail();
  const statement = attestationObject.get("attStmt");
  if (!(statement instanceof Map) || statement.size !== 0) fail();
}

function validateRegistrationInfo(result, config, expectedId) {
  if (!result || result.verified !== true || !result.registrationInfo) fail();
  const info = result.registrationInfo;
  if (info.fmt !== "none") fail();
  if (info.origin !== config.origin) fail();
  if (info.rpID !== config.rpID) fail();
  if (info.userVerified !== true) fail();
  if (info.passkeyProviderMetadata !== undefined) fail();
  if (
    info.credentialDeviceType !== "multiDevice" &&
    info.credentialDeviceType !== "singleDevice"
  )
    fail();
  if (!info.credential || typeof info.credential !== "object") fail();
  if (info.credential.id !== expectedId) fail();
  let publicKey;
  try {
    publicKey = normalizeCredential({
      id: expectedId,
      publicKey: info.credential.publicKey,
      counter: info.credential.counter,
      backupEligible: info.credentialDeviceType === "multiDevice",
      backupState: info.credentialBackedUp,
    });
  } catch (error) {
    if (error instanceof AuthStorageError) throw error;
    fail();
  }
  if (publicKey.credentialId !== expectedId) fail();
  return {
    credentialId: expectedId,
    publicKey: publicKey.publicKey,
    counter: publicKey.counter,
    backupEligible: publicKey.backupEligible,
    backupState: publicKey.backupState,
  };
}

function validateAuthenticationInfo(result, credential, config) {
  if (!result || result.verified !== true || !result.authenticationInfo) fail();
  const info = result.authenticationInfo;
  if (info.credentialID !== credential.credentialId) fail();
  if (info.origin !== config.origin) fail();
  if (info.rpID !== config.rpID) fail();
  if (info.userVerified !== true) fail();
  if (
    info.credentialDeviceType !==
    (credential.backupEligible ? "multiDevice" : "singleDevice")
  )
    fail();
  if (typeof info.credentialBackedUp !== "boolean") fail();
  if (info.credentialBackedUp && !credential.backupEligible) fail();
  if (!Number.isSafeInteger(info.newCounter) || info.newCounter < 0) fail();
  return {
    newCounter: info.newCounter,
    backupEligible: credential.backupEligible,
    backupState: info.credentialBackedUp,
  };
}

function assertDiscoverableHandle(value, expected) {
  if (typeof value !== "string") fail();
  try {
    if (decodeBase64Url(value, "authentication_failed").length !== 32) fail();
  } catch (error) {
    if (error instanceof AuthStorageError) throw error;
    fail();
  }
  if (value !== expected) fail();
}

function assertOptionalHandle(value, expected) {
  if (value === undefined || value === null) return;
  assertDiscoverableHandle(value, expected);
}

function requireSession(session) {
  if (!session || typeof session !== "object" || Array.isArray(session))
    fail("unauthorized");
  try {
    requireDigest(session.digest, "unauthorized");
    requireUserId(session.userId, "unauthorized");
    requireAccountHandle(session.account?.handle, "unauthorized");
    if (typeof session.account?.displayName !== "string") fail("unauthorized");
    if (
      session.account?.userId !== undefined &&
      session.account.userId !== session.userId
    )
      fail("unauthorized");
  } catch (error) {
    if (error instanceof AuthStorageError) {
      if (error.code === "unauthorized") throw error;
      fail("unauthorized");
    }
    fail("unauthorized");
  }
  return session;
}

function sessionResponse(session, csrfToken) {
  return {
    account: {
      handle: session.account.handle,
      display_name: session.account.displayName,
    },
    expires_at: session.expiresAt,
    idle_expires_at: session.idleExpiresAt,
    recent_auth: session.recentAuth,
    recent_auth_expires_at: session.recentAuthExpiresAt,
    csrf_token: csrfToken,
  };
}

function credentialResponse(credential) {
  return {
    id: credential.credentialId,
    created_at: credential.createdAt,
    last_used_at: credential.lastUsedAt,
    backup_eligible: credential.backupEligible,
    backup_state: credential.backupState,
  };
}

async function verifierResult(operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AuthStorageError) throw error;
    fail();
  }
}

export function createAuthCeremonyService({
  db,
  config,
  repository,
  now,
  newAccountId,
  newAccountHandle,
  newDocumentId,
  newChallengeId,
  sessionMaterial = defaultSessionMaterial,
  verifyRegistration = verifyRegistrationResponse,
  verifyAuthentication = verifyAuthenticationResponse,
}) {
  if (!db) throw new AuthStorageError("temporarily_unavailable");
  if (!config || config.mode !== "session")
    throw new AuthStorageError("temporarily_unavailable");
  const auth =
    repository ??
    createAuthRepository(db, {
      ...(now ? { now } : {}),
      ...(newAccountId ? { newAccountId } : {}),
      ...(newAccountHandle ? { newAccountHandle } : {}),
      ...(newDocumentId ? { newDocumentId } : {}),
      ...(newChallengeId ? { newChallengeId } : {}),
    });

  async function issueChallenge(purpose, bindingDigest, extra = {}) {
    const challenge = randomBytes(32);
    const challengeDigest = await sha256(challenge);
    const binding = requireDigest(bindingDigest, "authentication_failed");
    const issued =
      purpose === "register"
        ? await auth.issueRegistrationChallenge({
            challengeDigest,
            bindingDigest: binding,
            displayName: extra.displayName,
          })
        : purpose === "sign_in"
          ? await auth.issueSignInChallenge({
              challengeDigest,
              bindingDigest: binding,
            })
          : await auth.issueSessionChallenge({
              purpose,
              challengeDigest,
              bindingDigest: binding,
              userId: extra.userId,
              sessionDigest: extra.sessionDigest,
            });
    return { issued, challenge };
  }

  async function issueRegistration({ bindingDigest, displayName }) {
    const { issued, challenge } = await issueChallenge(
      "register",
      bindingDigest,
      {
        displayName,
      },
    );
    const publicKey = await buildRegistrationOptions({
      rpID: config.rpID,
      rpName: config.rpName,
      accountHandle: issued.accountHandle,
      displayName: issued.displayName,
      challenge,
    });
    return { challenge_id: issued.challengeId, publicKey };
  }

  async function issueSignIn({ bindingDigest }) {
    const { issued, challenge } = await issueChallenge(
      "sign_in",
      bindingDigest,
    );
    const publicKey = await buildAuthenticationOptions({
      rpID: config.rpID,
      challenge,
    });
    return { challenge_id: issued.challengeId, publicKey };
  }

  async function issueStepUp({ bindingDigest, session }) {
    const active = requireSession(session);
    const { issued, challenge } = await issueChallenge(
      "step_up",
      bindingDigest,
      {
        userId: active.userId,
        sessionDigest: active.digest,
      },
    );
    const credentials = await auth.listCredentials(active.userId);
    const publicKey = await buildAuthenticationOptions({
      rpID: config.rpID,
      challenge,
      allowCredentialIds: credentials.map(
        (credential) => credential.credentialId,
      ),
    });
    return { challenge_id: issued.challengeId, publicKey };
  }

  async function issueAddCredential({ bindingDigest, session }) {
    const active = requireSession(session);
    if (active.recentAuth !== true) fail("recent_auth_required");
    const { issued, challenge } = await issueChallenge(
      "add_credential",
      bindingDigest,
      {
        userId: active.userId,
        sessionDigest: active.digest,
      },
    );
    const credentials = await auth.listCredentials(active.userId);
    const publicKey = await buildRegistrationOptions({
      rpID: config.rpID,
      rpName: config.rpName,
      accountHandle: active.account.handle,
      displayName: active.account.displayName,
      challenge,
      excludeCredentialIds: credentials.map(
        (credential) => credential.credentialId,
      ),
    });
    return { challenge_id: issued.challengeId, publicKey };
  }

  async function verifyRegistrationCeremony({
    bindingDigest,
    body,
    existingSession,
    purpose,
    activeSession,
  }) {
    if (purpose === "register" && existingSession)
      fail("already_authenticated");
    if (purpose === "add_credential" && !activeSession) fail("unauthorized");
    const parsed = parseRegistrationVerification(body);
    const consumed = await auth.consumeCeremonyChallenge({
      challengeId: parsed.challengeId,
      bindingDigest,
      purpose,
      ...(purpose === "add_credential"
        ? {
            userId: activeSession.userId,
            sessionDigest: activeSession.digest,
          }
        : {}),
    });
    decodeClientData(parsed.credential.response.clientDataJSON, {
      type: "webauthn.create",
      config,
    });
    precheckAttestation(parsed.credential.response.attestationObject);
    const result = await verifierResult(() =>
      verifyRegistration({
        response: parsed.credential,
        expectedChallenge: challengeCallback(consumed.challengeDigest),
        expectedOrigin: config.origin,
        expectedRPID: config.rpID,
        expectedType: "webauthn.create",
        requireUserPresence: true,
        requireUserVerification: true,
        supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
      }),
    );
    const credential = validateRegistrationInfo(
      result,
      config,
      parsed.credential.id,
    );
    if (purpose === "add_credential") {
      const added = await auth.addCredential({
        sessionDigest: activeSession.digest,
        userId: activeSession.userId,
        credential,
        challengeId: parsed.challengeId,
        bindingDigest,
      });
      return {
        body: { credential: credentialResponse(added) },
        handoff: { kind: "credential", credential: added },
      };
    }
    const material = await sessionMaterial();
    const completed = await auth.completeRegistration({
      challengeId: parsed.challengeId,
      bindingDigest,
      credential,
      session: {
        digest: material.digest,
        csrfDigest: material.csrfDigest,
      },
    });
    return {
      body: { session: sessionResponse(completed.session, material.csrfToken) },
      handoff: {
        kind: "session",
        token: material.token,
        csrfToken: material.csrfToken,
        session: completed.session,
        account: completed.account,
      },
    };
  }

  async function verifyAssertionCeremony({
    bindingDigest,
    body,
    purpose,
    activeSession,
    presentedSession,
  }) {
    const parsed = parseAssertionVerification(body, {
      discoverable: purpose === "sign_in",
    });
    const consumed = await auth.consumeCeremonyChallenge({
      challengeId: parsed.challengeId,
      bindingDigest,
      purpose,
      ...(purpose === "step_up"
        ? {
            userId: activeSession.userId,
            sessionDigest: activeSession.digest,
          }
        : {}),
    });
    decodeClientData(parsed.credential.response.clientDataJSON, {
      type: "webauthn.get",
      config,
    });
    const credential = await auth.findCredential(parsed.credential.id);
    if (!credential) fail();
    if (purpose === "step_up" && credential.userId !== activeSession.userId)
      fail();
    if (purpose === "sign_in") {
      assertDiscoverableHandle(parsed.userHandle, credential.accountHandle);
    } else {
      assertOptionalHandle(parsed.userHandle, activeSession.account.handle);
    }
    const libraryCredential = {
      id: credential.credentialId,
      publicKey: credential.publicKey,
      counter: credential.backupEligible ? 0 : credential.counter,
    };
    const result = await verifierResult(() =>
      verifyAuthentication({
        response: parsed.credential,
        expectedChallenge: challengeCallback(consumed.challengeDigest),
        expectedOrigin: config.origin,
        expectedRPID: config.rpID,
        expectedType: "webauthn.get",
        credential: libraryCredential,
        requireUserVerification: true,
      }),
    );
    const counter = validateAuthenticationInfo(result, credential, config);
    if (purpose === "sign_in") {
      const material = await sessionMaterial();
      const completed = await auth.completeSignIn({
        challengeId: parsed.challengeId,
        bindingDigest,
        credentialId: credential.credentialId,
        userId: credential.userId,
        newCounter: counter.newCounter,
        backupEligible: credential.backupEligible,
        backupState: counter.backupState,
        session: {
          digest: material.digest,
          csrfDigest: material.csrfDigest,
        },
        presentedSessionDigest: presentedSession?.digest ?? null,
      });
      return {
        body: {
          session: sessionResponse(completed.session, material.csrfToken),
        },
        handoff: {
          kind: "session",
          token: material.token,
          csrfToken: material.csrfToken,
          session: completed.session,
        },
      };
    }
    const updated = await auth.completeStepUp({
      challengeId: parsed.challengeId,
      bindingDigest,
      credentialId: credential.credentialId,
      userId: activeSession.userId,
      newCounter: counter.newCounter,
      backupEligible: credential.backupEligible,
      backupState: counter.backupState,
      sessionDigest: activeSession.digest,
    });
    return {
      body: {
        recent_auth: true,
        recent_auth_expires_at: updated.recentAuthExpiresAt,
      },
      handoff: {
        kind: "recent_auth",
        recentAuthExpiresAt: updated.recentAuthExpiresAt,
      },
    };
  }

  return {
    registrationOptions({ bindingDigest, displayName }) {
      return issueRegistration({ bindingDigest, displayName });
    },

    signInOptions({ bindingDigest }) {
      return issueSignIn({ bindingDigest });
    },

    stepUpOptions({ bindingDigest, session }) {
      return issueStepUp({ bindingDigest, session });
    },

    addCredentialOptions({ bindingDigest, session }) {
      return issueAddCredential({ bindingDigest, session });
    },

    verifyRegistration({ bindingDigest, body, existingSession = null }) {
      return verifyRegistrationCeremony({
        bindingDigest,
        body,
        existingSession,
        purpose: "register",
      });
    },

    verifySignIn({ bindingDigest, body, presentedSession = null }) {
      return verifyAssertionCeremony({
        bindingDigest,
        body,
        purpose: "sign_in",
        presentedSession,
      });
    },

    async verifyStepUp({ bindingDigest, body, session }) {
      return verifyAssertionCeremony({
        bindingDigest,
        body,
        purpose: "step_up",
        activeSession: requireSession(session),
      });
    },

    async verifyAddCredential({ bindingDigest, body, session }) {
      return verifyRegistrationCeremony({
        bindingDigest,
        body,
        purpose: "add_credential",
        activeSession: requireSession(session),
      });
    },
  };
}
