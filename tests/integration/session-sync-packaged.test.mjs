// Packaged runtime proof for #182. This starts the actual Nix API artifact's
// Worker bridge (not a helper worker and not a source fallback), applies the
// packaged D1 migrations, registers synthetic WebAuthn credentials through the
// packaged HTTP endpoints, and exercises session bootstrap, append, pull, and
// foreign-owner rejection against real local D1.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  buildRegistrationResponse,
  createCredential,
} from "../../apps/api/test/webauthn-ceremony-fixtures.mjs";
import { processGroupExists, SYNC_WRANGLER_BIN } from "./sync-harness.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const apiRoot = process.env.TANIKUN_API_DIST
  ? resolve(process.env.TANIKUN_API_DIST)
  : null;
const AUTH_ORIGIN = "https://localhost:4300";
const SESSION = "__Host-tanikun_session";
const BINDING = "__Host-tanikun_binding";
const RATE_KEY = "A".repeat(43);

async function makeWritable(root) {
  await chmod(root, 0o755);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await makeWritable(path);
    else await chmod(path, 0o644);
  }
}

async function stopWorkerGroup(worker, graceMs = 5_000) {
  if (!worker.pid) return;
  const signalGroup = (signal) => {
    try {
      process.kill(-worker.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const waitForGroup = async () => {
    const deadline = Date.now() + graceMs;
    while (processGroupExists(worker.pid) && Date.now() < deadline)
      await delay(20);
    return !processGroupExists(worker.pid);
  };
  if (!processGroupExists(worker.pid)) return;
  signalGroup("SIGTERM");
  if (await waitForGroup()) return;
  signalGroup("SIGKILL");
  assert.equal(
    await waitForGroup(),
    true,
    "owned packaged Worker process group survived cleanup",
  );
}

function cookieValues(response) {
  if (typeof response.headers.getSetCookie === "function")
    return response.headers.getSetCookie();
  const value = response.headers.get("set-cookie");
  return value ? [value] : [];
}

function cookieNamed(response, name) {
  const prefix = `${name}=`;
  const header = cookieValues(response).find((entry) =>
    entry.startsWith(prefix),
  );
  if (!header) return null;
  return header.slice(prefix.length).split(";", 1)[0];
}

async function jsonRequest(
  origin,
  path,
  { method = "GET", headers, body } = {},
) {
  const requestHeaders = { Origin: AUTH_ORIGIN, ...headers };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  return response;
}

async function register(origin, { idFill, displayName }) {
  const optionsResponse = await jsonRequest(
    origin,
    "/api/v1/auth/register/options",
    { method: "POST", body: { display_name: displayName } },
  );
  const optionsText = await optionsResponse.text();
  assert.equal(optionsResponse.status, 200, optionsText);
  const options = JSON.parse(optionsText);
  const binding = cookieNamed(optionsResponse, BINDING);
  assert.equal(binding?.length, 43);

  const credential = await createCredential({ idFill, idLength: 16 });
  const registration = await buildRegistrationResponse({
    challenge: options.publicKey.challenge,
    rpID: "localhost",
    origin: AUTH_ORIGIN,
    credential,
  });
  const verifyResponse = await jsonRequest(
    origin,
    "/api/v1/auth/register/verify",
    {
      method: "POST",
      headers: { Cookie: `${BINDING}=${binding}` },
      body: {
        challenge_id: options.challenge_id,
        credential: registration,
      },
    },
  );
  const verifyText = await verifyResponse.text();
  assert.equal(verifyResponse.status, 200, verifyText);
  const verifyBody = JSON.parse(verifyText);
  const session = cookieNamed(verifyResponse, SESSION);
  assert.equal(session?.length, 43);
  return {
    session,
    csrf: verifyBody.session.csrf_token,
    handle: verifyBody.session.account.handle,
  };
}

function envelopeFor(documentId, envelope) {
  return {
    ...envelope,
    document_id: documentId,
    aad: { ...envelope.aad, document_id: documentId },
  };
}

async function bootstrap(origin, account) {
  const response = await jsonRequest(origin, "/api/v1/sync/document", {
    method: "POST",
    headers: {
      Cookie: `${SESSION}=${account.session}`,
      "X-CSRF-Token": account.csrf,
    },
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

async function append(origin, account, documentId, changes) {
  return jsonRequest(origin, `/api/v1/sync/documents/${documentId}/changes`, {
    method: "POST",
    headers: {
      Cookie: `${SESSION}=${account.session}`,
      "X-CSRF-Token": account.csrf,
    },
    body: { changes },
  });
}

async function pull(origin, account, documentId) {
  return jsonRequest(
    origin,
    `/api/v1/sync/documents/${documentId}/changes?after=0&limit=100`,
    { headers: { Cookie: `${SESSION}=${account.session}` } },
  );
}

test(
  "packaged Worker routes session principals into bootstrap, append, pull, and ownership",
  { skip: !apiRoot, timeout: 180_000 },
  async (t) => {
    const resolvedApiRoot = await realpath(apiRoot);
    assert.equal(
      resolvedApiRoot.startsWith(`${repositoryRoot}${sep}`),
      false,
      "packaged API must resolve outside the source checkout",
    );

    const output = await mkdtemp(
      join(tmpdir(), "tanikun-session-sync-packaged-"),
    );
    t.after(() => rm(output, { recursive: true, force: true }));
    const artifact = join(output, "api");
    await cp(resolvedApiRoot, artifact, { recursive: true });
    await makeWritable(artifact);
    const configPath = join(artifact, "wrangler.jsonc");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(Object.hasOwn(config, "build"), false);
    assert.equal(Object.hasOwn(config, "watch_dir"), false);
    for (const directory of ["home", "config", "cache", "logs", "persistence"])
      await mkdir(join(output, directory), { recursive: true });

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
    const database = config.d1_databases.find(
      (candidate) => candidate.binding === "DB",
    );
    assert.ok(database);
    const migration = spawnSync(
      process.execPath,
      [
        SYNC_WRANGLER_BIN,
        "d1",
        "migrations",
        "apply",
        database.database_name,
        "--local",
        "--persist-to",
        join(output, "persistence"),
        "--config",
        configPath,
      ],
      { cwd: artifact, env: environment, encoding: "utf8", timeout: 90_000 },
    );
    assert.equal(
      migration.status,
      0,
      `packaged migrations failed\nstdout:\n${migration.stdout}\nstderr:\n${migration.stderr}`,
    );

    const worker = spawn(
      process.execPath,
      [
        SYNC_WRANGLER_BIN,
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
        "--persist-to",
        join(output, "persistence"),
        "--log-level",
        "info",
        "--show-interactive-dev-session=false",
        "--var",
        "AUTH_MODE:session",
        "--var",
        "APP_ENV:test",
        "--var",
        `AUTH_ORIGIN:${AUTH_ORIGIN}`,
        "--var",
        "RP_ID:localhost",
        "--var",
        `AUTH_RATE_LIMIT_KEY:${RATE_KEY}`,
      ],
      {
        cwd: artifact,
        env: environment,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    t.after(() => stopWorkerGroup(worker));

    let log = "";
    const origin = await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(
        () => finish(new Error(`Wrangler startup timed out:\n${log}`)),
        60_000,
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

    const alice = await register(origin, {
      idFill: 0x31,
      displayName: "Packaged Alice",
    });
    const bob = await register(origin, {
      idFill: 0x51,
      displayName: "Packaged Bob",
    });
    const aliceDocument = await bootstrap(origin, alice);
    const bobDocument = await bootstrap(origin, bob);
    assert.notEqual(aliceDocument.document_id, bobDocument.document_id);

    const fixture = JSON.parse(
      await readFile(
        join(repositoryRoot, "docs/contracts/sync-v1.json"),
        "utf8",
      ),
    );
    const first = envelopeFor(aliceDocument.document_id, fixture.envelope);
    const appended = await append(origin, alice, aliceDocument.document_id, [
      first,
    ]);
    const appendedText = await appended.text();
    assert.equal(appended.status, 200, appendedText);
    const appendedBody = JSON.parse(appendedText);
    assert.deepEqual(appendedBody, {
      document_id: aliceDocument.document_id,
      accepted: [{ change_id: first.change_id, server_sequence: 1 }],
      cursor: 1,
    });

    const duplicate = await append(origin, alice, aliceDocument.document_id, [
      first,
    ]);
    assert.deepEqual(await duplicate.json(), appendedBody);

    const pulled = await pull(origin, alice, aliceDocument.document_id);
    const pulledText = await pulled.text();
    assert.equal(pulled.status, 200, pulledText);
    const pulledBody = JSON.parse(pulledText);
    assert.equal(pulledBody.changes.length, 1);
    assert.equal(pulledBody.changes[0].change_id, first.change_id);
    assert.equal(pulledBody.changes[0].server_sequence, 1);
    assert.equal(pulledBody.cursor, 1);

    const foreignRead = await pull(origin, bob, aliceDocument.document_id);
    const foreignWrite = await append(origin, bob, aliceDocument.document_id, [
      envelopeFor(aliceDocument.document_id, fixture.envelope),
    ]);
    for (const response of [foreignRead, foreignWrite]) {
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
      assert.equal(response.headers.get("WWW-Authenticate"), null);
      assert.deepEqual(await response.json(), { error: { code: "not_found" } });
    }
    assert.equal(
      (await (await pull(origin, alice, aliceDocument.document_id)).json())
        .changes.length,
      1,
    );

    const getBootstrap = await jsonRequest(origin, "/api/v1/sync/document", {
      headers: { Cookie: `${SESSION}=${alice.session}` },
    });
    assert.equal(getBootstrap.status, 405);
    assert.equal(getBootstrap.headers.get("Allow"), "POST");

    const noSession = await jsonRequest(origin, "/api/v1/sync/document", {
      method: "POST",
      body: {},
    });
    assert.equal(noSession.status, 401);
    assert.equal(noSession.headers.get("WWW-Authenticate"), null);
    assert.equal(noSession.headers.get("Access-Control-Allow-Origin"), null);

    const bearer = await jsonRequest(origin, "/api/v1/sync/document", {
      method: "POST",
      headers: {
        Cookie: `${SESSION}=${alice.session}`,
        "X-CSRF-Token": alice.csrf,
        Authorization: "Bearer packaged-dev-token",
      },
    });
    assert.equal(bearer.status, 400);
    assert.deepEqual(await bearer.json(), {
      error: { code: "malformed_request" },
    });

    // The packaged bridge must still handle health without auth config.
    const health = await fetch(`${origin}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    // The packaged migrations directory was applied from the artifact itself.
    assert.ok(
      (await readdir(join(artifact, "apps/api/migrations"))).length >= 3,
    );
  },
);
