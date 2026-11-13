// Static-page regression for the authenticated passkey management surface.
// This uses Playwright route mocks and a stubbed native credential object; it
// does not run the real Worker, D1, verifier, or a virtual authenticator. The
// real HTTPS ceremony journey is session-credential-journey.test.mjs.

import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { startStaticServer, waitForPersistence } from "./planner-harness.mjs";

const core = process.env.PLAYWRIGHT_CORE;
assert.ok(core, "run inside nix develop");
const dist = resolve(process.env.TANIKUN_WEB_DIST ?? "apps/web/dist");
const { chromium: browserType } = await import(
  pathToFileURL(join(core, "index.mjs")).href
);

const HANDLE = Buffer.alloc(32, 4).toString("base64url");
const CSRF = "C".repeat(43);
const NOW = Date.now();
const FIRST_ID = Buffer.alloc(16, 1).toString("base64url");
const SECOND_ID = Buffer.alloc(16, 2).toString("base64url");
const json = (status, body) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});
const credentialMetadata = (id, createdAt) => ({
  id,
  created_at: createdAt,
  last_used_at: createdAt,
  backup_eligible: false,
  backup_state: false,
});
const registrationOptions = (challenge, exclude) => ({
  challenge_id: Buffer.alloc(16, 7).toString("base64url"),
  publicKey: {
    rp: { id: "localhost", name: "Tanikun" },
    user: {
      id: HANDLE,
      name: "Alice",
      displayName: "Alice",
    },
    challenge,
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    timeout: 120_000,
    excludeCredentials: exclude.map((id) => ({ type: "public-key", id })),
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
    attestation: "none",
  },
});
const assertionOptions = (challenge, allow) => ({
  challenge_id: Buffer.alloc(16, 8).toString("base64url"),
  publicKey: {
    challenge,
    timeout: 120_000,
    rpId: "localhost",
    allowCredentials: allow.map((id) => ({ type: "public-key", id })),
    userVerification: "required",
  },
});

async function openAccount(page) {
  const button = page.locator("#account-button-mobile");
  await button.click();
  await page.locator("#auth-dialog").waitFor({ state: "visible" });
}

