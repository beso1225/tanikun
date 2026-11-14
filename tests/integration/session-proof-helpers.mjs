/**
 * Shared helpers for the #185 real-session proof.
 *
 * These helpers drive the built page, the production Worker/WebAuthn verifier,
 * and Chromium's virtual authenticator. They never inject an identity or bypass
 * a signature. The account, planner, passkey, and TLS material are synthetic.
 */

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";

import { waitForPersistence } from "./planner-harness.mjs";
import {
  pathExists,
  processGroupExists,
  readTraceArchiveEntries,
} from "./sync-harness.mjs";

export const AUTH_ORIGIN = "https://localhost:4300";
export const SESSION_COOKIE = "__Host-tanikun_session";
export const BINDING_COOKIE = "__Host-tanikun_binding";

export async function waitForSyncText(page, text, timeout = 60_000) {
  await page.waitForFunction(
    (expected) =>
      document.querySelector("#sync-status-text")?.textContent === expected,
    text,
    { timeout },
  );
}

export async function waitSynced(page, timeout = 60_000) {
  await waitForSyncText(page, "同期済み", timeout);
}

export async function openAccount(page) {
  const width = page.viewportSize()?.width ?? 1280;
  const button =
    width < 768
      ? page.locator("#account-button-mobile")
      : page.locator("#account-button");
  await button.click();
  await page.locator("#auth-dialog").waitFor({ state: "visible" });
}

export async function closeAccount(page) {
  if (
    !(await page
      .locator("#auth-dialog")
      .isVisible()
      .catch(() => false))
  )
    return;
  await page.locator("#auth-close").click();
  await page.locator("#auth-dialog").waitFor({ state: "detached" });
}

async function clickAndReload(page, selector) {
  const navigation = page.waitForNavigation({
    waitUntil: "load",
    timeout: 60_000,
  });
  await page.locator(selector).click();
  await navigation;
  await waitForPersistence(page);
}

export async function registerForCopy(page, name) {
  await openAccount(page);
  await page.locator('[data-action="register-start"]').click();
  await page.locator("#auth-display-name").fill(name);
  await page.locator('[data-action="register-submit"]').click();
  await page
    .locator('[data-action="copy-plan"]')
    .waitFor({ state: "visible", timeout: 60_000 });
}

export async function copyAndConsent(page) {
  await clickAndReload(page, '[data-action="copy-plan"]');
  await openAccount(page);
  await page
    .locator('[data-action="consent-upload"]')
    .waitFor({ state: "visible", timeout: 60_000 });
  await page.locator('[data-action="consent-upload"]').click();
  await waitSynced(page);
}

export async function registerAndSync(page, name) {
  await registerForCopy(page, name);
  await copyAndConsent(page);
}

export async function declineCopyAndSync(page, name) {
  await registerForCopy(page, name);
  await clickAndReload(page, '[data-action="decline-copy"]');
  await waitSynced(page);
}

export async function signOut(page) {
  await openAccount(page);
  await clickAndReload(page, '[data-action="logout"]');
}

export async function signIn(page) {
  await openAccount(page);
  await clickAndReload(page, '[data-action="sign-in"]');
}

/** Sign in on a browser with no account plan and decline copying the unbound one. */
export async function signInNewReplica(page) {
  await openAccount(page);
  await page.locator('[data-action="sign-in"]').click();
  await page
    .locator('[data-action="decline-copy"]')
    .waitFor({ state: "visible", timeout: 60_000 });
  await clickAndReload(page, '[data-action="decline-copy"]');
}

/** Discard a fresh replica's seeded local root, then adopt the server history. */
export async function resetReplicaToServer(page) {
  await page.evaluate(() => {
    globalThis.tanikunSyncShell.pauseForAuthChange();
  });
  await page.evaluate(() => globalThis.tanikunStorage.discard());
  await page.evaluate(() => globalThis.tanikunSyncShell.sync());
  await waitSynced(page);
}

