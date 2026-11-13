import { env } from "cloudflare:test";

import { createAuthRepository } from "../repositories/auth.mjs";
import { createAuthCeremonyService } from "../webauthn/service.mjs";
import {
  accountHandle,
  accountId,
  base64Url,
  bytes,
  challengeId,
  queryFirst,
} from "./auth-fixtures.mts";
import {
  buildAssertionResponse,
  buildRegistrationResponse,
  createCredential,
  verificationBody,
} from "./webauthn-ceremony-fixtures.mjs";

export const CEREMONY_CONFIG = Object.freeze({
  mode: "session",
  origin: "https://localhost:4300",
  rpID: "localhost",
  rpName: "Tanikun",
});

export const CEREMONY_BINDING = bytes(32, 0x31);

export function ceremonyDocument(index = 1) {
  const suffix = String(index).padStart(12, "0");
  return `11111111-1111-4111-8111-${suffix}`;
}

export function makeCeremonyService({
  clock,
  account = "alice0001",
  handleFill = 0x11,
  documentId = ceremonyDocument(),
  challengeFill = 0x21,
  sessionMaterial,
  verifyRegistration,
  verifyAuthentication,
} = {}) {
  let challenge = 0;
  const repository = createAuthRepository(env.DB, {
    now: clock.now,
    newChallengeId: () => challengeId((challengeFill + challenge++) & 0xff),
    newAccountId: () => accountId(account),
    newAccountHandle: () => accountHandle(handleFill),
    newDocumentId: () => documentId,
  });
  return createAuthCeremonyService({
    db: env.DB,
    config: CEREMONY_CONFIG,
    repository,
    ...(sessionMaterial ? { sessionMaterial } : {}),
    ...(verifyRegistration ? { verifyRegistration } : {}),
    ...(verifyAuthentication ? { verifyAuthentication } : {}),
  });
}

export async function registerCeremony(
  service,
  {
    credential,
    displayName = "Alice Example",
    counter = 0,
    backupEligible = false,
    backupState = false,
    bindingDigest = CEREMONY_BINDING,
    responseOverrides = {},
  } = {},
) {
  const fixture = credential ?? (await createCredential());
  const options = await service.registrationOptions({
    bindingDigest,
    displayName,
  });
  const response = await buildRegistrationResponse({
    challenge: options.publicKey.challenge,
    rpID: CEREMONY_CONFIG.rpID,
    origin: CEREMONY_CONFIG.origin,
    credential: fixture,
    counter,
    backupEligible,
    backupState,
    ...responseOverrides,
  });
  const result = await service.verifyRegistration({
    bindingDigest,
    body: verificationBody(options.challenge_id, response),
  });
  return { credential: fixture, options, response, result };
}

export async function signInCeremony(
  service,
  credential,
  {
    handle,
    presentedSession = null,
    bindingDigest = CEREMONY_BINDING,
    counter = 0,
    backupEligible = false,
    backupState = false,
    responseOverrides = {},
    userHandle,
  } = {},
) {
  const begin = await service.signInOptions({ bindingDigest });
  const response = await buildAssertionResponse({
    challenge: begin.publicKey.challenge,
    rpID: CEREMONY_CONFIG.rpID,
    origin: CEREMONY_CONFIG.origin,
    credential,
    counter,
    backupEligible,
    backupState,
    userHandle: userHandle ?? handle ?? null,
    ...responseOverrides,
  });
  return {
    begin,
    response,
    result: await service.verifySignIn({
      bindingDigest,
      body: verificationBody(begin.challenge_id, response),
      presentedSession,
    }),
  };
}

export function sessionFor(session, overrides = {}) {
  return { ...session, ...overrides };
}

export async function activeSessionCount(userId) {
  return (
    await queryFirst(
      "SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?1 AND revoked_at IS NULL",
      userId,
    )
  ).count;
}

export async function credentialRow(credentialId) {
  return queryFirst(
    "SELECT credential_id, user_id, counter, backup_eligible, backup_state FROM credentials WHERE credential_id = ?1",
    credentialId,
  );
}

export { base64Url, bytes };
