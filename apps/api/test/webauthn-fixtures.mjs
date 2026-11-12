// Synthetic WebAuthn fixtures for the #176 Workers-runtime spike.
//
// The fixtures are generated at test time. They use a disposable P-256 key,
// a fictional RP ID, and a fictional origin. No credential, passkey, planner
// record, or secret from a real user is involved.
//
// The CBOR encoding and WebAuthn data structures are built with helpers from
// the selected library (@simplewebauthn/server/helpers). Verification itself is
// always performed by the real library in the test, never by this module.
import { ECDSASigValue } from "@peculiar/asn1-ecc";
import { AsnSerializer } from "@peculiar/asn1-schema";
import {
  isoBase64URL,
  isoCBOR,
  isoUint8Array,
} from "@simplewebauthn/server/helpers";

const RP_ID = "planner.tanikun.test";
const ORIGIN = `https://${RP_ID}`;
const CHALLENGE = isoBase64URL.fromBuffer(new Uint8Array(32).fill(0x2a));
const CREDENTIAL_ID = Uint8Array.from(
  { length: 16 },
  (_, index) => 0xa0 + index,
);
const AAGUID = new Uint8Array(16);
const textEncoder = new TextEncoder();

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function uint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function clientDataJSON(type) {
  return textEncoder.encode(
    JSON.stringify({
      type,
      challenge: CHALLENGE,
      origin: ORIGIN,
      crossOrigin: false,
    }),
  );
}

async function generateCredentialKey() {
  return crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
}

async function exportCosePublicKey(publicKey) {
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  return isoCBOR.encode(
    new Map([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, isoBase64URL.toBuffer(jwk.x)],
      [-3, isoBase64URL.toBuffer(jwk.y)],
    ]),
  );
}

async function sign(privateKey, data, corruptSignature) {
  const raw = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      data,
    ),
  );
  if (corruptSignature) {
    // Keep the ASN.1 structure valid so the failure is the ECDSA check, not a
    // malformed-signature parse error.
    raw[raw.length - 1] ^= 0xff;
  }
  const value = new ECDSASigValue({
    r: raw.slice(0, 32).buffer,
    s: raw.slice(32).buffer,
  });
  return new Uint8Array(AsnSerializer.serialize(value));
}

async function buildRegistrationResponse({
  privateKey,
  cosePublicKey,
  corruptSignature,
}) {
  const clientData = clientDataJSON("webauthn.create");
  const clientDataHash = await sha256(clientData);
  const credentialIdLength = Uint8Array.of(
    CREDENTIAL_ID.length >> 8,
    CREDENTIAL_ID.length & 0xff,
  );
  const authData = isoUint8Array.concat([
    await sha256(textEncoder.encode(RP_ID)),
    Uint8Array.of(0x45), // UP | UV | AT
    uint32(0),
    AAGUID,
    credentialIdLength,
    CREDENTIAL_ID,
    cosePublicKey,
  ]);
  const signature = await sign(
    privateKey,
    isoUint8Array.concat([authData, clientDataHash]),
    corruptSignature,
  );
  const attestationObject = isoCBOR.encode(
    new Map([
      ["fmt", "packed"],
      [
        "attStmt",
        new Map([
          ["alg", -7],
          ["sig", signature],
        ]),
      ],
      ["authData", authData],
    ]),
  );

  return {
    id: isoBase64URL.fromBuffer(CREDENTIAL_ID),
    rawId: isoBase64URL.fromBuffer(CREDENTIAL_ID),
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: isoBase64URL.fromBuffer(clientData),
      attestationObject: isoBase64URL.fromBuffer(attestationObject),
      transports: ["internal"],
    },
  };
}

async function buildAuthenticationResponse({ privateKey, corruptSignature }) {
  const clientData = clientDataJSON("webauthn.get");
  const clientDataHash = await sha256(clientData);
  const authData = isoUint8Array.concat([
    await sha256(textEncoder.encode(RP_ID)),
    Uint8Array.of(0x05), // UP | UV
    uint32(1),
  ]);
  const signature = await sign(
    privateKey,
    isoUint8Array.concat([authData, clientDataHash]),
    corruptSignature,
  );

  return {
    id: isoBase64URL.fromBuffer(CREDENTIAL_ID),
    rawId: isoBase64URL.fromBuffer(CREDENTIAL_ID),
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: isoBase64URL.fromBuffer(clientData),
      authenticatorData: isoBase64URL.fromBuffer(authData),
      signature: isoBase64URL.fromBuffer(signature),
      userHandle: null,
    },
  };
}

export async function createWebAuthnProof() {
  const keyPair = await generateCredentialKey();
  const cosePublicKey = await exportCosePublicKey(keyPair.publicKey);
  const credential = {
    id: isoBase64URL.fromBuffer(CREDENTIAL_ID),
    publicKey: cosePublicKey,
    counter: 0,
    transports: ["internal"],
  };

  return {
    expected: {
      challenge: CHALLENGE,
      origin: ORIGIN,
      rpID: RP_ID,
    },
    credential,
    registration: await buildRegistrationResponse({
      privateKey: keyPair.privateKey,
      cosePublicKey,
      corruptSignature: false,
    }),
    registrationWithModifiedSignature: await buildRegistrationResponse({
      privateKey: keyPair.privateKey,
      cosePublicKey,
      corruptSignature: true,
    }),
    authentication: await buildAuthenticationResponse({
      privateKey: keyPair.privateKey,
      corruptSignature: false,
    }),
    authenticationWithModifiedSignature: await buildAuthenticationResponse({
      privateKey: keyPair.privateKey,
      corruptSignature: true,
    }),
  };
}
