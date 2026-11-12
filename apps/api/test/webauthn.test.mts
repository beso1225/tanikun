import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "../webauthn/verify.mjs";
import { createWebAuthnProof } from "./webauthn-fixtures.mjs";

const SUPPORTED_ALGORITHM_IDS = [-7]; // ES256 only in this spike

let proof;

async function verifyRegistration(overrides = {}) {
  return verifyRegistrationResponse({
    response: proof.registration,
    expectedChallenge: proof.expected.challenge,
    expectedOrigin: proof.expected.origin,
    expectedRPID: proof.expected.rpID,
    requireUserVerification: true,
    supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
    ...overrides,
  });
}

async function verifyAuthentication(credential, overrides = {}) {
  return verifyAuthenticationResponse({
    response: proof.authentication,
    expectedChallenge: proof.expected.challenge,
    expectedOrigin: proof.expected.origin,
    expectedRPID: proof.expected.rpID,
    credential,
    requireUserVerification: true,
    ...overrides,
  });
}

beforeAll(async () => {
  proof = await createWebAuthnProof();
});

describe("WebAuthn verification in the Workers test runtime", () => {
  it("runs inside workerd with the Workers bindings shim", () => {
    expect(typeof env).toBe("object");
    expect(typeof crypto.subtle).toBe("object");
  });

  it("verifies a fictional registration and its assertion", async () => {
    expect((await verifyRegistration()).verified).toBe(true);
    expect((await verifyAuthentication(proof.credential)).verified).toBe(true);
  });

  it("verifies the registration credential before assertion", async () => {
    const registration = await verifyRegistration();
    expect(registration.verified).toBe(true);
    expect(registration.registrationInfo).toBeDefined();
    const credential = registration.registrationInfo.credential;
    expect(credential.id).toBe(proof.credential.id);
    expect(credential.counter).toBe(proof.credential.counter);
    expect(Array.from(credential.publicKey)).toEqual(
      Array.from(proof.credential.publicKey),
    );

    const authentication = await verifyAuthentication(credential);
    expect(authentication.verified).toBe(true);
  });

  it("rejects a modified assertion signature", async () => {
    expect((await verifyAuthentication(proof.credential)).verified).toBe(true);

    const result = await verifyAuthenticationResponse({
      response: proof.authenticationWithModifiedSignature,
      expectedChallenge: proof.expected.challenge,
      expectedOrigin: proof.expected.origin,
      expectedRPID: proof.expected.rpID,
      credential: proof.credential,
      requireUserVerification: true,
    });
    expect(result.verified).toBe(false);
  });

  it("rejects a modified registration attestation signature", async () => {
    expect((await verifyRegistration()).verified).toBe(true);

    const result = await verifyRegistrationResponse({
      response: proof.registrationWithModifiedSignature,
      expectedChallenge: proof.expected.challenge,
      expectedOrigin: proof.expected.origin,
      expectedRPID: proof.expected.rpID,
      requireUserVerification: true,
      supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
    });
    expect(result.verified).toBe(false);
  });

  it("rejects a wrong challenge", async () => {
    expect((await verifyRegistration()).verified).toBe(true);
    expect((await verifyAuthentication(proof.credential)).verified).toBe(true);

    await expect(
      verifyRegistration({ expectedChallenge: "wrong-challenge" }),
    ).rejects.toThrow(/Unexpected registration response challenge/);
    await expect(
      verifyAuthentication(proof.credential, {
        expectedChallenge: "wrong-challenge",
      }),
    ).rejects.toThrow(/Unexpected authentication response challenge/);
  });

  it("rejects a wrong origin", async () => {
    expect((await verifyRegistration()).verified).toBe(true);
    expect((await verifyAuthentication(proof.credential)).verified).toBe(true);

    await expect(
      verifyRegistration({ expectedOrigin: "https://evil.tanikun.test" }),
    ).rejects.toThrow(/Unexpected response origin/);
    await expect(
      verifyAuthentication(proof.credential, {
        expectedOrigin: "https://evil.tanikun.test",
      }),
    ).rejects.toThrow(/Unexpected response origin/);
  });

  it("rejects a wrong RP ID", async () => {
    expect((await verifyRegistration()).verified).toBe(true);
    expect((await verifyAuthentication(proof.credential)).verified).toBe(true);

    await expect(
      verifyRegistration({ expectedRPID: "other.tanikun.test" }),
    ).rejects.toThrow(/Unexpected RP ID hash/);
    await expect(
      verifyAuthentication(proof.credential, {
        expectedRPID: "other.tanikun.test",
      }),
    ).rejects.toThrow(/Unexpected RP ID hash/);
  });
});
