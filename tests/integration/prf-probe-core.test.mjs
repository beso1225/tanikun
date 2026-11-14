import assert from "node:assert/strict";
import test from "node:test";

import {
  BLOCKER,
  CLEANUP_STATUS,
  COMPARISON,
  EXPORT_SCHEMA,
  PROBE_ORIGIN,
  PROBE_RP_ID,
  STATUS,
  TLS_TRUST,
  buildExport,
  classifyAssertion,
  classifyRegistration,
  compareBytes,
  compareOutcome,
  createRunState,
  isSafeLabel,
  isSafeVersion,
  readAuthenticatorFlags,
  safeErrorName,
  validateForExport,
  zeroize,
} from "../../tools/prf-probe/public/probe-core.mjs";

function validState() {
  const state = createRunState();
  state.runId = "00000000-0000-4000-8000-000000000000";
  state.harnessCommit = "a".repeat(40);
  state.preflight.secureContext = true;
  state.preflight.topLevel = true;
  state.preflight.publicKeyCredential = true;
  state.preflight.clientCapabilities = true;
  state.preflight.prfCapability = true;
  state.preflight.tlsTrust = TLS_TRUST.TRUSTED;
  state.environment = {
    deviceRole: "mac",
    deviceModel: "Mac15,12",
    os: "macOS 27.2.1",
    osBuild: "26B131",
    browser: "chrome",
    browserVersion: "157.0.8103.51",
  };
  state.providers[0] = {
    id: "P1",
    label: "1Password",
    appVersion: "8.12.44",
    extensionVersion: "8.12.44",
  };
  for (const id of ["R1", "A1", "A2", "A3", "R2", "A4"]) {
    state.cells[id].providerId = "P1";
    state.cells[id].transport = "platform";
  }
  return state;
}

test("probe constants use the accepted Phase 5 origin and RP ID", () => {
  assert.equal(PROBE_ORIGIN, "https://localhost:4300");
  assert.equal(PROBE_RP_ID, "localhost");
  assert.equal(EXPORT_SCHEMA, "tanikun-prf-probe-export-v1");
  assert.deepEqual(Object.values(STATUS).toSorted(), [
    "denied",
    "failed",
    "supported",
    "unsupported",
    "untested",
  ]);
});

test("registration classification separates support, unsupported, denial, and failure", () => {
  assert.deepEqual(
    classifyRegistration({
      ok: true,
      prfEnabled: true,
      resultPresent: false,
      resultLength: null,
      upFlag: true,
      uvFlag: true,
      beFlag: false,
      bsFlag: false,
    }),
    {
      status: STATUS.SUPPORTED,
      errorName: null,
      prfEnabled: true,
      resultPresent: false,
      resultLength: null,
      upFlag: true,
      uvFlag: true,
      beFlag: false,
      bsFlag: false,
      blocker: BLOCKER.NONE,
    },
  );

  assert.equal(
    classifyRegistration({
      ok: true,
      prfEnabled: false,
      resultPresent: false,
    }).status,
    STATUS.UNSUPPORTED,
  );
  assert.equal(
    classifyRegistration({
      ok: true,
      prfEnabled: null,
      resultPresent: false,
    }).status,
    STATUS.UNSUPPORTED,
  );
  assert.equal(
    classifyRegistration({
      ok: true,
      prfEnabled: false,
      resultPresent: true,
      resultLength: 32,
    }).status,
    STATUS.FAILED,
  );
  assert.equal(
    classifyRegistration({
      ok: true,
      prfEnabled: true,
      resultPresent: true,
      resultLength: 16,
    }).status,
    STATUS.FAILED,
  );
  assert.equal(
    classifyRegistration({
      ok: false,
      errorName: "NotAllowedError",
      cancelled: true,
    }).status,
    STATUS.DENIED,
  );
  assert.equal(
    classifyRegistration({
      ok: false,
      errorName: "NotAllowedError",
      cancelled: false,
    }).status,
    STATUS.FAILED,
  );
  assert.equal(
    classifyRegistration({
      ok: false,
      errorName: "NotSupportedError",
      cancelled: true,
    }).status,
    STATUS.FAILED,
  );
});

