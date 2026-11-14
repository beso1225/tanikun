/*
 * Pure state and export helpers for the isolated PRF physical probe.
 *
 * This module never stores PRF bytes. It accepts only booleans, counts, status
 * enums, and validated labels. The browser page keeps the actual PRF results
 * in local Uint8Arrays for in-memory comparison and zeroizes them when it can.
 */

export const PROBE_ORIGIN = "https://localhost:4300";
export const PROBE_RP_ID = "localhost";
export const PROBE_PORT = 4300;
export const EXPORT_SCHEMA = "tanikun-prf-probe-export-v1";
export const CELL_IDS = Object.freeze(["R1", "A1", "A2", "A3", "R2", "A4"]);

export const STATUS = Object.freeze({
  SUPPORTED: "supported",
  UNSUPPORTED: "unsupported",
  DENIED: "denied",
  FAILED: "failed",
  UNTESTED: "untested",
});

export const TLS_TRUST = Object.freeze({
  TRUSTED: "trusted",
  BYPASSED: "bypassed",
  BLOCKED: "blocked",
  UNKNOWN: "unknown",
});

export const TRANSPORT = Object.freeze({
  PLATFORM: "platform",
  HYBRID: "hybrid",
  USB: "usb",
  NFC: "nfc",
  BLE: "ble",
  INTERNAL: "internal",
  UNKNOWN: "unknown",
});

export const BROWSER = Object.freeze({
  CHROME: "chrome",
  SAFARI: "safari",
  OTHER: "other",
});

export const DEVICE_ROLE = Object.freeze({
  MAC: "mac",
  IPHONE: "iphone",
});

export const CLEANUP_STATUS = Object.freeze({
  PENDING: "pending",
  COMPLETE: "complete",
  BLOCKED: "blocked",
});

export const LIMITATION = Object.freeze({
  TLS_BYPASSED: "tls_trust_bypassed",
  TLS_BLOCKED: "tls_trust_blocked",
});

export const BLOCKER = Object.freeze({
  NONE: null,
  NOT_RUN: "not_run",
  PRF_NOT_ENABLED: "prf_not_enabled",
  PRF_ENABLED_ABSENT: "prf_enabled_absent",
  PRF_ENABLED_WITHOUT_RESULT: "prf_enabled_without_result",
  PRF_ENABLED_INCONSISTENT: "prf_enabled_inconsistent",
  PRF_RESULT_LENGTH: "prf_result_length",
  CLIENT_CAPABILITY_FALSE: "client_capability_false",
  CLIENT_CAPABILITY_CONFLICT: "client_capability_conflict",
  FLAGS_NOT_INSPECTED: "flags_not_inspected",
  USER_PRESENCE_FALSE: "user_presence_false",
  USER_VERIFICATION_FALSE: "user_verification_false",
  CEREMONY_ERROR: "ceremony_error",
  HUMAN_CANCELLED: "human_cancelled",
  REPEAT_MISMATCH: "repeat_mismatch",
  INPUT_SEPARATION_FAILED: "input_separation_failed",
  CREDENTIAL_SEPARATION_FAILED: "credential_separation_failed",
  PROVIDER_MISSING: "provider_missing",
  CLEANUP_BLOCKED: "cleanup_blocked",
});

export const COMPARISON = Object.freeze({
  EQUAL: "equal",
  DIFFERENT: "different",
  UNTESTED: "untested",
});

export const OBSERVATION = Object.freeze({
  YES: "yes",
  NO: "no",
  NOT_OBSERVED: "not_observed",
});

const ERROR_NAMES = new Set([
  "other",
  "AbortError",
  "ConstraintError",
  "DataError",
  "InvalidStateError",
  "NetworkError",
  "NotAllowedError",
  "NotFoundError",
  "NotSupportedError",
  "OperationError",
  "SecurityError",
  "TypeError",
  "UnknownError",
]);

const CANCEL_ERRORS = new Set(["AbortError", "NotAllowedError"]);
const LABEL_PATTERN = /^[\w .+()/',-]{1,80}$/u;
const VERSION_PATTERN = /^[\w .+()/-]{1,40}$/u;
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|unknown)$/u;
const RUN_ID_PATTERN = /^[0-9a-z-]{1,64}$/u;

function asBooleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function asCountOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function safeErrorName(value) {
  const name =
    typeof value === "string"
      ? value
      : value && typeof value === "object"
        ? value.name
        : "";
  return ERROR_NAMES.has(name) ? name : "other";
}

export function isSafeLabel(value) {
  return typeof value === "string" && LABEL_PATTERN.test(value);
}

export function isSafeVersion(value) {
  return typeof value === "string" && VERSION_PATTERN.test(value);
}

export function isSafeCommit(value) {
  return typeof value === "string" && COMMIT_PATTERN.test(value);
}

export function isSafeRunId(value) {
  return typeof value === "string" && RUN_ID_PATTERN.test(value);
}

export function oneOf(values, value) {
  return Object.values(values).includes(value);
}

export function createCell(id) {
  if (!CELL_IDS.includes(id)) throw new Error(`unknown probe cell: ${id}`);
  return {
    id,
    status: STATUS.UNTESTED,
    errorName: null,
    prfEnabled: null,
    resultPresent: null,
    resultLength: null,
    upFlag: null,
    uvFlag: null,
    beFlag: null,
    bsFlag: null,
    upObserved: null,
    uvObserved: null,
    cancelObserved: false,
    providerId: null,
    transport: null,
    blocker: BLOCKER.NOT_RUN,
  };
}

export function createProvider(id) {
  return { id, label: "", appVersion: "", extensionVersion: "" };
}

export function createRunState() {
  return {
    runId: "",
    harnessCommit: "unknown",
    preflight: {
      origin: PROBE_ORIGIN,
      rpId: PROBE_RP_ID,
      secureContext: false,
      topLevel: false,
      publicKeyCredential: false,
      clientCapabilities: false,
      prfCapability: null,
      tlsTrust: TLS_TRUST.UNKNOWN,
    },
    environment: {
      deviceRole: "",
      deviceModel: "",
      os: "",
      osBuild: "",
      browser: "",
      browserVersion: "",
    },
    providers: [
      createProvider("P1"),
      createProvider("P2"),
      createProvider("P3"),
    ],
    cells: Object.fromEntries(CELL_IDS.map((id) => [id, createCell(id)])),
    comparisons: {
      sameCredentialSameInput: COMPARISON.UNTESTED,
      differentInput: COMPARISON.UNTESTED,
      differentCredential: COMPARISON.UNTESTED,
    },
    cleanup: {
      c1AbsentConfirmed: false,
      c2AbsentConfirmed: false,
      chooserAbsent: false,
      status: CLEANUP_STATUS.PENDING,
      blocker: null,
    },
    limitations: [],
  };
}

export function classifyRegistration(result) {
  const cell = {
    status: STATUS.FAILED,
    errorName: result.ok ? null : safeErrorName(result.errorName),
    prfEnabled: asBooleanOrNull(result.prfEnabled),
    resultPresent: asBooleanOrNull(result.resultPresent),
    resultLength: asCountOrNull(result.resultLength),
    upFlag: asBooleanOrNull(result.upFlag),
    uvFlag: asBooleanOrNull(result.uvFlag),
    beFlag: asBooleanOrNull(result.beFlag),
    bsFlag: asBooleanOrNull(result.bsFlag),
    blocker: BLOCKER.CEREMONY_ERROR,
  };

  if (!result.ok) {
    if (result.cancelled && CANCEL_ERRORS.has(cell.errorName)) {
      return {
        ...cell,
        status: STATUS.DENIED,
        blocker: BLOCKER.HUMAN_CANCELLED,
      };
    }
    return cell;
  }

  if (cell.resultPresent === true && cell.resultLength !== 32) {
    return { ...cell, blocker: BLOCKER.PRF_RESULT_LENGTH };
  }
  if (cell.resultPresent === true && cell.prfEnabled !== true) {
    return { ...cell, blocker: BLOCKER.PRF_ENABLED_INCONSISTENT };
  }
  if (cell.prfEnabled === true) {
    return { ...cell, status: STATUS.SUPPORTED, blocker: BLOCKER.NONE };
  }
  if (cell.prfEnabled === false) {
    return {
      ...cell,
      status: STATUS.UNSUPPORTED,
      blocker: BLOCKER.PRF_NOT_ENABLED,
    };
  }
  return {
    ...cell,
    status: STATUS.UNSUPPORTED,
    blocker: BLOCKER.PRF_ENABLED_ABSENT,
  };
}

