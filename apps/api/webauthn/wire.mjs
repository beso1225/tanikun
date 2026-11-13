import {
  AuthStorageError,
  AUTH_STORAGE_LIMITS,
  decodeBase64Url,
  requireDisplayName,
} from "../repositories/auth-data.mjs";

export const AUTH_BODY_MAX_BYTES = 32 * 1024;
const MAX_ENCODED_BYTES = 32 * 1024;

function malformed(code = "malformed_request") {
  throw new AuthStorageError(code);
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, required, optional = [], code = "malformed_request") {
  if (!record(value)) malformed(code);
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  for (const key of keys) if (!allowed.has(key)) malformed(code);
  for (const key of required) if (!Object.hasOwn(value, key)) malformed(code);
  return value;
}

function canonical(value, { min = 1, max = MAX_ENCODED_BYTES, code } = {}) {
  let bytes;
  try {
    bytes = decodeBase64Url(value, code ?? "malformed_request");
  } catch {
    malformed(code);
  }
  if (bytes.length < min || bytes.length > max) malformed(code);
  return value;
}

function credentialBody(body, kind) {
  exactKeys(body, ["challenge_id", "credential"]);
  const challengeId = canonical(body.challenge_id, { min: 16, max: 16 });
  const credential = exactKeys(body.credential, [
    "id",
    "rawId",
    "type",
    "response",
  ]);
  if (credential.type !== "public-key") malformed();
  if (credential.id !== credential.rawId) malformed();
  canonical(credential.id, {
    min: 1,
    max: AUTH_STORAGE_LIMITS.credentialIdMaxBytes,
  });
  const response =
    kind === "registration"
      ? exactKeys(credential.response, ["clientDataJSON", "attestationObject"])
      : exactKeys(
          credential.response,
          ["clientDataJSON", "authenticatorData", "signature"],
          ["userHandle"],
        );
  canonical(response.clientDataJSON);
  if (kind === "registration") {
    canonical(response.attestationObject);
  } else {
    canonical(response.authenticatorData);
    canonical(response.signature);
    if (Object.hasOwn(response, "userHandle") && response.userHandle !== null)
      canonical(response.userHandle, { min: 32, max: 32 });
  }
  return { challengeId, credential, response };
}

export function parseRegistrationVerification(body) {
  const { challengeId, credential, response } = credentialBody(
    body,
    "registration",
  );
  return {
    challengeId,
    credential: {
      id: credential.id,
      rawId: credential.id,
      type: "public-key",
      response: {
        clientDataJSON: response.clientDataJSON,
        attestationObject: response.attestationObject,
      },
    },
  };
}

export function parseAssertionVerification(body, { discoverable }) {
  const { challengeId, credential, response } = credentialBody(
    body,
    "assertion",
  );
  const hasUserHandle = Object.hasOwn(response, "userHandle");
  if (discoverable && (!hasUserHandle || response.userHandle === null))
    malformed();
  return {
    challengeId,
    credential: {
      id: credential.id,
      rawId: credential.id,
      type: "public-key",
      response: {
        clientDataJSON: response.clientDataJSON,
        authenticatorData: response.authenticatorData,
        signature: response.signature,
        ...(hasUserHandle ? { userHandle: response.userHandle } : {}),
      },
    },
    userHandle: hasUserHandle ? response.userHandle : undefined,
  };
}

export function parseRegistrationOptionsBody(body) {
  exactKeys(body, [], ["display_name"]);
  if (!Object.hasOwn(body, "display_name")) return undefined;
  if (typeof body.display_name !== "string") malformed();
  return requireDisplayName(body.display_name);
}

export function parseAuthenticationOptionsBody(body) {
  exactKeys(body, []);
}

// One strict parse per ceremony body. The session boundary uses the returned
// credential ID for the sign-in credential-scope budget before any challenge
// lookup or signature verification. The ceremony dispatch passes the same
// parsed value onward so a request is never interpreted twice.
export function parseCeremonyBody(routeId, body) {
  switch (routeId) {
    case "registration_options":
      return { displayName: parseRegistrationOptionsBody(body) };
    case "sign_in_options":
    case "step_up_options":
    case "credential_add_options":
      parseAuthenticationOptionsBody(body);
      return {};
    case "registration_verify":
    case "credential_add_verify":
      return { registration: parseRegistrationVerification(body) };
    case "sign_in_verify": {
      const assertion = parseAssertionVerification(body, {
        discoverable: true,
      });
      return { assertion, credentialId: assertion.credential.id };
    }
    case "step_up_verify":
      return {
        assertion: parseAssertionVerification(body, { discoverable: false }),
      };
    default:
      malformed("not_found");
  }
}
