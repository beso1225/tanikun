import {
  BLOCKER,
  CELL_IDS,
  CLEANUP_STATUS,
  COMPARISON,
  OBSERVATION,
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
  readAuthenticatorFlags,
  safeErrorName,
  zeroize,
} from "./probe-core.mjs";

const state = createRunState();
const salts = { a: null, b: null };
const credentials = { c1: null, c2: null };
const outputs = { a1: null, a2: null, a3: null, a4: null };
const aliases = { c1: null, c2: null };
let secretsCleared = false;
let invalidated = false;

function element(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const target = element(id);
  if (target) target.textContent = value;
}

function setDisabled(id, disabled) {
  const target = element(id);
  if (target) target.disabled = disabled;
}

function inputValue(id) {
  return element(id)?.value.trim() ?? "";
}

function selectValue(id) {
  const value = element(id)?.value ?? "";
  return value === "" ? null : value;
}

function checked(id) {
  return element(id)?.checked === true;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function copyBytes(source) {
  if (source instanceof ArrayBuffer) {
    const view = new Uint8Array(source);
    const copy = view.slice();
    zeroize(view);
    return { present: true, length: copy.byteLength, bytes: copy };
  }
  if (ArrayBuffer.isView(source)) {
    const view = new Uint8Array(
      source.buffer,
      source.byteOffset,
      source.byteLength,
    );
    const copy = view.slice();
    zeroize(view);
    return { present: true, length: copy.byteLength, bytes: copy };
  }
  return { present: true, length: 0, bytes: null };
}

function copyPrfResult(source) {
  if (source === undefined || source === null) {
    return { present: false, length: null, bytes: null };
  }
  return copyBytes(source);
}

function copyRawId(source) {
  if (source === undefined || source === null) return null;
  if (!(source instanceof ArrayBuffer) && !ArrayBuffer.isView(source)) {
    return null;
  }
  const copy = copyBytes(source);
  if (!copy.bytes || copy.bytes.byteLength === 0) {
    zeroize(copy.bytes);
    return null;
  }
  return copy.bytes;
}

function tap(value) {
  return value === true ? "true" : value === false ? "false" : "not inspected";
}

function observationValue(id) {
  const value = selectValue(id);
  return Object.values(OBSERVATION).includes(value) ? value : null;
}

function syncProviders() {
  for (const id of ["P1", "P2", "P3"]) {
    const provider = state.providers.find((candidate) => candidate.id === id);
    if (!provider) continue;
    const prefix = id.toLowerCase();
    provider.label = inputValue(`${prefix}-label`);
    provider.appVersion = inputValue(`${prefix}-app`);
    provider.extensionVersion = inputValue(`${prefix}-ext`);
  }
}

function syncStateFromDom() {
  state.harnessCommit = inputValue("harness-commit") || "unknown";
  state.environment.deviceRole = selectValue("device-role") ?? "";
  state.environment.deviceModel = inputValue("device-model");
  state.environment.os = inputValue("os");
  state.environment.osBuild = inputValue("os-build");
  state.environment.browser = selectValue("browser") ?? "";
  state.environment.browserVersion = inputValue("browser-version");
  state.preflight.tlsTrust = selectValue("tls-trust") ?? TLS_TRUST.UNKNOWN;
  syncProviders();
  for (const id of CELL_IDS) {
    const cell = state.cells[id];
    cell.providerId = selectValue(`provider-${id}`);
    cell.transport = selectValue(`transport-${id}`);
    cell.upObserved = observationValue(`upobs-${id}`);
    cell.uvObserved = observationValue(`uvobs-${id}`);
    cell.cancelObserved = checked(`cancel-${id}`);
  }
  state.cleanup.c1Deleted = checked("cleanup-c1");
  state.cleanup.c2Deleted = checked("cleanup-c2");
  state.cleanup.chooserAbsent = checked("cleanup-chooser");
  state.cleanup.status =
    selectValue("cleanup-status") ?? CLEANUP_STATUS.PENDING;
  state.cleanup.blocker = selectValue("cleanup-blocker");
}

function renderCell(id) {
  const cell = state.cells[id];
  const status = element(`status-${id}`);
  if (status) {
    status.textContent = cell.status;
    status.dataset.status = cell.status;
  }
  setText(`error-${id}`, cell.errorName ?? "none");
  if (id === "R1" || id === "R2") {
    setText(
      `enabled-${id}`,
      cell.raw
        ? cell.prfEnabled === true
          ? "true"
          : cell.prfEnabled === false
            ? "false"
            : "absent"
        : "not recorded",
    );
    setText(
      `result-${id}`,
      cell.raw
        ? cell.resultPresent === true
          ? `present (${cell.resultLength ?? 0} bytes)`
          : "absent"
        : "not applicable",
    );
  } else {
    setText(
      `result-${id}`,
      cell.raw
        ? cell.resultPresent === true
          ? "present"
          : "absent"
        : "not recorded",
    );
    setText(
      `length-${id}`,
      cell.resultLength === null ? "not recorded" : String(cell.resultLength),
    );
  }
  setText(`upflag-${id}`, tap(cell.upFlag));
  setText(`uvflag-${id}`, tap(cell.uvFlag));
  setText(`beflag-${id}`, tap(cell.beFlag));
  setText(`bsflag-${id}`, tap(cell.bsFlag));
  setText(`blocker-${id}`, cell.blocker ?? "none");
}

function renderComparisons() {
  const values = [
    ["cmp-same-input", state.comparisons.sameCredentialSameInput],
    ["cmp-different-input", state.comparisons.differentInput],
    ["cmp-different-credential", state.comparisons.differentCredential],
  ];
  for (const [id, value] of values) {
    const target = element(id);
    if (!target) continue;
    target.textContent = value;
    target.dataset.comparison = value;
  }
}

function renderAliases() {
  setText("alias-c1", aliases.c1 ?? "not created");
  setText("alias-c2", aliases.c2 ?? "not created");
}

function renderAll() {
  for (const id of CELL_IDS) renderCell(id);
  renderComparisons();
  renderAliases();
}

function preflightOk() {
  return (
    state.preflight.origin === PROBE_ORIGIN &&
    state.preflight.rpId === PROBE_RP_ID &&
    state.preflight.secureContext === true &&
    state.preflight.topLevel === true &&
    state.preflight.publicKeyCredential === true &&
    state.preflight.prfCapability !== false &&
    (state.preflight.tlsTrust === TLS_TRUST.TRUSTED ||
      state.preflight.tlsTrust === TLS_TRUST.BYPASSED) &&
    !secretsCleared &&
    !invalidated
  );
}

function updatePreflightText() {
  setText("preflight-origin", state.preflight.origin);
  setText("preflight-rp", state.preflight.rpId);
  setText("preflight-secure", String(state.preflight.secureContext));
  setText("preflight-top", String(state.preflight.topLevel));
  setText("preflight-pkc", String(state.preflight.publicKeyCredential));
  setText("preflight-caps", String(state.preflight.clientCapabilities));
  setText(
    "preflight-prf",
    state.preflight.prfCapability === null
      ? "absent"
      : String(state.preflight.prfCapability),
  );

  let message = "Ready. Provider chooser and prompts remain human-owned.";
  if (state.preflight.origin !== PROBE_ORIGIN) {
    message = `Blocked: this page is not at ${PROBE_ORIGIN}.`;
  } else if (state.preflight.secureContext !== true) {
    message = "Blocked: this is not a secure context.";
  } else if (state.preflight.topLevel !== true) {
    message = "Blocked: run this page as a top-level document.";
  } else if (state.preflight.publicKeyCredential !== true) {
    message = "Blocked: PublicKeyCredential is unavailable.";
  } else if (state.preflight.prfCapability === false) {
    message =
      "Blocked: this client reports no PRF support. Do not create credentials; record the client blocker.";
  } else if (state.preflight.tlsTrust === TLS_TRUST.UNKNOWN) {
    message = "Select the TLS trust observation before starting.";
  } else if (state.preflight.tlsTrust === TLS_TRUST.BLOCKED) {
    message = "Blocked: the browser did not accept the test TLS certificate.";
  } else if (state.preflight.tlsTrust === TLS_TRUST.BYPASSED) {
    message =
      "Ready with a TLS limitation: a certificate warning was bypassed. The export records that limit.";
  }
  setText("preflight-blocker", message);
}

function touched(id) {
  return state.cells[id].raw != null;
}

function updateButtons() {
  const canRun = preflightOk();
  setDisabled("step-r1", !canRun || touched("R1"));
  setDisabled("step-a1", !canRun || !credentials.c1 || touched("A1"));
  setDisabled("step-a2", !canRun || !outputs.a1 || touched("A2"));
  setDisabled("step-a3", !canRun || !outputs.a1 || touched("A3"));
  setDisabled("step-r2", !canRun || !credentials.c1 || touched("R2"));
  setDisabled("step-a4", !canRun || !credentials.c2 || touched("A4"));
  const canExport =
    state.preflight.origin === PROBE_ORIGIN &&
    state.preflight.secureContext === true &&
    state.preflight.topLevel === true &&
    state.preflight.publicKeyCredential === true &&
    state.preflight.tlsTrust !== TLS_TRUST.UNKNOWN;
  setDisabled("export", !canExport);
  const hasSecrets =
    credentials.c1 ||
    credentials.c2 ||
    outputs.a1 ||
    outputs.a2 ||
    outputs.a3 ||
    outputs.a4 ||
    salts.a ||
    salts.b;
  setDisabled("clear", secretsCleared || !hasSecrets);
}

function recordCell(id, raw, classification) {
  syncStateFromDom();
  const cell = state.cells[id];
  cell.raw = { ...raw, cancelled: cell.cancelObserved };
  Object.assign(cell, classification);
  renderCell(id);
  renderComparisons();
  renderAliases();
  updateButtons();
}

function reclassifyAllTouched() {
  for (const id of CELL_IDS) {
    const cell = state.cells[id];
    if (!cell.raw || cell.comparisonFailure) continue;
    const classification =
      id === "R1" || id === "R2"
        ? classifyRegistration({
            ...cell.raw,
            cancelled: cell.cancelObserved,
          })
        : classifyAssertion({
            ...cell.raw,
            cancelled: cell.cancelObserved,
          });
    Object.assign(cell, classification);
  }
}

function refresh() {
  syncStateFromDom();
  reclassifyAllTouched();
  renderAll();
  updatePreflightText();
  updateButtons();
}

function zeroizeSecrets() {
  for (const key of Object.keys(outputs)) {
    zeroize(outputs[key]);
    outputs[key] = null;
  }
  for (const slot of ["c1", "c2"]) {
    zeroize(credentials[slot]?.rawId);
    credentials[slot] = null;
  }
  zeroize(salts.a);
  zeroize(salts.b);
  salts.a = null;
  salts.b = null;
  secretsCleared = true;
}

function invalidate(message) {
  invalidated = true;
  zeroizeSecrets();
  setText("run-warning", message);
  setText(
    "clear-status",
    "Separation failure. In-memory PRF results, salts, and credential IDs were zeroized. Browser internals may retain copies until garbage collection.",
  );
}

async function readPreflight() {
  const pkc = globalThis.PublicKeyCredential;
  state.preflight.origin = location.origin;
  state.preflight.rpId = PROBE_RP_ID;
  state.preflight.secureContext = window.isSecureContext === true;
  state.preflight.topLevel = window.top === window;
  state.preflight.publicKeyCredential = typeof pkc !== "undefined";
  state.preflight.clientCapabilities =
    typeof pkc?.getClientCapabilities === "function";
  if (state.preflight.clientCapabilities) {
    try {
      const capabilities = await pkc.getClientCapabilities();
      const value = capabilities?.["extension:prf"];
      state.preflight.prfCapability = typeof value === "boolean" ? value : null;
    } catch {
      state.preflight.prfCapability = null;
    }
  }
  state.preflight.tlsTrust = selectValue("tls-trust") ?? TLS_TRUST.UNKNOWN;
}

function optionsForRegistration(alias, userHandle, challenge) {
  return {
    publicKey: {
      challenge,
      rp: { id: PROBE_RP_ID, name: "Tanikun PRF probe" },
      user: { id: userHandle, name: alias, displayName: alias },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
      attestation: "none",
      timeout: 120_000,
      extensions: { prf: {} },
    },
  };
}

function optionsForAssertion(rawId, salt, challenge) {
  return {
    publicKey: {
      challenge,
      rpId: PROBE_RP_ID,
      allowCredentials: [{ type: "public-key", id: rawId }],
      userVerification: "required",
      timeout: 120_000,
      extensions: { prf: { eval: { first: salt } } },
    },
  };
}

function readPrf(credential) {
  try {
    return {
      prf: credential.getClientExtensionResults?.()?.prf ?? null,
      error: null,
    };
  } catch (error) {
    return { prf: null, error };
  }
}

async function runRegistration(cellId, slot) {
  refresh();
  if (!preflightOk()) return;
  const alias = `PRF Spike ${slot.toUpperCase()} ${state.runId.slice(0, 8)}`;
  const userHandle = randomBytes(32);
  const challenge = randomBytes(32);
  let credential = null;
  try {
    credential = await navigator.credentials.create(
      optionsForRegistration(alias, userHandle, challenge),
    );
    aliases[slot] = alias;
    renderAliases();
    if (!credential || credential.type !== "public-key") {
      throw new TypeError("unexpected credential");
    }
    const rawId = copyRawId(credential.rawId);
    if (!rawId) throw new TypeError("missing credential id");
    const read = readPrf(credential);
    if (read.error) {
      credentials[slot] = { rawId, prfEnabled: null };
      const raw = {
        ok: false,
        errorName: safeErrorName(read.error),
        prfEnabled: null,
        resultPresent: false,
        resultLength: null,
      };
      recordCell(cellId, raw, classifyRegistration(raw));
      return;
    }
    const prf = read.prf;
    const prfEnabled = typeof prf?.enabled === "boolean" ? prf.enabled : null;
    const result = copyPrfResult(prf?.results?.first);
    const flags = readAuthenticatorFlags(
      credential.response?.getAuthenticatorData?.(),
    );
    credentials[slot] = { rawId, prfEnabled };
    const raw = {
      ok: true,
      errorName: null,
      prfEnabled,
      resultPresent: result.present,
      resultLength: result.length,
      upFlag: flags.up,
      uvFlag: flags.uv,
      beFlag: flags.be,
      bsFlag: flags.bs,
    };
    zeroize(result.bytes);
    recordCell(cellId, raw, classifyRegistration(raw));
  } catch (error) {
    const raw = {
      ok: false,
      errorName: safeErrorName(error),
      prfEnabled: null,
      resultPresent: false,
      resultLength: null,
    };
    recordCell(cellId, raw, classifyRegistration(raw));
  } finally {
    zeroize(userHandle);
    zeroize(challenge);
    credential = null;
  }
  renderAll();
  updateButtons();
}

function applyComparison(cellId, bytes) {
  const cell = state.cells[cellId];
  if (cellId === "A1") {
    if (cell.status === STATUS.SUPPORTED) {
      outputs.a1 = bytes;
      return true;
    }
    return false;
  }
  if (cellId === "A2") {
    if (
      cell.status === STATUS.SUPPORTED &&
      state.cells.A1.status === STATUS.SUPPORTED
    ) {
      const outcome = compareOutcome(outputs.a1, bytes);
      state.comparisons.sameCredentialSameInput = outcome;
      if (outcome === COMPARISON.DIFFERENT) {
        cell.status = STATUS.FAILED;
        cell.blocker = BLOCKER.REPEAT_MISMATCH;
        cell.comparisonFailure = true;
        invalidate(
          "Repeatability failed: the two salt A results differ. Stop, clean up C1 and C2, and export the failed evidence.",
        );
      }
    }
    return false;
  }
  if (cellId === "A3") {
    if (
      cell.status === STATUS.SUPPORTED &&
      state.cells.A1.status === STATUS.SUPPORTED
    ) {
      const outcome = compareOutcome(outputs.a1, bytes);
      state.comparisons.differentInput = outcome;
      if (outcome === COMPARISON.EQUAL) {
        cell.status = STATUS.FAILED;
        cell.blocker = BLOCKER.INPUT_SEPARATION_FAILED;
        cell.comparisonFailure = true;
        invalidate(
          "Input separation failed: salt A and salt B returned the same result. Stop, clean up C1 and C2, and export the failed evidence.",
        );
      }
    }
    return false;
  }
  if (cellId === "A4") {
    if (
      cell.status === STATUS.SUPPORTED &&
      state.cells.A1.status === STATUS.SUPPORTED
    ) {
      const outcome = compareOutcome(outputs.a1, bytes);
      state.comparisons.differentCredential = outcome;
      if (outcome === COMPARISON.EQUAL) {
        cell.status = STATUS.FAILED;
        cell.blocker = BLOCKER.CREDENTIAL_SEPARATION_FAILED;
        cell.comparisonFailure = true;
        invalidate(
          "Credential separation failed: C1 and C2 returned the same result for salt A. Stop, clean up C1 and C2, and export the failed evidence.",
        );
      }
    }
    return false;
  }
  return false;
}

async function runAssertion(cellId, slot, salt) {
  refresh();
  if (!preflightOk()) return;
  const credential = credentials[slot];
  if (!credential || !salt) return;
  const challenge = randomBytes(32);
  let result = null;
  let keepResult = false;
  try {
    const assertion = await navigator.credentials.get(
      optionsForAssertion(credential.rawId, salt, challenge),
    );
    if (!assertion || assertion.type !== "public-key") {
      throw new TypeError("unexpected credential");
    }
    const returnedRawId = copyRawId(assertion.rawId);
    const matches =
      returnedRawId !== null && compareBytes(returnedRawId, credential.rawId);
    zeroize(returnedRawId);
    if (!matches) throw new TypeError("unexpected credential");
    const flags = readAuthenticatorFlags(assertion.response?.authenticatorData);
    const read = readPrf(assertion);
    if (read.error) throw read.error;
    const prf = read.prf;
    result = copyPrfResult(prf?.results?.first);
    const raw = {
      ok: true,
      errorName: null,
      prfEnabledAtRegistration: credential.prfEnabled,
      clientCapability: state.preflight.prfCapability,
      resultPresent: result.present,
      resultLength: result.length,
      upFlag: flags.up,
      uvFlag: flags.uv,
      beFlag: flags.be,
      bsFlag: flags.bs,
    };
    recordCell(cellId, raw, classifyAssertion(raw));
    keepResult = applyComparison(cellId, result.bytes);
    if (cellId === "A4") {
      zeroizeSecrets();
      if (!invalidated) {
        setText(
          "clear-status",
          "Final assertion complete. In-memory PRF results, salts, and credential IDs were zeroized. Browser internals may retain copies until garbage collection.",
        );
      }
    }
  } catch (error) {
    const raw = {
      ok: false,
      errorName: safeErrorName(error),
      prfEnabledAtRegistration: credential.prfEnabled,
      clientCapability: state.preflight.prfCapability,
      resultPresent: false,
      resultLength: null,
      upFlag: null,
      uvFlag: null,
      beFlag: null,
      bsFlag: null,
    };
    recordCell(cellId, raw, classifyAssertion(raw));
    if (cellId === "A4") zeroizeSecrets();
  } finally {
    zeroize(challenge);
    if (!keepResult) zeroize(result?.bytes);
    result = null;
  }
  renderAll();
  updatePreflightText();
  updateButtons();
}

function recordCleanup() {
  syncStateFromDom();
  if (state.cleanup.status === CLEANUP_STATUS.PENDING) {
    setText(
      "cleanup-message",
      "Select complete or blocked before recording cleanup.",
    );
    return;
  }
  if (
    state.cleanup.status === CLEANUP_STATUS.COMPLETE &&
    !(
      state.cleanup.c1Deleted &&
      state.cleanup.c2Deleted &&
      state.cleanup.chooserAbsent
    )
  ) {
    setText(
      "cleanup-message",
      "Cleanup is not complete: confirm C1 deletion, C2 deletion, and chooser absence.",
    );
    return;
  }
  if (
    state.cleanup.status === CLEANUP_STATUS.BLOCKED &&
    state.cleanup.blocker === null
  ) {
    setText("cleanup-message", "Select a cleanup blocker.");
    return;
  }
  if (
    state.cleanup.status === CLEANUP_STATUS.COMPLETE &&
    state.cleanup.blocker !== null
  ) {
    setText(
      "cleanup-message",
      "Clear the cleanup blocker before recording a complete cleanup.",
    );
    return;
  }
  setText("cleanup-message", `Cleanup recorded as ${state.cleanup.status}.`);
}

function downloadExport() {
  refresh();
  try {
    const data = buildExport(state);
    const text = JSON.stringify(data, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tanikun-prf-${state.runId}.json`;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setText(
      "export-status",
      "Safe JSON downloaded. The export contains status, booleans, exact version and provider labels, and no PRF bytes.",
    );
  } catch {
    setText(
      "export-status",
      "Export blocked. Complete the required origin, TLS trust, provider, and cleanup fields. Do not add PRF data manually.",
    );
  }
}

function clearSecrets() {
  zeroizeSecrets();
  setText(
    "clear-status",
    "In-memory PRF results, salts, and credential IDs were zeroized. Browser internals may retain copies until garbage collection; this is not a secure-erase claim.",
  );
  refresh();
}

function wireEvents() {
  document.addEventListener("input", refresh);
  document.addEventListener("change", refresh);
  element("step-r1")?.addEventListener("click", () =>
    runRegistration("R1", "c1"),
  );
  element("step-a1")?.addEventListener("click", () =>
    runAssertion("A1", "c1", salts.a),
  );
  element("step-a2")?.addEventListener("click", () =>
    runAssertion("A2", "c1", salts.a),
  );
  element("step-a3")?.addEventListener("click", () =>
    runAssertion("A3", "c1", salts.b),
  );
  element("step-r2")?.addEventListener("click", () =>
    runRegistration("R2", "c2"),
  );
  element("step-a4")?.addEventListener("click", () =>
    runAssertion("A4", "c2", salts.a),
  );
  element("cleanup-record")?.addEventListener("click", recordCleanup);
  element("export")?.addEventListener("click", downloadExport);
  element("clear")?.addEventListener("click", clearSecrets);
  window.addEventListener(
    "pagehide",
    () => {
      zeroizeSecrets();
    },
    { once: true },
  );
}

async function init() {
  state.runId = crypto.randomUUID();
  salts.a = randomBytes(32);
  salts.b = randomBytes(32);
  const runId = element("run-id");
  if (runId) runId.value = state.runId;
  await readPreflight();
  refresh();
}

wireEvents();
init().catch(() => {
  setText(
    "preflight-blocker",
    "Preflight failed. Do not start a ceremony. Reload and record the blocker.",
  );
  updateButtons();
});