async function installFakeApi(page, origin) {
  const credentials = [credentialMetadata(FIRST_ID, NOW - 60_000)];
  let recentAuth = false;
  let removed = false;
  let challengeSequence = 0;
  const calls = [];
  const state = {
    get recentAuth() {
      return recentAuth;
    },
    get removed() {
      return removed;
    },
    get credentials() {
      return credentials.map((credential) => ({ ...credential }));
    },
  };
  await page.route(`${origin}/api/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = request.headers();
    const body = request.postData()
      ? JSON.parse(request.postData())
      : undefined;
    calls.push({
      path: url.pathname,
      method: request.method(),
      csrf: headers["x-csrf-token"] ?? null,
      body,
    });
    if (url.pathname === "/api/v1/auth/session") {
      if (removed) {
        await route.fulfill(json(401, { error: { code: "unauthorized" } }));
        return;
      }
      await route.fulfill(
        json(200, {
          session: {
            account: { handle: HANDLE, display_name: "Alice" },
            expires_at: Date.now() + 43_200_000,
            idle_expires_at: Date.now() + 1_800_000,
            recent_auth: recentAuth,
            recent_auth_expires_at: recentAuth
              ? Date.now() + 300_000
              : Date.now() - 1,
            csrf_token: CSRF,
          },
        }),
      );
      return;
    }
    if (
      url.pathname === "/api/v1/auth/credentials" &&
      request.method() === "GET"
    ) {
      await route.fulfill(json(200, { credentials }));
      return;
    }
    if (url.pathname === "/api/v1/auth/step-up/options") {
      assert.equal(headers["x-csrf-token"], CSRF);
      challengeSequence += 1;
      const challenge = Buffer.alloc(32, challengeSequence).toString(
        "base64url",
      );
      await route.fulfill(json(200, assertionOptions(challenge, [FIRST_ID])));
      return;
    }
    if (url.pathname === "/api/v1/auth/step-up/verify") {
      assert.equal(headers["x-csrf-token"], CSRF);
      assert.equal(body.challenge_id.length > 0, true);
      recentAuth = true;
      await route.fulfill(
        json(200, {
          recent_auth: true,
          recent_auth_expires_at: Date.now() + 300_000,
        }),
      );
      return;
    }
    if (url.pathname === "/api/v1/auth/credentials/options") {
      assert.equal(headers["x-csrf-token"], CSRF);
      challengeSequence += 1;
      const challenge = Buffer.alloc(32, challengeSequence).toString(
        "base64url",
      );
      challengeSequence += 1;
      await route.fulfill(
        json(200, registrationOptions(challenge, [FIRST_ID])),
      );
      return;
    }
    if (url.pathname === "/api/v1/auth/credentials/verify") {
      assert.equal(headers["x-csrf-token"], CSRF);
      credentials.push(credentialMetadata(SECOND_ID, NOW + 1_000));
      await route.fulfill(
        json(200, {
          credential: credentialMetadata(SECOND_ID, NOW + 1_000),
        }),
      );
      return;
    }
    if (
      url.pathname === "/api/v1/sync/document" &&
      request.method() === "POST"
    ) {
      await route.fulfill(
        json(200, {
          document_id: "00000000-0000-4000-8000-000000000001",
          cursor: 0,
        }),
      );
      return;
    }
    if (url.pathname.endsWith("/changes")) {
      if (request.method() === "POST") {
        await route.fulfill(
          json(200, {
            document_id: "00000000-0000-4000-8000-000000000001",
            accepted: [],
            cursor: 0,
          }),
        );
      } else {
        await route.fulfill(
          json(200, {
            document_id: "00000000-0000-4000-8000-000000000001",
            changes: [],
            next_cursor: 0,
            has_more: false,
            cursor: 0,
          }),
        );
      }
      return;
    }
    if (
      url.pathname === `/api/v1/auth/credentials/${FIRST_ID}/remove` &&
      request.method() === "POST"
    ) {
      assert.equal(headers["x-csrf-token"], CSRF);
      removed = true;
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    await route.fulfill(json(404, { error: { code: "not_found" } }));
  });
  return { calls, state };
}

test(
  "adds a second passkey, removes an owned credential, and retains reauth state at 390px",
  { timeout: 60_000 },
  async (t) => {
    const { server, origin } = await startStaticServer(dist);
    t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
    const browser = await browserType.launch();
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.addInitScript(() => {
      globalThis["__TANIKUN_SYNC_CONFIG__"] = { mode: "session", maxRetry: 0 };
      // oxlint-disable-next-line unicorn/consistent-function-scoping
      const encode = (bytes) =>
        btoa(String.fromCharCode(...bytes))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/u, "");
      // oxlint-disable-next-line unicorn/consistent-function-scoping
      const raw = (fill) =>
        Uint8Array.from({ length: 16 }, (_, index) => (fill + index) & 0xff);
      const assertionRaw = Uint8Array.from(
        { length: 16 },
        (_, index) => 40 + index,
      );
      const assertionId = encode(assertionRaw);
      Object.defineProperty(navigator, "credentials", {
        configurable: true,
        value: {
          async create() {
            const bytes = raw(2);
            return {
              id: encode(bytes),
              rawId: bytes.buffer,
              type: "public-key",
              response: {
                clientDataJSON: new Uint8Array([1, 2, 3]).buffer,
                attestationObject: new Uint8Array([4, 5, 6]).buffer,
              },
            };
          },
          async get() {
            return {
              id: assertionId,
              rawId: assertionRaw.buffer,
              type: "public-key",
              response: {
                clientDataJSON: new Uint8Array([7, 8]).buffer,
                authenticatorData: new Uint8Array([9, 10]).buffer,
                signature: new Uint8Array([11, 12]).buffer,
                userHandle: new Uint8Array(32).fill(3).buffer,
              },
            };
          },
        },
      });
    });
    const api = await installFakeApi(page, origin);
    await page.goto(origin);
    await waitForPersistence(page);
    const before = await page.evaluate(async () => ({
      state: await globalThis.tanikunAuthState.read(),
    }));

    await openAccount(page);
    await page.waitForFunction(() =>
      document.querySelector("#auth-dialog")?.contains(document.activeElement),
    );
    await page.keyboard.press("Shift+Tab");
    await page.waitForFunction(() =>
      document.querySelector("#auth-dialog")?.contains(document.activeElement),
    );
    await page.locator('[data-action="add-passkey"]').waitFor({
      state: "visible",
      timeout: 15_000,
    });
    const removeButton = page.locator('[data-action="remove-passkey"]');
    assert.equal(await removeButton.isDisabled(), true);
    assert.match(
      await page.locator("#auth-last-credential-note").innerText(),
      /最後のパスキーは削除できません/u,
    );
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-action="add-passkey"]');
      return button !== null && button.getBoundingClientRect().height >= 44;
    });
    const addHeight = await page
      .locator('[data-action="add-passkey"]')
      .evaluate((node) => node.getBoundingClientRect().height);
    assert.ok(addHeight >= 44);

    await page.locator('[data-action="add-passkey"]').click();
    await page
      .locator('[data-action="add-passkey-confirm"]')
      .waitFor({ state: "visible" });
    assert.match(await page.locator("#auth-dialog").innerText(), /本人確認/u);
    await page.locator('[data-action="add-passkey-confirm"]').click();
    await page.locator('[data-action="add-passkey-create"]').waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await page.locator('[data-action="add-passkey-create"]').click();
    await page.locator('[data-action="add-passkey"]').waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-action="remove-passkey"]').length ===
        2,
    );
    assert.match(
      await page.locator("#auth-dialog-status").innerText(),
      /追加しました/u,
    );
    assert.equal(api.state.credentials.length, 2);

    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
      true,
    );
    assert.equal(
      await page.evaluate(() => {
        const panel = document.querySelector("#auth-dialog");
        return panel.scrollWidth <= panel.clientWidth;
      }),
      true,
    );

    await page.locator('[data-action="remove-passkey"]').first().click();
    await page
      .locator('[data-action="remove-passkey-confirm"]')
      .waitFor({ state: "visible" });
    const confirmation = await page.locator("#auth-dialog").innerText();
    assert.match(confirmation, /すべてのサインイン中のセッションが終了/u);
    assert.match(confirmation, /最後のパスキーは削除できません/u);
    await page.locator('[data-action="remove-passkey-confirm"]').click();
    await page.locator('[data-action="sign-in"]').waitFor({
      state: "visible",
      timeout: 15_000,
    });
    assert.match(
      await page.locator("#auth-dialog-status").innerText(),
      /すべてのセッションを終了/u,
    );
    assert.equal(api.state.removed, true);
    const after = await page.evaluate(async () => ({
      auth: await globalThis.tanikunAuthState.read(),
      state: globalThis.tanikunAuthController.state,
    }));
    assert.equal(after.auth.sessionState, "reauth_required");
    assert.equal(after.auth.accountHandle, before.state.accountHandle);
    assert.equal(after.auth.generation, before.state.generation);
    assert.equal(after.state.sessionState, "reauth_required");
    assert.equal(after.state.stale, false);

    await page.keyboard.press("Escape");
    await page.locator("#auth-dialog").waitFor({ state: "detached" });
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "account-button-mobile",
    );
    assert.equal(errors.length, 0, errors.join("; "));
  },
);
