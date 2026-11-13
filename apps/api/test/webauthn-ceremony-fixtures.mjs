// Synthetic Phase 5 ceremony fixtures. QR code parsing, CBOR, and WebAuthn
// data structures use the selected library helpers; verification itself is
// always the real library call in the service under test.
import { ECDSASigValue } from "@peculiar/asn1-ecc";
import { AsnSerializer } from "@peculiar/asn1-schema";
import {
  isoBase64URL,
  isoCBOR,
  isoUint8Array,
} from "@simplewebauthn/server/helpers";

const textEncoder = new TextEncoder();

export function bytes(length, fill = 0) {
  return new Uint8Array(length).fill(fill);
}

export function base64Url(value) {
  return isoBase64URL.fromBuffer(value);
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", value));
}

function uint32(value) {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value);
  return result;
}

function uint16(value) {
  return Uint8Array.of(value >> 8, value & 0xff);
}

export async function createCredential({ idFill = 1, idLength = 16 } = {}) {
  const credentialIdBytes = Uint8Array.from(
    { length: idLength },
    (_, index) => (idFill + index) & 0xff,
  );
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    credentialId: base64Url(credentialIdBytes),
    credentialIdBytes,
    keyPair,
  };
}

async function cosePublicKey(publicKey, algorithm = -7) {
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  return isoCBOR.encode(
    new Map([
      [1, 2],
      [3, algorithm],
      [-1, 1],
      [-2, isoBase64URL.toBuffer(jwk.x)],
      [-3, isoBase64URL.toBuffer(jwk.y)],
    ]),
  );
}

function clientDataJSON({
  type,
  challenge,
  origin,
  crossOrigin,
  topOrigin,
  malformed = false,
}) {
  const value = {
    type,
    challenge,
    origin,
    crossOrigin,
  };
  if (topOrigin !== undefined) value.topOrigin = topOrigin;
  if (malformed) return textEncoder.encode("{not json");
  return textEncoder.encode(JSON.stringify(value));
}

function flags({ userPresent, userVerified, backupEligible, backupState }) {
  let value = 0;
  if (userPresent) value |= 0x01;
  if (userVerified) value |= 0x04;
  if (backupEligible) value |= 0x08;
  if (backupState) value |= 0x10;
  return value;
}

async function registrationAuthData({
  rpID,
  credentialIdBytes,
  cose,
  counter,
  userPresent,
  userVerified,
  backupEligible,
  backupState,
  corruptRpId,
}) {
  return isoUint8Array.concat([
    await sha256(textEncoder.encode(corruptRpId ? "wrong-rp.example" : rpID)),
    Uint8Array.of(
      flags({ userPresent, userVerified, backupEligible, backupState }) | 0x40,
    ),
    uint32(counter),
    new Uint8Array(16),
    uint16(credentialIdBytes.length),
    credentialIdBytes,
    cose,
  ]);
}

async function assertionAuthData({
  rpID,
  counter,
  userPresent,
  userVerified,
  backupEligible,
  backupState,
  corruptRpId,
}) {
  return isoUint8Array.concat([
    await sha256(textEncoder.encode(corruptRpId ? "wrong-rp.example" : rpID)),
    Uint8Array.of(
      flags({ userPresent, userVerified, backupEligible, backupState }),
    ),
    uint32(counter),
  ]);
}

async function sign(privateKey, authData, clientData, corrupt) {
  const clientDataHash = await sha256(clientData);
  const raw = new Uint8Array(
    await crypto.subtle.sign(
      privateKey.algorithm.name === "Ed25519"
        ? { name: "Ed25519" }
        : { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      isoUint8Array.concat([authData, clientDataHash]),
    ),
  );
  if (corrupt) raw[raw.length - 1] ^= 0xff;
  if (privateKey.algorithm.name === "Ed25519") return raw;
  const value = new ECDSASigValue({
    r: raw.slice(0, 32).buffer,
    s: raw.slice(32).buffer,
  });
  return new Uint8Array(AsnSerializer.serialize(value));
}

export async function buildRegistrationResponse({
  challenge,
  rpID,
  origin,
  credential,
  counter = 0,
  userPresent = true,
  userVerified = true,
  backupEligible = false,
  backupState = false,
  algorithm = -7,
  fmt = "none",
  attStmt = null,
  crossOrigin = false,
  topOrigin,
  corruptRpId = false,
  malformedClientData = false,
  type = "webauthn.create",
}) {
  const clientData = clientDataJSON({
    type,
    challenge,
    origin,
    crossOrigin,
    topOrigin,
    malformed: malformedClientData,
  });
  const cose = await cosePublicKey(credential.keyPair.publicKey, algorithm);
  const authData = await registrationAuthData({
    rpID,
    credentialIdBytes: credential.credentialIdBytes,
    cose,
    counter,
    userPresent,
    userVerified,
    backupEligible,
    backupState,
    corruptRpId,
  });
  const attestationObject = isoCBOR.encode(
    new Map([
      ["fmt", fmt],
      ["attStmt", attStmt ?? new Map()],
      ["authData", authData],
    ]),
  );
  return {
    id: credential.credentialId,
    rawId: credential.credentialId,
    type: "public-key",
    response: {
      clientDataJSON: base64Url(clientData),
      attestationObject: base64Url(attestationObject),
    },
  };
}

export async function buildAssertionResponse({
  challenge,
  rpID,
  origin,
  credential,
  counter = 0,
  userPresent = true,
  userVerified = true,
  backupEligible = false,
  backupState = false,
  userHandle,
  includeUserHandle = true,
  crossOrigin = false,
  topOrigin,
  corruptRpId = false,
  corruptSignature = false,
  malformedClientData = false,
  type = "webauthn.get",
}) {
  const clientData = clientDataJSON({
    type,
    challenge,
    origin,
    crossOrigin,
    topOrigin,
    malformed: malformedClientData,
  });
  const authData = await assertionAuthData({
    rpID,
    counter,
    userPresent,
    userVerified,
    backupEligible,
    backupState,
    corruptRpId,
  });
  const signature = await sign(
    credential.keyPair.privateKey,
    authData,
    clientData,
    corruptSignature,
  );
  const response = {
    clientDataJSON: base64Url(clientData),
    authenticatorData: base64Url(authData),
    signature: base64Url(signature),
  };
  if (includeUserHandle) response.userHandle = userHandle ?? null;
  return {
    id: credential.credentialId,
    rawId: credential.credentialId,
    type: "public-key",
    response,
  };
}

export function verificationBody(challengeId, credential) {
  return { challenge_id: challengeId, credential };
}
