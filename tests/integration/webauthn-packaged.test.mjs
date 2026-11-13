import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { createWebAuthnProof } from "../../apps/api/test/webauthn-fixtures.mjs";
import { processGroupExists } from "./sync-harness.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const wranglerBin = join(
  repositoryRoot,
  "node_modules/wrangler/bin/wrangler.js",
);
const apiRoot = process.env.TANIKUN_API_DIST
  ? resolve(process.env.TANIKUN_API_DIST)
  : null;

async function stopWorkerGroup(worker, graceMs = 5_000) {
  if (!worker.pid) return;
  function signalGroup(signal) {
    try {
      process.kill(-worker.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  async function waitForGroup() {
    const deadline = Date.now() + graceMs;
    while (processGroupExists(worker.pid) && Date.now() < deadline) {
      await delay(20);
    }
    return !processGroupExists(worker.pid);
  }
  if (!processGroupExists(worker.pid)) return;
  signalGroup("SIGTERM");
  if (await waitForGroup()) return;
  signalGroup("SIGKILL");
  assert.equal(
    await waitForGroup(),
    true,
    "owned Worker process group survived cleanup",
  );
}

test(
  "packaged proof cleanup kills descendants after the Wrangler leader exits",
  {
    timeout: 15_000,
  },
  async (t) => {
    const worker = spawn(
      process.execPath,
      [
        "-e",
        `
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", \`
      process.on("SIGTERM", () => {});
      setInterval(() => {}, 1000);
      process.send("ready");
    \`], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    child.once("message", () => process.stdout.write("ready", () => process.exit(0)));
  `,
      ],
      { detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    t.after(() => {
      if (worker.pid && processGroupExists(worker.pid)) {
        process.kill(-worker.pid, "SIGKILL");
      }
    });
    let output = "";
    worker.stdout.on("data", (data) => {
      output += data;
    });
    await once(worker, "exit");
    assert.equal(worker.exitCode, 0);
    assert.equal(output, "ready");
    assert.equal(processGroupExists(worker.pid), true);
    await stopWorkerGroup(worker, 1_000);
    assert.equal(processGroupExists(worker.pid), false);
  },
);

function workerSource(bundlePath, authBundlePath) {
  return `
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from ${JSON.stringify(bundlePath)};
import {
  buildRegistrationOptions,
  createSessionMaterial,
  handleSessionAuthRequest,
  handleWebAuthnRequest,
  parseRegistrationVerification,
  readSessionAuthConfig,
} from ${JSON.stringify(authBundlePath)};

async function rejectionMessage(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function registrationOptions(body, overrides = {}) {
  return {
    response: body.registration,
    expectedChallenge: body.expected.challenge,
    expectedOrigin: body.expected.origin,
    expectedRPID: body.expected.rpID,
    requireUserVerification: true,
    supportedAlgorithmIDs: [-7],
    ...overrides,
  };
}

function authenticationOptions(credential, body, overrides = {}) {
  return {
    response: body.authentication,
    expectedChallenge: body.expected.challenge,
    expectedOrigin: body.expected.origin,
    expectedRPID: body.expected.rpID,
    credential,
    requireUserVerification: true,
    ...overrides,
  };
}

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const body = await request.json();
    const registration = await verifyRegistrationResponse(
      registrationOptions(body),
    );
    if (!registration.verified || !registration.registrationInfo) {
      return Response.json({ registration: false });
    }
    const credential = registration.registrationInfo.credential;

    const authentication = await verifyAuthenticationResponse(
      authenticationOptions(credential, body),
    );
    const modifiedAssertion = await verifyAuthenticationResponse(
      authenticationOptions(credential, body, {
        response: body.authenticationWithModifiedSignature,
      }),
    );
    const modifiedRegistration = await verifyRegistrationResponse(
      registrationOptions(body, {
        response: body.registrationWithModifiedSignature,
      }),
    );

    const unconfigured = await handleWebAuthnRequest(
      new Request("https://localhost:4300/api/v1/auth/register/options", {
        method: "POST",
      }),
      {},
      {},
    );
    const unconfiguredSession = await handleSessionAuthRequest(
      new Request("https://localhost:4300/api/v1/auth/session"),
      {},
    );
    const authOptions = await buildRegistrationOptions({
      rpID: "localhost",
      rpName: "Tanikun",
      accountHandle: "A".repeat(43),
      displayName: "Packaged user",
      challenge: new Uint8Array(32),
    });
    const sessionMaterial = await createSessionMaterial();
    let authEntryRejection = null;
    try {
      parseRegistrationVerification({
        challenge_id: "A".repeat(22),
        credential: {
          id: "AQ",
          rawId: "AQ",
          type: "public-key",
          response: { clientDataJSON: "AQ", attestationObject: "AQ" },
        },
        clientExtensionResults: { prf: "packaged-canary" },
      });
    } catch (error) {
      authEntryRejection = error.code;
    }
    const sessionConfig = readSessionAuthConfig({
      AUTH_MODE: "session",
      APP_ENV: "test",
      AUTH_ORIGIN: "https://localhost:4300",
      RP_ID: "localhost",
      AUTH_RATE_LIMIT_KEY: "A".repeat(43),
    });

    return Response.json({
      authEntry: {
        userID: authOptions.user.id,
        keys: Object.keys(authOptions).sort(),
        hasExtensions: Object.hasOwn(authOptions, "extensions"),
        hasHints: Object.hasOwn(authOptions, "hints"),
        tokenLength: sessionMaterial.token.length,
        csrfLength: sessionMaterial.csrfToken.length,
        configMode: sessionConfig?.mode ?? null,
        rejection: authEntryRejection,
        handlerStatus: unconfigured.response.status,
        sessionHandlerStatus: unconfiguredSession.status,
      },
      registration: registration.verified,
      authentication: authentication.verified,
      modifiedAssertion: modifiedAssertion.verified,
      modifiedRegistration: modifiedRegistration.verified,
      wrongChallenge: {
        registration: await rejectionMessage(
          verifyRegistrationResponse(
            registrationOptions(body, { expectedChallenge: "wrong-challenge" }),
          ),
        ),
        authentication: await rejectionMessage(
          verifyAuthenticationResponse(
            authenticationOptions(credential, body, {
              expectedChallenge: "wrong-challenge",
            }),
          ),
        ),
      },
      wrongOrigin: {
        registration: await rejectionMessage(
          verifyRegistrationResponse(
            registrationOptions(body, {
              expectedOrigin: "https://evil.tanikun.test",
            }),
          ),
        ),
        authentication: await rejectionMessage(
          verifyAuthenticationResponse(
            authenticationOptions(credential, body, {
              expectedOrigin: "https://evil.tanikun.test",
            }),
          ),
        ),
      },
      wrongRPID: {
        registration: await rejectionMessage(
          verifyRegistrationResponse(
            registrationOptions(body, { expectedRPID: "other.tanikun.test" }),
          ),
        ),
        authentication: await rejectionMessage(
          verifyAuthenticationResponse(
            authenticationOptions(credential, body, {
              expectedRPID: "other.tanikun.test",
            }),
          ),
        ),
      },
      credential: {
        id: credential.id,
        counter: credential.counter,
        publicKey: Array.from(credential.publicKey),
      },
    });
  },
};
`;
}

test(
  "packaged API WebAuthn bundle verifies fixtures in the Workers runtime",
  { skip: !apiRoot, timeout: 120_000 },
  async (t) => {
    const bundlePath = join(apiRoot, "apps/api/webauthn/verify.js");
    const authBundlePath = join(apiRoot, "apps/api/webauthn/auth.js");
    await access(bundlePath);
    await access(authBundlePath);
    const bundle = await readFile(bundlePath, "utf8");
    assert.doesNotMatch(
      bundle,
      /^\s*import\s+[^("]/mu,
      "packaged verifier bundle must not have external static imports",
    );
    assert.doesNotMatch(
      bundle,
      /\brequire\s*\(\s*["']/u,
      "packaged verifier bundle must not have external require calls",
    );

    const resolvedApiRoot = await realpath(apiRoot);
    assert.equal(
      resolvedApiRoot.startsWith(`${repositoryRoot}${sep}`),
      false,
      "packaged API must resolve outside the source checkout",
    );

    const proof = await createWebAuthnProof();
    const output = await mkdtemp(join(tmpdir(), "tanikun-webauthn-packaged-"));
    t.after(() => rm(output, { recursive: true, force: true }));
    const workerPath = join(output, "worker.mjs");
    await writeFile(workerPath, workerSource(bundlePath, authBundlePath));
    const configPath = join(output, "wrangler.jsonc");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          name: "tanikun-webauthn-packaged-proof",
          main: "./worker.mjs",
          compatibility_date: "2026-10-12",
          send_metrics: false,
        },
        null,
        2,
      ),
    );
    for (const directory of ["home", "config", "cache", "logs"]) {
      await mkdir(join(output, directory), { recursive: true });
    }

    const worker = spawn(
      process.execPath,
      [
        wranglerBin,
        "dev",
        "--config",
        configPath,
        "--local",
        "--ip",
        "127.0.0.1",
        "--port",
        "0",
        "--inspector-port",
        "0",
      ],
      {
        cwd: output,
        detached: true,
        env: {
          ...process.env,
          HOME: join(output, "home"),
          XDG_CACHE_HOME: join(output, "cache"),
          XDG_CONFIG_HOME: join(output, "config"),
          WRANGLER_LOG_PATH: join(output, "logs"),
          WRANGLER_SEND_METRICS: "false",
          BROWSER: "none",
          NO_COLOR: "1",
          CI: "1",
          NODE_PATH: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    t.after(() => stopWorkerGroup(worker));

    let log = "";
    const origin = await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(
        () => finish(new Error(`Wrangler startup timed out:\n${log}`)),
        45_000,
      );
      function finish(error, url) {
        clearTimeout(timer);
        worker.off("error", onError);
        worker.off("exit", onExit);
        if (error) reject(error);
        else resolvePromise(url);
      }
      function onError(error) {
        finish(error);
      }
      function onExit(code) {
        finish(new Error(`Wrangler exited (${code}):\n${log}`));
      }
      function onData(data) {
        log += data;
        const match = log.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) finish(null, match[1]);
      }
      worker.once("error", onError);
      worker.once("exit", onExit);
      worker.stdout.on("data", onData);
      worker.stderr.on("data", onData);
    });

    const response = await fetch(`${origin}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...proof,
        credential: {
          ...proof.credential,
          publicKey: Array.from(proof.credential.publicKey),
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    const result = JSON.parse(responseText);

    assert.equal(result.registration, true);
    assert.equal(result.authentication, true);
    assert.equal(result.modifiedAssertion, false);
    assert.equal(result.modifiedRegistration, false);
    assert.equal(result.credential.id, proof.credential.id);
    assert.equal(result.credential.counter, proof.credential.counter);
    assert.deepEqual(result.credential.publicKey, [
      ...proof.credential.publicKey,
    ]);
    assert.equal(result.authEntry.userID, "A".repeat(43));
    assert.deepEqual(result.authEntry.keys, [
      "attestation",
      "authenticatorSelection",
      "challenge",
      "excludeCredentials",
      "pubKeyCredParams",
      "rp",
      "timeout",
      "user",
    ]);
    assert.equal(result.authEntry.hasExtensions, false);
    assert.equal(result.authEntry.hasHints, false);
    assert.equal(result.authEntry.tokenLength, 43);
    assert.equal(result.authEntry.csrfLength, 43);
    assert.equal(result.authEntry.configMode, "session");
    assert.equal(result.authEntry.rejection, "malformed_request");
    assert.equal(result.authEntry.handlerStatus, 404);
    assert.equal(result.authEntry.sessionHandlerStatus, 404);
    for (const key of ["wrongChallenge", "wrongOrigin", "wrongRPID"]) {
      assert.equal(Object.keys(result[key]).length, 2);
    }
    for (const message of Object.values(result.wrongChallenge)) {
      assert.equal(typeof message, "string");
      assert.match(
        message,
        /Unexpected (registration|authentication) response challenge/,
      );
    }
    for (const message of Object.values(result.wrongOrigin)) {
      assert.equal(typeof message, "string");
      assert.match(message, /Unexpected response origin/);
    }
    for (const message of Object.values(result.wrongRPID)) {
      assert.equal(typeof message, "string");
      assert.match(message, /Unexpected RP ID hash/);
    }
  },
);

function sessionWorkerSource(authBundlePath) {
  return `
import {
  AUTH_RATE_LIMIT_POLICIES,
  createConfiguredAuthRateLimiter,
  handleSessionAuthRequest,
  trustedClientAddress,
} from ${JSON.stringify(authBundlePath)};

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/limit") {
      const limiter = await createConfiguredAuthRateLimiter({
        db: env.DB,
        request,
        env,
        now: () => 1760000000000,
      });
      const outcomes = [];
      for (let index = 0; index < 6; index += 1) {
        try {
          await limiter.enforce(
            [AUTH_RATE_LIMIT_POLICIES.logoutAllAccount],
            { account: "acct_packaged_rate" },
          );
          outcomes.push("admitted");
        } catch (error) {
          outcomes.push(error.code);
        }
      }
      const row = await env.DB.prepare(
        "SELECT bucket_key, count FROM auth_rate_limit_counters",
      ).first();
      return Response.json({
        address: trustedClientAddress(request),
        outcomes,
        bucketLength: row.bucket_key.length,
        count: row.count,
      });
    }
    if (url.pathname === "/seed") {
      if (request.method !== "POST")
        return new Response("Method Not Allowed", { status: 405 });
      const body = await request.json();
      const now = Date.now();
      try {
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO users (id, handle, display_name, created_at) VALUES (?1, ?2, ?3, ?4)",
          ).bind(body.accountId, body.handle, body.displayName, now),
          env.DB.prepare(
            "INSERT INTO documents (id, owner_id, last_seq, created_at) VALUES (?1, ?2, 0, ?3)",
          ).bind(body.documentId, body.accountId, now),
          env.DB.prepare(
            "INSERT INTO sessions (digest, user_id, csrf_digest, created_at, last_seen_at, expires_at, idle_expires_at, recent_auth_at) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?4)",
          ).bind(
            new Uint8Array(body.digest),
            body.accountId,
            new Uint8Array(body.csrfDigest),
            now,
            now + 12 * HOUR,
            now + 30 * MINUTE,
          ),
        ]);
      } catch (error) {
        return Response.json(
          { error: String(error) },
          { status: 500 },
        );
      }
      return Response.json({ ok: true });
    }
    return handleSessionAuthRequest(request, env);
  },
};
`;
}

test(
  "packaged session boundary uses real D1 cookies, CSRF, and logout-all revocation",
  { skip: !apiRoot, timeout: 120_000 },
  async (t) => {
    const authBundlePath = join(apiRoot, "apps/api/webauthn/auth.js");
    await access(authBundlePath);

    const output = await mkdtemp(join(tmpdir(), "tanikun-session-packaged-"));
    t.after(() => rm(output, { recursive: true, force: true }));
    const migrations = join(output, "migrations");
    await mkdir(migrations, { recursive: true });
    await cp(join(apiRoot, "apps/api/migrations"), migrations, {
      recursive: true,
    });
    const workerPath = join(output, "worker.mjs");
    await writeFile(workerPath, sessionWorkerSource(authBundlePath));
    const configPath = join(output, "wrangler.jsonc");
    const databaseName = "tanikun-session-packaged";
    await writeFile(
      configPath,
      JSON.stringify(
        {
          name: "tanikun-session-packaged-proof",
          main: "./worker.mjs",
          compatibility_date: "2026-10-12",
          send_metrics: false,
          vars: {
            APP_ENV: "test",
            AUTH_MODE: "session",
            AUTH_ORIGIN: "https://localhost:4300",
            RP_ID: "localhost",
            AUTH_RATE_LIMIT_KEY: "A".repeat(43),
          },
          d1_databases: [
            {
              binding: "DB",
              database_name: databaseName,
              database_id: "00000000-0000-0000-0000-000000000000",
              migrations_dir: "./migrations",
            },
          ],
        },
        null,
        2,
      ),
    );
    for (const directory of ["home", "config", "cache", "logs"]) {
      await mkdir(join(output, directory), { recursive: true });
    }
    const environment = {
      ...process.env,
      HOME: join(output, "home"),
      XDG_CACHE_HOME: join(output, "cache"),
      XDG_CONFIG_HOME: join(output, "config"),
      WRANGLER_LOG_PATH: join(output, "logs"),
      WRANGLER_SEND_METRICS: "false",
      BROWSER: "none",
      NO_COLOR: "1",
      CI: "1",
      NODE_PATH: "",
    };
    const migration = spawnSync(
      process.execPath,
      [
        wranglerBin,
        "d1",
        "migrations",
        "apply",
        databaseName,
        "--local",
        "--config",
        configPath,
      ],
      {
        cwd: output,
        env: environment,
        encoding: "utf8",
        timeout: 90_000,
      },
    );
    assert.equal(
      migration.status,
      0,
      `packaged migrations failed\nstdout:\n${migration.stdout}\nstderr:\n${migration.stderr}`,
    );

    const worker = spawn(
      process.execPath,
      [
        wranglerBin,
        "dev",
        "--config",
        configPath,
        "--local",
        "--ip",
        "127.0.0.1",
        "--port",
        "0",
        "--inspector-port",
        "0",
      ],
      {
        cwd: output,
        detached: true,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    t.after(() => stopWorkerGroup(worker));

    let log = "";
    const origin = await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(
        () => finish(new Error(`Wrangler startup timed out:\n${log}`)),
        45_000,
      );
      function finish(error, url) {
        clearTimeout(timer);
        worker.off("error", onError);
        worker.off("exit", onExit);
        if (error) reject(error);
        else resolvePromise(url);
      }
      function onError(error) {
        finish(error);
      }
      function onExit(code) {
        finish(new Error(`Wrangler exited (${code}):\n${log}`));
      }
      function onData(data) {
        log += data;
        const match = log.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) finish(null, match[1]);
      }
      worker.once("error", onError);
      worker.once("exit", onExit);
      worker.stdout.on("data", onData);
      worker.stderr.on("data", onData);
    });

    const tokenBytes = Uint8Array.from({ length: 32 }, () => 0x11);
    const token = Buffer.from(tokenBytes).toString("base64url");
    const csrf = createHmac("sha256", tokenBytes)
      .update("tanikun-csrf-v1")
      .digest();
    const csrfToken = csrf.toString("base64url");
    const digest = createHash("sha256").update(tokenBytes).digest();
    const csrfDigest = createHash("sha256").update(csrf).digest();
    const handle = Buffer.alloc(32).toString("base64url");
    const accountId = "acct_packaged180";
    const documentId = randomUUID();
    const cookie = `__Host-tanikun_session=${token}`;
    const seed = await fetch(`${origin}/seed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId,
        handle,
        displayName: "Packaged Session",
        documentId,
        digest: [...digest],
        csrfDigest: [...csrfDigest],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const seedText = await seed.text();
    assert.equal(seed.status, 200, seedText);

    const limit = await fetch(`${origin}/limit`, {
      signal: AbortSignal.timeout(30_000),
    });
    const limitText = await limit.text();
    assert.equal(limit.status, 200, limitText);
    assert.deepEqual(JSON.parse(limitText), {
      address: "127.0.0.1",
      outcomes: [
        "admitted",
        "admitted",
        "admitted",
        "admitted",
        "admitted",
        "rate_limited",
      ],
      bucketLength: 43,
      count: 5,
    });

    const status = await fetch(`${origin}/api/v1/auth/session`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(30_000),
    });
    const statusText = await status.text();
    assert.equal(status.status, 200, statusText);
    assert.equal(status.headers.get("Cache-Control"), "no-store");
    assert.equal(status.headers.get("Access-Control-Allow-Origin"), null);
    const body = JSON.parse(statusText);
    assert.equal(body.session.account.handle, handle);
    assert.equal(body.session.csrf_token, csrfToken);
    assert.equal(body.session.recent_auth, true);
    assert.equal(statusText.includes(token), false);

    const logout = await fetch(`${origin}/api/v1/auth/logout-all`, {
      method: "POST",
      headers: {
        Origin: "https://localhost:4300",
        Cookie: cookie,
        "X-CSRF-Token": csrfToken,
      },
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(logout.status, 204, await logout.text());
    assert.equal(logout.headers.get("Access-Control-Allow-Origin"), null);
    const setCookie = logout.headers.get("Set-Cookie") ?? "";
    assert.match(setCookie, /^__Host-tanikun_session=;/u);
    assert.match(setCookie, /Max-Age=0/u);
    assert.doesNotMatch(setCookie, /Domain|Partitioned/u);

    const revoked = await fetch(`${origin}/api/v1/auth/session`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(revoked.status, 401);
    assert.match(revoked.headers.get("Set-Cookie") ?? "", /Max-Age=0/u);
    assert.equal(revoked.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(revoked.headers.get("WWW-Authenticate"), null);
  },
);
