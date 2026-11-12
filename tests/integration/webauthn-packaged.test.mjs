import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  access,
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

import { createWebAuthnProof } from "../../apps/api/test/webauthn-fixtures.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const wranglerBin = join(
  repositoryRoot,
  "node_modules/wrangler/bin/wrangler.js",
);
const apiRoot = process.env.TANIKUN_API_DIST
  ? resolve(process.env.TANIKUN_API_DIST)
  : null;

function workerSource(bundlePath) {
  return `
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from ${JSON.stringify(bundlePath)};

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

    return Response.json({
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
    await access(bundlePath);
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
    await writeFile(workerPath, workerSource(bundlePath));
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
    t.after(async () => {
      if (!worker.pid || worker.exitCode !== null || worker.signalCode !== null)
        return;
      const exited = once(worker, "exit");
      process.kill(-worker.pid, "SIGTERM");
      const timer = setTimeout(() => {
        try {
          process.kill(-worker.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }, 5_000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    });

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