export async function readAuthState(page) {
  return page.evaluate(async () => {
    try {
      return await globalThis.tanikunAuthState.read();
    } catch {
      return null;
    }
  });
}

export async function waitForAuthState(page, sessionState, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await readAuthState(page);
    if (state?.sessionState === sessionState) return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`auth state did not become ${sessionState}`);
}

export async function activeSession(page) {
  const state = await waitForAuthState(page, "active");
  const csrfToken = await page.evaluate(
    () => globalThis.tanikunAuthController.sessionClient.csrfToken,
  );
  assert.match(state.accountHandle, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(csrfToken, /^[A-Za-z0-9_-]{43}$/u);
  return { ...state, csrfToken };
}

export function cookieNamed(cookies, name) {
  return cookies.find((cookie) => cookie.name === name) ?? null;
}

export async function sessionCookies(context) {
  const cookies = await context.cookies();
  return {
    cookies,
    session: cookieNamed(cookies, SESSION_COOKIE),
    binding: cookieNamed(cookies, BINDING_COOKIE),
  };
}

export async function assertSessionCookieFlags(context) {
  const { session, binding } = await sessionCookies(context);
  assert.ok(session, "the browser cookie jar has the session cookie");
  assert.equal(session.httpOnly, true);
  assert.equal(session.secure, true);
  assert.equal(session.sameSite, "Lax");
  assert.equal(session.domain, "localhost");
  assert.equal(session.path, "/");
  assert.equal(session.expires, -1, "the session cookie is host-session only");
  assert.ok(binding, "the browser cookie jar has the binding cookie");
  assert.equal(binding.httpOnly, true);
  assert.equal(binding.secure, true);
  assert.equal(binding.sameSite, "Lax");
  assert.equal(binding.domain, "localhost");
  assert.equal(binding.path, "/");
  assert.ok(
    binding.expires > Date.now() / 1_000 + 80_000,
    "the binding cookie keeps its one-day lifetime",
  );
  assert.ok(binding.expires <= Date.now() / 1_000 + 86_400);
  return { session, binding };
}

export async function restoreCookie(context, cookie) {
  assert.ok(cookie);
  await context.addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      expires: cookie.expires,
    },
  ]);
}

export async function postJsonFromPage(
  page,
  path,
  { method = "POST", csrfToken, body } = {},
) {
  return page.evaluate(
    async ({
      method: requestMethod,
      path: requestPath,
      csrfToken: requestCsrf,
      body: requestBody,
    }) => {
      const headers = {};
      if (requestBody !== undefined)
        headers["Content-Type"] = "application/json";
      if (requestCsrf !== undefined) headers["X-CSRF-Token"] = requestCsrf;
      const response = await fetch(requestPath, {
        method: requestMethod,
        credentials: "same-origin",
        headers,
        ...(requestBody === undefined
          ? {}
          : { body: JSON.stringify(requestBody) }),
      });
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        // Error bodies are asserted as status plus the parsed shape when JSON.
      }
      return { status: response.status, text, json };
    },
    { method, path, csrfToken, body },
  );
}

/** Capture one request body in memory without writing it to evidence. */
export async function captureNextRequest(page, glob, beforeContinue) {
  let captured = null;
  const handler = async (route) => {
    if (!captured) {
      const request = route.request();
      captured = {
        url: request.url(),
        headers: request.headers(),
        body: request.postData(),
      };
      await beforeContinue?.(captured);
    }
    await route.continue();
  };
  await page.route(glob, handler);
  return {
    get() {
      return captured;
    },
    async stop() {
      await page.unroute(glob, handler);
    },
  };
}

/**
 * Send a cookie-aware request from the Chromium browser context. Page fetch
 * cannot override the forbidden Origin header, so an exact cross-origin Origin
 * fault uses the context's own cookie jar and TLS settings instead. No cookie
 * or credential is copied by the test.
 */
