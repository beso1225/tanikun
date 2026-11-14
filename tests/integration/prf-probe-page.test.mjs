/*
 * Synthetic privacy and origin test for the isolated PRF probe page.
 *
 * This test stubs navigator.credentials and injects synthetic PRF canaries. It
 * does not create a real passkey, contact a provider, or prove physical PRF
 * support. Chromium ignores the disposable certificate only inside this test
 * context; that does not establish normal-browser TLS trust.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { startPrfProbeServer } from "../../tools/prf-probe/server.mjs";

const playwrightCore = process.env.PLAYWRIGHT_CORE;
assert.ok(
  playwrightCore,
  "run this test in `nix develop` so PLAYWRIGHT_CORE is set",
);
const { chromium } = await import(
  pathToFileURL(join(playwrightCore, "index.mjs")).href
);

const CANARY_A1 = "TANIKUN-PRF-CANARY-A1-";
const CANARY_A3 = "TANIKUN-PRF-CANARY-A3-";
const CANARY_C2 = "TANIKUN-PRF-CANARY-C2-";

test(
  "probe page keeps synthetic PRF canaries out of DOM, logs, storage, network, and export",
  { timeout: 120_000 },
  async () => {
    const logs = [];
    const harness = await startPrfProbeServer({
      log: (line) => logs.push(line),
    });
    const browser = await chromium.launch();
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const consoleMessages = [];
    const pageErrors = [];
    const requests = [];
    page.on("console", (message) => {
      consoleMessages.push({ type: message.type(), text: message.text() });
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      requests.push({ method: request.method(), url: request.url() });
    });

    try {
      await page.addInitScript(
        ({ a1, a3, c2 }) => {
          const c1RawId = Uint8Array.from(
            { length: 16 },
            (_, index) => index + 1,
          );
          const c2RawId = Uint8Array.from(
            { length: 16 },
            (_, index) => 0x80 + index,
          );
          const checks = {
            createCount: 0,
            getCount: 0,
            createPrf: false,
            createResident: false,
            createUv: false,
            createAttestation: false,
            createAlg: false,
            rpId: false,
            a1a2SaltSame: false,
            a3SaltDifferent: false,
            a4SaltSame: false,
            challengesUnique: true,
            allowC1: true,
            allowC2: true,
          };
          let firstSalt = null;
          let previousChallenge = null;

          // oxlint-disable-next-line unicorn/consistent-function-scoping
          function prfBytes(prefix) {
            const bytes = new Uint8Array(32);
            for (let index = 0; index < 32; index += 1) {
              bytes[index] =
                index < prefix.length
                  ? prefix.charCodeAt(index)
                  : 0x41 + (index % 26);
            }
            return bytes;
          }

          // oxlint-disable-next-line unicorn/consistent-function-scoping
          function equal(left, right) {
            if (left.byteLength !== right.byteLength) return false;
            let difference = 0;
            for (let index = 0; index < left.byteLength; index += 1) {
              difference |= left[index] ^ right[index];
            }
            return difference === 0;
          }

          // oxlint-disable-next-line unicorn/consistent-function-scoping
          function flags(value) {
            const bytes = new Uint8Array(37);
            bytes[32] = value;
            return bytes;
          }

          async function create(options) {
            checks.createCount += 1;
            const publicKey = options.publicKey;
            checks.createPrf ||= Boolean(publicKey.extensions?.prf);
            checks.createResident ||=
              publicKey.authenticatorSelection?.residentKey === "required" &&
              publicKey.authenticatorSelection?.requireResidentKey === true;
            checks.createUv ||=
              publicKey.authenticatorSelection?.userVerification === "required";
            checks.createAttestation ||= publicKey.attestation === "none";
            checks.createAlg ||=
              publicKey.pubKeyCredParams?.length === 1 &&
              publicKey.pubKeyCredParams[0]?.type === "public-key" &&
              publicKey.pubKeyCredParams[0]?.alg === -7;
            checks.rpId ||= publicKey.rp?.id === "localhost";
            const rawId = (
              checks.createCount === 1 ? c1RawId : c2RawId
            ).slice();
            return {
              type: "public-key",
              rawId: rawId.buffer,
              getClientExtensionResults: () => ({ prf: { enabled: true } }),
              response: {
                getAuthenticatorData: () => flags(0x45).buffer,
              },
            };
          }

          async function get(options) {
            checks.getCount += 1;
            const publicKey = options.publicKey;
            const allow = publicKey.allowCredentials?.[0]?.id;
            const allowBytes =
              allow instanceof ArrayBuffer
                ? new Uint8Array(allow)
                : new Uint8Array(
                    allow.buffer,
                    allow.byteOffset,
                    allow.byteLength,
                  );
            if (checks.getCount <= 3) {
              checks.allowC1 &&= equal(allowBytes, c1RawId);
            } else {
              checks.allowC2 &&= equal(allowBytes, c2RawId);
            }
            const salt = new Uint8Array(
              publicKey.extensions.prf.eval.first,
            ).slice();
            if (checks.getCount === 1) firstSalt = salt;
            if (checks.getCount === 2) {
              checks.a1a2SaltSame = equal(salt, firstSalt);
            }
            if (checks.getCount === 3) {
              checks.a3SaltDifferent = !equal(salt, firstSalt);
            }
            if (checks.getCount === 4) {
              checks.a4SaltSame = equal(salt, firstSalt);
            }
            const challenge = new Uint8Array(publicKey.challenge).slice();
            if (previousChallenge && equal(challenge, previousChallenge)) {
              checks.challengesUnique = false;
            }
            previousChallenge = challenge;
            const canary = [null, a1, a1, a3, c2][checks.getCount];
            const output = prfBytes(canary);
            const rawId = (checks.getCount <= 3 ? c1RawId : c2RawId).slice();
            return {
              type: "public-key",
              rawId: rawId.buffer,
              getClientExtensionResults: () => ({
                prf: { results: { first: output.buffer } },
              }),
              response: {
                authenticatorData: flags(0x05).buffer,
              },
            };
          }

          const stub = { create, get };
          try {
            Object.defineProperty(navigator, "credentials", {
              configurable: true,
              value: stub,
            });
          } catch {
            Object.defineProperty(
              Object.getPrototypeOf(navigator),
              "credentials",
              {
                configurable: true,
                get: () => stub,
              },
            );
          }

          const pkc = globalThis.PublicKeyCredential;
          if (pkc) {
            // oxlint-disable-next-line unicorn/consistent-function-scoping
            const getClientCapabilities = async () => ({
              "extension:prf": true,
            });
            try {
              Object.defineProperty(pkc, "getClientCapabilities", {
                configurable: true,
                value: getClientCapabilities,
              });
            } catch {
              pkc.getClientCapabilities = getClientCapabilities;
            }
          } else {
            Object.defineProperty(globalThis, "PublicKeyCredential", {
              configurable: true,
              value: {
                getClientCapabilities: async () => ({
                  "extension:prf": true,
                }),
              },
            });
          }

          globalThis.tanikunPrfTest = { checks };
        },
        { a1: CANARY_A1, a3: CANARY_A3, c2: CANARY_C2 },
      );

      const response = await page.goto("https://localhost:4300/", {
        waitUntil: "load",
      });
      assert.equal(response?.status(), 200);
      await page.waitForFunction(
        () => document.querySelector("#preflight-pkc")?.textContent === "true",
      );
      await page.selectOption("#tls-trust", "bypassed");
      await page.waitForFunction(() =>
        document
          .querySelector("#preflight-blocker")
          ?.textContent?.includes("Ready with a TLS limitation"),
      );

      await page.fill("#harness-commit", "b".repeat(40));
      await page.selectOption("#device-role", "mac");
      await page.fill("#device-model", "Mac15,12");
      await page.fill("#os", "macOS 27.2.1");
      await page.fill("#os-build", "26B131");
      await page.selectOption("#browser", "chrome");
      await page.fill("#browser-version", "157.0.8103.51");
      await page.fill("#p1-label", "Test Provider");
      await page.fill("#p1-app", "1.0");
      await page.fill("#p1-ext", "1.0");
      for (const id of ["R1", "A1", "A2", "A3", "R2", "A4"]) {
        await page.selectOption(`#provider-${id}`, "P1");
        await page.selectOption(`#transport-${id}`, "platform");
        await page.selectOption(`#upobs-${id}`, "yes");
        await page.selectOption(`#uvobs-${id}`, "yes");
      }

      async function step(id) {
        await page.click(`#step-${id.toLowerCase()}`);
        await page.waitForFunction(
          (cell) =>
            document.querySelector(`#status-${cell}`)?.textContent !==
            "untested",
          id,
        );
      }

      await step("R1");
      await step("A1");
      await step("A2");
      await step("A3");
      await step("R2");
      await step("A4");

      for (const id of ["R1", "A1", "A2", "A3", "R2", "A4"]) {
        assert.equal(
          await page.locator(`#status-${id}`).innerText(),
          "supported",
          `${id} should be supported in the synthetic run`,
        );
      }
      assert.equal(await page.locator("#cmp-same-input").innerText(), "equal");
      assert.equal(
        await page.locator("#cmp-different-input").innerText(),
        "different",
      );
      assert.equal(
        await page.locator("#cmp-different-credential").innerText(),
        "different",
      );
      assert.equal(await page.locator("#length-A1").innerText(), "32");
      assert.equal(await page.locator("#upflag-A1").innerText(), "true");
      assert.equal(await page.locator("#uvflag-A1").innerText(), "true");
      assert.equal(
        await page.locator("#preflight-origin").innerText(),
        "https://localhost:4300",
      );
      assert.equal(await page.locator("#preflight-prf").innerText(), "true");
      assert.match(
        await page.locator("#alias-c1").innerText(),
        /PRF Spike C1/u,
      );
      assert.match(
        await page.locator("#alias-c2").innerText(),
        /PRF Spike C2/u,
      );

      const checks = await page.evaluate(
        () => globalThis.tanikunPrfTest.checks,
      );
      assert.equal(checks.createCount, 2);
      assert.equal(checks.getCount, 4);
      assert.equal(checks.createPrf, true);
      assert.equal(checks.createResident, true);
      assert.equal(checks.createUv, true);
      assert.equal(checks.createAttestation, true);
      assert.equal(checks.createAlg, true);
      assert.equal(checks.rpId, true);
      assert.equal(checks.a1a2SaltSame, true);
      assert.equal(checks.a3SaltDifferent, true);
      assert.equal(checks.a4SaltSame, true);
      assert.equal(checks.challengesUnique, true);
      assert.equal(checks.allowC1, true);
      assert.equal(checks.allowC2, true);

      await page.check("#cleanup-c1");
      await page.check("#cleanup-c2");
      await page.check("#cleanup-chooser");
      await page.selectOption("#cleanup-status", "complete");
      await page.click("#cleanup-record");
      assert.match(
        await page.locator("#cleanup-message").innerText(),
        /Cleanup recorded as complete/u,
      );
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.click("#export"),
      ]);
      const downloadPath = await download.path();
      assert.ok(downloadPath, "the safe export should produce a file");
      const exportText = await readFile(downloadPath, "utf8");
      const exported = JSON.parse(exportText);
      assert.equal(exported.schema, "tanikun-prf-probe-export-v1");
      assert.equal(exported.recommendation, "pending_human");
      assert.equal(exported.preflight.tls_trust, "bypassed");
      assert.deepEqual(exported.limitations, ["tls_trust_bypassed"]);
      assert.equal(exported.cells.length, 6);
      for (const id of ["R1", "R2"]) {
        const registration = exported.cells.find((cell) => cell.id === id);
        assert.deepEqual(
          [
            registration.up_flag,
            registration.uv_flag,
            registration.be_flag,
            registration.bs_flag,
          ],
          [true, true, false, false],
        );
        for (const [flag, expected] of [
          ["up", "true"],
          ["uv", "true"],
          ["be", "false"],
          ["bs", "false"],
        ])
          assert.equal(
            await page.locator(`#${flag}flag-${id}`).innerText(),
            expected,
          );
      }

      assert.equal(
        exported.cells.every((cell) => cell.status === "supported"),
        true,
      );
      assert.deepEqual(exported.comparisons, {
        same_credential_same_input: "equal",
        different_input: "different",
        different_credential: "different",
      });
      assert.deepEqual(exported.cleanup, {
        c1_absent_confirmed: true,
        c2_absent_confirmed: true,
        chooser_absent: true,
        status: "complete",
        blocker: null,
      });
      assert.equal(exported.providers[0].label, "Test Provider");
      assert.equal(exported.environment.device_model, "Mac15,12");
      for (const canary of [CANARY_A1, CANARY_A3, CANARY_C2]) {
        assert.equal(
          exportText.includes(canary),
          false,
          "the export must not contain a PRF canary",
        );
      }
      for (const forbidden of [
        "result_bytes",
        "credential_id",
        "challenge",
        "clientExtensionResults",
        "rawId",
        "attestationObject",
        "signature",
      ]) {
        assert.equal(
          exportText.includes(forbidden),
          false,
          `the export must not contain ${forbidden}`,
        );
      }

      const dom = await page.evaluate(() => document.documentElement.outerHTML);
      const body = await page.evaluate(() => document.body.innerText);
      for (const canary of [CANARY_A1, CANARY_A3, CANARY_C2]) {
        assert.equal(dom.includes(canary), false);
        assert.equal(body.includes(canary), false);
      }
      for (const message of consoleMessages) {
        for (const canary of [CANARY_A1, CANARY_A3, CANARY_C2]) {
          assert.equal(
            message.text.includes(canary),
            false,
            "console output must not contain a PRF canary",
          );
        }
      }
      assert.deepEqual(pageErrors, []);
      assert.equal(
        consoleMessages.filter((message) => message.type === "error").length,
        0,
      );

      const storage = await page.evaluate(async () => {
        const databases =
          typeof indexedDB.databases === "function"
            ? (await indexedDB.databases()).map((database) => database.name)
            : [];
        return {
          local: Object.keys(localStorage),
          session: Object.keys(sessionStorage),
          databases,
          cookie: document.cookie,
          name: window.name,
          url: location.href,
        };
      });
      assert.deepEqual(storage.local, []);
      assert.deepEqual(storage.session, []);
      assert.deepEqual(storage.databases, []);
      assert.equal(storage.cookie, "");
      assert.equal(storage.name, "");
      assert.equal(storage.url.includes("TANIKUN-PRF-CANARY"), false);
      for (const canary of [CANARY_A1, CANARY_A3, CANARY_C2]) {
        assert.equal(JSON.stringify(storage).includes(canary), false);
      }

      assert.equal(
        requests.every(
          (request) =>
            request.method === "GET" &&
            request.url.startsWith("https://localhost:4300/"),
        ),
        true,
        "the probe page must not make a non-GET or external request",
      );
      assert.equal(
        requests.some((request) => request.url.endsWith("/probe.js")),
        true,
      );
      assert.equal(
        requests.some((request) => request.url.endsWith("/probe-core.mjs")),
        true,
      );
      for (const line of logs) {
        for (const canary of [CANARY_A1, CANARY_A3, CANARY_C2]) {
          assert.equal(line.includes(canary), false);
        }
      }
    } finally {
      await browser.close();
      await harness.close();
    }
  },
);

for (const phase of ["registration", "assertion"]) {
  test(`clearing a pending ${phase} aborts it and rejects its late result`, async (t) => {
    const harness = await startPrfProbeServer({ log() {} });
    t.after(() => harness.close());
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.addInitScript((pendingPhase) => {
      const pending = {
        calls: 0,
        signal: null,
        finish: null,
        rawId: new Uint8Array(16).fill(7),
        output: new Uint8Array(32).fill(8),
      };
      Object.defineProperty(navigator, "credentials", {
        configurable: true,
        value: {
          create: (options) => {
            if (pendingPhase === "assertion")
              return Promise.resolve({
                type: "public-key",
                rawId: new Uint8Array(16).fill(7).buffer,
                getClientExtensionResults: () => ({ prf: { enabled: true } }),
                response: {
                  getAuthenticatorData: () => new Uint8Array(37).buffer,
                },
              });
            return waitForResult(options);
          },
          get: waitForResult,
        },
      });
      function waitForResult(options) {
        pending.calls += 1;
        pending.signal = options.signal;
        return new Promise((resolvePending) => {
          pending.finish = () =>
            resolvePending({
              type: "public-key",
              rawId: pending.rawId.buffer,
              getClientExtensionResults: () => ({
                prf: {
                  enabled: true,
                  results: { first: pending.output.buffer },
                },
              }),
              response: {
                getAuthenticatorData: () => new Uint8Array(37).buffer,
              },
            });
        });
      }
      Object.defineProperty(PublicKeyCredential, "getClientCapabilities", {
        configurable: true,
        value: async () => ({ "extension:prf": true }),
      });
      globalThis.pendingProbeTest = pending;
    }, phase);
    await page.goto(harness.origin);
    await page.selectOption("#tls-trust", "bypassed");
    await page.click("#step-r1");
    if (phase === "assertion") {
      await page.waitForFunction(
        () => document.querySelector("#status-R1").textContent === "supported",
      );
      await page.click("#step-a1");
    }
    await page.waitForFunction(() => globalThis.pendingProbeTest.calls === 1);
    const pendingStep = phase === "registration" ? "#step-r1" : "#step-a1";
    const pendingStatus =
      phase === "registration" ? "#status-R1" : "#status-A1";
    assert.equal(await page.locator(pendingStep).isDisabled(), true);
    await page.click("#clear");
    assert.equal(
      await page.evaluate(() => globalThis.pendingProbeTest.signal?.aborted),
      true,
    );
    await page.evaluate(() => globalThis.pendingProbeTest.finish());
    await page.waitForFunction(
      () => document.querySelector("#step-r1").disabled,
    );
    await page.waitForFunction(() =>
      globalThis.pendingProbeTest.output.every((value) => value === 0),
    );
    assert.equal(
      await page.evaluate(() =>
        globalThis.pendingProbeTest.rawId.every((value) => value === 0),
      ),
      true,
    );
    assert.equal(await page.locator(pendingStatus).innerText(), "untested");
    assert.equal(
      await page.evaluate(() => globalThis.pendingProbeTest.calls),
      1,
    );
  });
}

for (const scenario of ["cleanup", "cancelled"]) {
  test(`probe observations remain coherent after ${scenario}`, async (t) => {
    const harness = await startPrfProbeServer({ log() {} });
    t.after(() => harness.close());
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.addInitScript((mode) => {
      globalThis.probeCreateCalls = 0;
      Object.defineProperty(navigator, "credentials", {
        configurable: true,
        value: {
          create: async () => {
            globalThis.probeCreateCalls += 1;
            if (mode === "cancelled")
              throw new DOMException(
                "synthetic cancellation",
                "NotAllowedError",
              );
            const data = new Uint8Array(37);
            data[32] = 0x45;
            return {
              type: "public-key",
              rawId: new Uint8Array(16).fill(1).buffer,
              getClientExtensionResults: () => ({ prf: { enabled: true } }),
              response: { getAuthenticatorData: () => data.buffer },
            };
          },
        },
      });
      Object.defineProperty(PublicKeyCredential, "getClientCapabilities", {
        configurable: true,
        value: async () => ({ "extension:prf": true }),
      });
    }, scenario);
    await page.goto(harness.origin);
    await page.selectOption("#tls-trust", "bypassed");
    if (scenario === "cancelled") await page.check("#cancel-R1");
    await page.click("#step-r1");
    await page.waitForFunction(
      () => document.querySelector("#status-R1").textContent !== "untested",
    );
    if (scenario === "cancelled") {
      assert.equal(await page.locator("#status-R1").innerText(), "denied");
      return;
    }
    assert.equal(await page.locator("#step-r2").isDisabled(), false);
    await page.selectOption("#cleanup-status", "blocked");
    await page.selectOption("#cleanup-blocker", "cleanup_blocked");
    await page.click("#cleanup-record");
    assert.equal(await page.locator("#step-r2").isDisabled(), true);
    assert.equal(await page.locator("#step-a1").isDisabled(), true);
    await page.selectOption("#cleanup-status", "pending");
    assert.equal(await page.locator("#step-r2").isDisabled(), true);
    await page.evaluate(() => document.querySelector("#step-r2").click());
    assert.equal(await page.evaluate(() => globalThis.probeCreateCalls), 1);
  });
}
