// Self-contained packaged entry for the Phase 5 auth service. The Nix API
// derivation bundles this module with esbuild so the packaged artifact never
// needs a bare npm import, a source checkout, or a node_modules fallback.
export { createAuthCeremonyService } from "./service.mjs";
export {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  CEREMONY_TIMEOUT_MS,
} from "./options.mjs";
export {
  createSessionMaterial,
  deriveCsrfToken,
  sha256,
} from "./session-material.mjs";
export { readSessionAuthConfig } from "./config.mjs";
export {
  parseAssertionVerification,
  parseRegistrationVerification,
} from "./wire.mjs";
export { handleWebAuthnRequest } from "../http/webauthn.mjs";
export { handleSessionAuthRequest } from "../http/session-auth.mjs";