test("assertion classification requires a 32-byte result and inspected UP and UV flags", () => {
  const base = {
    ok: true,
    prfEnabledAtRegistration: true,
    clientCapability: true,
    resultPresent: true,
    resultLength: 32,
    upFlag: true,
    uvFlag: true,
  };
  assert.equal(classifyAssertion(base).status, STATUS.SUPPORTED);
  assert.equal(
    classifyAssertion({ ...base, resultLength: 31 }).status,
    STATUS.FAILED,
  );
  assert.equal(
    classifyAssertion({ ...base, uvFlag: false }).status,
    STATUS.FAILED,
  );
  assert.equal(
    classifyAssertion({ ...base, upFlag: null }).status,
    STATUS.UNTESTED,
  );
  assert.equal(
    classifyAssertion({ ...base, resultPresent: false }).status,
    STATUS.FAILED,
  );
  assert.equal(
    classifyAssertion({
      ...base,
      resultPresent: false,
      prfEnabledAtRegistration: false,
    }).status,
    STATUS.UNSUPPORTED,
  );
  assert.equal(
    classifyAssertion({
      ...base,
      resultPresent: false,
      prfEnabledAtRegistration: null,
      clientCapability: false,
    }).status,
    STATUS.UNSUPPORTED,
  );
  assert.equal(
    classifyAssertion({
      ...base,
      resultPresent: false,
      prfEnabledAtRegistration: null,
      clientCapability: true,
    }).status,
    STATUS.UNSUPPORTED,
  );
  assert.equal(
    classifyAssertion({
      ...base,
      clientCapability: false,
    }).status,
    STATUS.FAILED,
  );
  assert.equal(
    classifyAssertion({
      ...base,
      ok: false,
      errorName: "NotAllowedError",
      cancelled: true,
    }).status,
    STATUS.DENIED,
  );
});

test("byte comparison and zeroization do not retain values", () => {
  const left = Uint8Array.from([1, 2, 3]);
  const right = Uint8Array.from([1, 2, 3]);
  assert.equal(compareBytes(left, right), true);
  assert.equal(compareBytes(left, Uint8Array.from([1, 2, 4])), false);
  assert.equal(compareOutcome(left, right), COMPARISON.EQUAL);
  assert.equal(
    compareOutcome(left, Uint8Array.from([1, 2, 4])),
    COMPARISON.DIFFERENT,
  );
  assert.equal(compareOutcome(left, null), COMPARISON.UNTESTED);
  zeroize(left);
  assert.deepEqual(Array.from(left), [0, 0, 0]);
});

test("authenticator flags are read without retaining the buffer", () => {
  const data = new Uint8Array(37);
  data[32] = 0x1d;
  assert.deepEqual(readAuthenticatorFlags(data), {
    up: true,
    uv: true,
    be: true,
    bs: true,
  });
  data[32] = 0x00;
  assert.deepEqual(readAuthenticatorFlags(data), {
    up: false,
    uv: false,
    be: false,
    bs: false,
  });
  assert.deepEqual(readAuthenticatorFlags(new Uint8Array(4)), {
    up: null,
    uv: null,
    be: null,
    bs: null,
  });
});

test("labels and versions accept real device metadata and reject secrets", () => {
  assert.equal(isSafeLabel("Mac15,12"), true);
  assert.equal(isSafeLabel("iCloud Keychain"), true);
  assert.equal(isSafeLabel("user@example.invalid"), false);
  assert.equal(isSafeLabel("line\nbreak"), false);
  assert.equal(isSafeVersion("27.2.1 (26B131)"), true);
  assert.equal(isSafeVersion("8.12.44"), true);
  assert.equal(isSafeVersion("<script>"), false);
  assert.equal(
    safeErrorName({ name: "NotAllowedError", message: "secret" }),
    "NotAllowedError",
  );
  assert.equal(
    safeErrorName({ name: "WeirdError", message: "secret" }),
    "other",
  );
});

