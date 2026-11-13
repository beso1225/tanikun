// WebAuthn verifier boundary. The library owns CBOR parsing, attestation, and
// signature verification. Do not add hand-written WebAuthn cryptography here.
//
// Source tests import this module directly. The packaged API consumes the
// self-contained `auth.js` bundle built from `entry.mjs`, so this module's bare
// library imports never leak into the Nix output.
export {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