export function classifyAssertion(result) {
  const cell = {
    status: STATUS.FAILED,
    errorName: result.ok ? null : safeErrorName(result.errorName),
    resultPresent: asBooleanOrNull(result.resultPresent),
    resultLength: asCountOrNull(result.resultLength),
    upFlag: asBooleanOrNull(result.upFlag),
    uvFlag: asBooleanOrNull(result.uvFlag),
    beFlag: asBooleanOrNull(result.beFlag),
    bsFlag: asBooleanOrNull(result.bsFlag),
    blocker: BLOCKER.CEREMONY_ERROR,
  };
  const prfEnabledAtRegistration = asBooleanOrNull(
    result.prfEnabledAtRegistration,
  );
  const clientCapability = asBooleanOrNull(result.clientCapability);

  if (!result.ok) {
    if (result.cancelled && CANCEL_ERRORS.has(cell.errorName)) {
      return {
        ...cell,
        status: STATUS.DENIED,
        blocker: BLOCKER.HUMAN_CANCELLED,
      };
    }
    return cell;
  }

  if (cell.resultPresent !== true) {
    if (clientCapability === false) {
      return {
        ...cell,
        status: STATUS.UNSUPPORTED,
        blocker: BLOCKER.CLIENT_CAPABILITY_FALSE,
      };
    }
    if (prfEnabledAtRegistration === true) {
      return {
        ...cell,
        status: STATUS.FAILED,
        blocker: BLOCKER.PRF_ENABLED_WITHOUT_RESULT,
      };
    }
    if (prfEnabledAtRegistration === false) {
      return {
        ...cell,
        status: STATUS.UNSUPPORTED,
        blocker: BLOCKER.PRF_NOT_ENABLED,
      };
    }
    return {
      ...cell,
      status: STATUS.UNSUPPORTED,
      blocker: BLOCKER.PRF_ENABLED_ABSENT,
    };
  }

  if (cell.resultLength !== 32) {
    return { ...cell, blocker: BLOCKER.PRF_RESULT_LENGTH };
  }
  if (prfEnabledAtRegistration === false) {
    return { ...cell, blocker: BLOCKER.PRF_ENABLED_INCONSISTENT };
  }
  if (clientCapability === false) {
    return {
      ...cell,
      blocker: BLOCKER.CLIENT_CAPABILITY_CONFLICT,
    };
  }
  if (cell.upFlag === false) {
    return { ...cell, blocker: BLOCKER.USER_PRESENCE_FALSE };
  }
  if (cell.uvFlag === false) {
    return { ...cell, blocker: BLOCKER.USER_VERIFICATION_FALSE };
  }
  if (cell.upFlag === null || cell.uvFlag === null) {
    return {
      ...cell,
      status: STATUS.UNTESTED,
      blocker: BLOCKER.FLAGS_NOT_INSPECTED,
    };
  }
  return { ...cell, status: STATUS.SUPPORTED, blocker: BLOCKER.NONE };
}