test("safe export ignores hidden state and never includes PRF or credential material", () => {
  const state = validState();
  const canary = "TANIKUN-PRF-CANARY-EXPORT-MUST-NOT-LEAK";
  state.notes = canary;
  state.cells.A1.raw = {
    ok: true,
    resultBytes: Array.from(new TextEncoder().encode(canary)),
  };
  state.cells.A1.credentialId = canary;
  state.cells.A1.challenge = canary;
  state.cells.A1.prfBytes = canary;

  const exported = buildExport(state, new Date("2026-11-14T00:00:00.000Z"));
  const text = JSON.stringify(exported);
  assert.equal(text.includes(canary), false);
  assert.equal(text.includes("resultBytes"), false);
  assert.equal(text.includes("credentialId"), false);
  assert.equal(text.includes("prfBytes"), false);
  assert.equal(exported.schema, EXPORT_SCHEMA);
  assert.equal(exported.recommendation, "pending_human");
  assert.equal(exported.preflight.origin, PROBE_ORIGIN);
  assert.equal(exported.preflight.rp_id, PROBE_RP_ID);
  assert.equal(exported.cells.length, 6);
  assert.deepEqual(
    exported.cells.map((cell) => cell.id),
    ["R1", "A1", "A2", "A3", "R2", "A4"],
  );
  assert.equal(Object.hasOwn(exported.cells[0], "result_bytes"), false);
  assert.equal(Object.hasOwn(exported.cells[0], "credential_id"), false);
});

test("export validation rejects an incomplete supported cell and incomplete cleanup", () => {
  const state = validState();
  state.cells.R1.status = STATUS.SUPPORTED;
  state.cells.R1.providerId = null;
  assert.ok(validateForExport(state).includes("cell.R1.provider_id"));
  state.cells.R1.providerId = "P1";
  state.cleanup.status = CLEANUP_STATUS.COMPLETE;
  assert.ok(validateForExport(state).includes("cleanup.booleans"));
  state.cleanup.c1AbsentConfirmed = true;
  state.cleanup.c2AbsentConfirmed = true;
  state.cleanup.chooserAbsent = true;
  state.cleanup.blocker = "cleanup_blocked";
  assert.ok(validateForExport(state).includes("cleanup.blocker"));
  state.cleanup.blocker = null;
  assert.deepEqual(validateForExport(state), []);
  state.cleanup.status = CLEANUP_STATUS.BLOCKED;
  assert.ok(validateForExport(state).includes("cleanup.blocker"));
  state.cleanup.blocker = BLOCKER.CLEANUP_BLOCKED;
  assert.deepEqual(validateForExport(state), []);
});

test("TLS bypass is exported as a limitation and not as provider support", () => {
  const state = validState();
  state.preflight.tlsTrust = TLS_TRUST.BYPASSED;
  const exported = buildExport(state, new Date("2026-11-14T00:00:00.000Z"));
  assert.equal(exported.preflight.tls_trust, "bypassed");
  assert.ok(exported.limitations.includes("tls_trust_bypassed"));
  assert.equal(exported.recommendation, "pending_human");
  assert.equal(
    exported.cells.every((cell) => cell.status === STATUS.UNTESTED),
    true,
  );
});

test("invalid statuses and missing provider labels are rejected at export", () => {
  const state = validState();
  state.cells.A1.status = "maybe";
  assert.throws(() => buildExport(state), /invalid PRF probe export/u);
  const other = validState();
  other.cells.A1.status = STATUS.SUPPORTED;
  other.cells.A1.providerId = "P1";
  other.providers[0].label = "";
  assert.throws(() => buildExport(other), /invalid PRF probe export/u);
});

test("an unknown native error exports only its safe fallback name", () => {
  const state = validState();
  Object.assign(
    state.cells.A1,
    classifyAssertion({ ok: false, errorName: "Private native diagnostic" }),
  );
  const exported = buildExport(state);
  assert.equal(
    exported.cells.find((cell) => cell.id === "A1").error_name,
    "other",
  );
  assert.equal(
    JSON.stringify(exported).includes("Private native diagnostic"),
    false,
  );
});

test("assertion results contradicting a disabled registration are failed", () => {
  const result = classifyAssertion({
    ok: true,
    prfEnabledAtRegistration: false,
    clientCapability: true,
    resultPresent: true,
    resultLength: 32,
    upFlag: true,
    uvFlag: true,
  });
  assert.equal(result.status, STATUS.FAILED);
  assert.equal(result.blocker, BLOCKER.PRF_ENABLED_INCONSISTENT);
});
