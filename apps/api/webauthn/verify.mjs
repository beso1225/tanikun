// Spike-only WebAuthn verifier boundary. The Worker bridge does not import
// this module; #176 proves the selected library in the pinned Workers runtime
// and in the packaged API artifact before #177 chooses product integration.
//
// The library owns CBOR parsing and signature verification. Do not add
// hand-written WebAuthn cryptography here.
export {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