export function readAuthenticatorFlags(data) {
  let bytes = null;
  if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else if (ArrayBuffer.isView(data)) {
    bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (!bytes || bytes.byteLength < 37) {
    return { up: null, uv: null, be: null, bs: null };
  }
  const flags = bytes[32];
  return {
    up: Boolean(flags & 0x01),
    uv: Boolean(flags & 0x04),
    be: Boolean(flags & 0x08),
    bs: Boolean(flags & 0x10),
  };
}

export function compareBytes(left, right) {
  if (!left || !right) return false;
  const leftBytes = left instanceof Uint8Array ? left : new Uint8Array(left);
  const rightBytes =
    right instanceof Uint8Array ? right : new Uint8Array(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

export function compareOutcome(left, right) {
  if (!left || !right) return COMPARISON.UNTESTED;
  return compareBytes(left, right) ? COMPARISON.EQUAL : COMPARISON.DIFFERENT;
}

export function zeroize(data) {
  if (!data) return;
  if (data instanceof ArrayBuffer) {
    new Uint8Array(data).fill(0);
    return;
  }
  if (ArrayBuffer.isView(data)) {
    data.fill(0);
  }
}

function isCancelError(name) {
  return CANCEL_ERRORS.has(name);
}

export function isDeniedError(errorName) {
  return isCancelError(errorName);
}

export function validateProvider(provider) {
  const errors = [];
  if (provider.label && !isSafeLabel(provider.label)) {
    errors.push(`${provider.id}.label`);
  }
  if (provider.appVersion && !isSafeVersion(provider.appVersion)) {
    errors.push(`${provider.id}.app_version`);
  }
  if (provider.extensionVersion && !isSafeVersion(provider.extensionVersion)) {
    errors.push(`${provider.id}.extension_version`);
  }
  return errors;
}

export function validateForExport(state) {
  const errors = [];
  if (!isSafeRunId(state.runId)) errors.push("run_id");
  if (!isSafeCommit(state.harnessCommit)) errors.push("harness_commit");
  if (state.preflight.origin !== PROBE_ORIGIN) errors.push("origin");
  if (state.preflight.rpId !== PROBE_RP_ID) errors.push("rp_id");
  if (state.preflight.secureContext !== true) errors.push("secure_context");
  if (state.preflight.topLevel !== true) errors.push("top_level");
  if (state.preflight.publicKeyCredential !== true) {
    errors.push("public_key_credential");
  }
  if (!oneOf(TLS_TRUST, state.preflight.tlsTrust)) errors.push("tls_trust");
  if (
    state.environment.deviceRole &&
    !oneOf(DEVICE_ROLE, state.environment.deviceRole)
  ) {
    errors.push("device_role");
  }
  if (state.environment.browser && !oneOf(BROWSER, state.environment.browser)) {
    errors.push("browser");
  }
  for (const [key, value] of Object.entries(state.environment)) {
    if (key === "deviceRole" || key === "browser") continue;
    if (value && !isSafeLabel(value)) errors.push(`environment.${key}`);
  }
  for (const provider of state.providers) {
    if (!["P1", "P2", "P3"].includes(provider.id)) {
      errors.push(`provider.${provider.id}`);
    }
    errors.push(...validateProvider(provider));
  }
  for (const id of CELL_IDS) {
    const cell = state.cells[id];
    if (!cell) {
      errors.push(`cell.${id}`);
      continue;
    }
    if (!oneOf(STATUS, cell.status)) errors.push(`cell.${id}.status`);
    if (cell.errorName !== null && !ERROR_NAMES.has(cell.errorName)) {
      errors.push(`cell.${id}.error_name`);
    }
    if (cell.blocker !== null && !oneOf(BLOCKER, cell.blocker)) {
      errors.push(`cell.${id}.blocker`);
    }
    if (cell.transport !== null && !oneOf(TRANSPORT, cell.transport)) {
      errors.push(`cell.${id}.transport`);
    }
    if (cell.status === STATUS.SUPPORTED && !cell.providerId) {
      errors.push(`cell.${id}.provider_id`);
    }
    if (cell.providerId) {
      const provider = state.providers.find(
        (candidate) => candidate.id === cell.providerId,
      );
      if (!provider || !provider.label) {
        errors.push(`cell.${id}.provider_id`);
      }
    }
  }
  for (const [key, value] of Object.entries(state.comparisons)) {
    if (!oneOf(COMPARISON, value)) errors.push(`comparison.${key}`);
  }
  if (!oneOf(CLEANUP_STATUS, state.cleanup.status)) {
    errors.push("cleanup.status");
  }
  if (
    state.cleanup.status === CLEANUP_STATUS.COMPLETE &&
    !(
      state.cleanup.c1AbsentConfirmed &&
      state.cleanup.c2AbsentConfirmed &&
      state.cleanup.chooserAbsent
    )
  ) {
    errors.push("cleanup.booleans");
  }
  if (
    state.cleanup.status === CLEANUP_STATUS.COMPLETE &&
    state.cleanup.blocker !== null
  ) {
    errors.push("cleanup.blocker");
  }
  if (
    state.cleanup.status === CLEANUP_STATUS.BLOCKED &&
    state.cleanup.blocker === null
  ) {
    errors.push("cleanup.blocker");
  }
  if (
    state.cleanup.blocker !== null &&
    !oneOf(BLOCKER, state.cleanup.blocker)
  ) {
    errors.push("cleanup.blocker");
  }
  for (const limitation of state.limitations) {
    if (!oneOf(LIMITATION, limitation)) errors.push("limitation");
  }
  return errors;
}

function exportProvider(provider) {
  return {
    id: provider.id,
    label: provider.label,
    app_version: provider.appVersion,
    extension_version: provider.extensionVersion,
  };
}

function exportCell(cell) {
  return {
    id: cell.id,
    status: cell.status,
    error_name: cell.errorName,
    prf_enabled: cell.prfEnabled,
    result_present: cell.resultPresent,
    result_length: cell.resultLength,
    up_flag: cell.upFlag,
    uv_flag: cell.uvFlag,
    be_flag: cell.beFlag,
    bs_flag: cell.bsFlag,
    up_observed: cell.upObserved,
    uv_observed: cell.uvObserved,
    cancel_observed: cell.cancelObserved === true,
    provider_id: cell.providerId,
    transport: cell.transport,
    blocker: cell.blocker,
  };
}

export function buildExport(state, now = new Date()) {
  const errors = validateForExport(state);
  if (errors.length > 0) {
    throw new Error(`invalid PRF probe export: ${errors.join(", ")}`);
  }
  const generatedAt = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("invalid export timestamp");
  }
  const limitations = [...state.limitations];
  if (
    state.preflight.tlsTrust === TLS_TRUST.BYPASSED &&
    !limitations.includes(LIMITATION.TLS_BYPASSED)
  ) {
    limitations.push(LIMITATION.TLS_BYPASSED);
  }
  if (
    state.preflight.tlsTrust === TLS_TRUST.BLOCKED &&
    !limitations.includes(LIMITATION.TLS_BLOCKED)
  ) {
    limitations.push(LIMITATION.TLS_BLOCKED);
  }
  return {
    schema: EXPORT_SCHEMA,
    generated_at: generatedAt.toISOString(),
    run_id: state.runId,
    harness_commit: state.harnessCommit,
    preflight: {
      origin: state.preflight.origin,
      rp_id: state.preflight.rpId,
      secure_context: state.preflight.secureContext,
      top_level: state.preflight.topLevel,
      public_key_credential: state.preflight.publicKeyCredential,
      client_capabilities: state.preflight.clientCapabilities,
      prf_client_capability: state.preflight.prfCapability,
      tls_trust: state.preflight.tlsTrust,
    },
    environment: {
      device_role: state.environment.deviceRole,
      device_model: state.environment.deviceModel,
      os: state.environment.os,
      os_build: state.environment.osBuild,
      browser: state.environment.browser,
      browser_version: state.environment.browserVersion,
    },
    providers: state.providers.map(exportProvider),
    cells: CELL_IDS.map((id) => exportCell(state.cells[id])),
    comparisons: {
      same_credential_same_input: state.comparisons.sameCredentialSameInput,
      different_input: state.comparisons.differentInput,
      different_credential: state.comparisons.differentCredential,
    },
    cleanup: {
      c1_absent_confirmed: state.cleanup.c1AbsentConfirmed,
      c2_absent_confirmed: state.cleanup.c2AbsentConfirmed,
      chooser_absent: state.cleanup.chooserAbsent,
      status: state.cleanup.status,
      blocker: state.cleanup.blocker,
    },
    recommendation: "pending_human",
    limitations,
  };
}
