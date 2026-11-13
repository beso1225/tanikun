import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
} from "@simplewebauthn/server";

import {
  AuthStorageError,
  decodeBase64Url,
  encodeBase64Url,
} from "../repositories/auth-data.mjs";

export const CEREMONY_TIMEOUT_MS = 120_000;

function internalError() {
  return new AuthStorageError("temporarily_unavailable");
}

function accountHandleBytes(accountHandle) {
  try {
    const bytes = decodeBase64Url(accountHandle, "temporarily_unavailable");
    if (bytes.length !== 32) throw internalError();
    return bytes;
  } catch (error) {
    if (error instanceof AuthStorageError) throw error;
    throw internalError();
  }
}

function credentialIdSet(ids) {
  return ids.map((id) => {
    try {
      const bytes = decodeBase64Url(id, "temporarily_unavailable");
      if (bytes.length < 1 || bytes.length > 1023) throw internalError();
    } catch (error) {
      if (error instanceof AuthStorageError) throw error;
      throw internalError();
    }
    return { id, type: "public-key" };
  });
}

async function assertChallenge(value) {
  let bytes;
  try {
    bytes = decodeBase64Url(value, "temporarily_unavailable");
  } catch {
    throw internalError();
  }
  if (bytes.length !== 32) throw internalError();
  return value;
}

// Explicit projections drop the library's `extensions.credProps` and `hints`
// additions. Phase 5 requests no extension and never forwards PRF material.
export async function buildRegistrationOptions({
  rpID,
  rpName,
  accountHandle,
  displayName,
  challenge,
  excludeCredentialIds = [],
}) {
  const userID = accountHandleBytes(accountHandle);
  if (!(challenge instanceof Uint8Array) || challenge.length !== 32)
    throw internalError();
  const excludeCredentials = credentialIdSet(excludeCredentialIds);
  const options = await generateRegistrationOptions({
    rpID,
    rpName,
    userID,
    userName: displayName,
    userDisplayName: displayName,
    challenge,
    timeout: CEREMONY_TIMEOUT_MS,
    attestationType: "none",
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
    supportedAlgorithmIDs: [-7],
  });
  if (options.rp.id !== rpID) throw internalError();
  if (options.user.id !== accountHandle) throw internalError();
  await assertChallenge(options.challenge);
  if (options.challenge !== encodeBase64Url(challenge)) throw internalError();

  return {
    rp: { id: rpID, name: rpName },
    user: {
      id: accountHandle,
      name: displayName,
      displayName,
    },
    challenge: options.challenge,
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    timeout: CEREMONY_TIMEOUT_MS,
    excludeCredentials: excludeCredentials.map(({ id }) => ({
      type: "public-key",
      id,
    })),
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
    attestation: "none",
  };
}

export async function buildAuthenticationOptions({
  rpID,
  challenge,
  allowCredentialIds = [],
}) {
  if (!(challenge instanceof Uint8Array) || challenge.length !== 32)
    throw internalError();
  const allowCredentials = credentialIdSet(allowCredentialIds);
  const options = await generateAuthenticationOptions({
    rpID,
    challenge,
    timeout: CEREMONY_TIMEOUT_MS,
    userVerification: "required",
    allowCredentials,
  });
  if (options.rpId !== rpID) throw internalError();
  await assertChallenge(options.challenge);
  if (options.challenge !== encodeBase64Url(challenge)) throw internalError();

  return {
    challenge: options.challenge,
    timeout: CEREMONY_TIMEOUT_MS,
    rpId: rpID,
    allowCredentials: allowCredentials.map(({ id }) => ({
      type: "public-key",
      id,
    })),
    userVerification: "required",
  };
}