export async function postFromBrowserContext(
  context,
  path,
  { method = "POST", origin, csrfToken, body } = {},
) {
  const headers = { Origin: origin ?? AUTH_ORIGIN, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrfToken !== undefined) headers["X-CSRF-Token"] = csrfToken;
  const response = await context.request.fetch(
    new URL(path, AUTH_ORIGIN).href,
    {
      method,
      headers,
      ...(body === undefined ? {} : { data: JSON.stringify(body) }),
    },
  );
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Error bodies are asserted as status plus the parsed shape when JSON.
  }
  return { status: response.status(), text, json };
}

export async function d1Counts(harness) {
  const [row] = await harness.d1Query(
    `SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM credentials) AS credentials,
      (SELECT COUNT(*) FROM sessions) AS sessions,
      (SELECT COUNT(*) FROM challenges) AS challenges,
      (SELECT COUNT(*) FROM documents) AS documents,
      (SELECT COUNT(*) FROM changes) AS changes,
      (SELECT COALESCE(SUM(last_seq), 0) FROM documents) AS sequences`,
  );
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value)]),
  );
}

function evidenceFiles(directory, prefix = "") {
  return readdir(directory, { withFileTypes: true }).then((entries) =>
    Promise.all(
      entries.map(async (entry) => {
        const name = prefix + entry.name;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return evidenceFiles(path, `${name}/`);
        return [{ name, path }];
      }),
    ).then((groups) => groups.flat()),
  );
}

/**
 * Assert the retained evidence directory, including sanitized traces, contains
 * no raw secret or planner value. Raw Playwright traces never survive.
 */
export async function assertEvidenceSanitized(harness, forbidden) {
  assert.ok(harness.evidenceDir);
  const values = forbidden.filter(
    (value) => typeof value === "string" && value.length > 0,
  );
  assert.ok(values.length > 0, "evidence checks need at least one value");
  const files = await evidenceFiles(harness.evidenceDir);
  assert.ok(files.length > 0, "the run retained evidence files");
  for (const file of files) {
    assert.equal(
      file.name.startsWith("raw-"),
      false,
      `raw trace survived in evidence: ${file.name}`,
    );
    if (file.name.endsWith(".zip")) {
      assert.match(
        file.name,
        /-(?:trace|failure-trace)\.zip$/u,
        `unexpected zip in evidence: ${file.name}`,
      );
      const entries = await readTraceArchiveEntries(file.path);
      assert.deepEqual(
        [...entries.keys()].toSorted(),
        ["trace.network", "trace.trace"].filter((name) => entries.has(name)),
      );
      for (const [entryName, bytes] of entries) {
        for (const value of values) {
          assert.equal(
            bytes.includes(Buffer.from(value)),
            false,
            `${file.name}:${entryName} retained a forbidden value`,
          );
        }
      }
      continue;
    }
    const buffer = await readFile(file.path);
    for (const value of values) {
      assert.equal(
        buffer.includes(Buffer.from(value)),
        false,
        `${file.name} retained a forbidden value`,
      );
    }
  }
}

export function assertPortClosed(port = 4300, host = "127.0.0.1") {
  return new Promise((resolvePromise, reject) => {
    const socket = connect({ port, host });
    socket.once("connect", () => {
      socket.destroy();
      reject(new Error(`${host}:${port} still has a listener`));
    });
    socket.once("error", (error) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolvePromise();
      else reject(error);
    });
  });
}

export async function assertHarnessCleaned(harness, port = 4300) {
  const { wranglerPid, tempDir, evidenceDir } = harness;
  assert.equal(harness.activeContexts, 0);
  assert.equal(harness.server, null);
  assert.equal(harness.wrangler, null);
  assert.equal(processGroupExists(wranglerPid), false);
  assert.equal(await pathExists(tempDir), false, "temporary storage is gone");
  const cleanup = JSON.parse(
    await readFile(join(evidenceDir, "cleanup.log"), "utf8"),
  );
  assert.equal(cleanup.processGroupAlive, false);
  assert.deepEqual(cleanup.problems, []);
  await assertPortClosed(port);
}
