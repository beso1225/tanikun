import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  assertDeploymentConfig,
  deploymentConfigErrors,
} from "../../scripts/check-deployment-config.mjs";
import { parseJsonc } from "../../scripts/parse-jsonc.mjs";

const root = resolve(import.meta.dirname, "../..");

test("the committed default Wrangler config is closed", async () => {
  const path = join(root, "wrangler.jsonc");
  const config = parseJsonc(await readFile(path, "utf8"));
  assert.deepEqual(deploymentConfigErrors(config), []);
  assert.doesNotThrow(() => assertDeploymentConfig(config, path));

  const command = spawnSync(
    process.execPath,
    [join(root, "scripts/check-deployment-config.mjs"), path],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(command.status, 0, command.stderr);
  assert.match(command.stdout, /deployment configuration is closed/u);
});

test("dev, session, and public plaintext settings are rejected", () => {
  const everyKey = {
    AUTH_MODE: "session",
    DEV_AUTH: "true",
    DEV_AUTH_IDENTITIES: "{}",
    AUTH_ORIGIN: "https://localhost:4300",
    RP_ID: "localhost",
    AUTH_RATE_LIMIT_KEY: "A".repeat(43),
    TEST_NEW_DOCUMENT_ID: "11111111-1111-4111-8111-111111111111",
    ALLOW_PUBLIC_SYNC: "true",
    SYNC_PUBLIC: "true",
    SYNC_PLAINTEXT_PUBLIC: "true",
    PUBLIC_PLAINTEXT_SYNC: "true",
  };
  const errors = deploymentConfigErrors({ vars: everyKey });
  for (const key of Object.keys(everyKey))
    assert.ok(
      errors.some((entry) => entry.endsWith(`.${key}`)),
      `missing rejection for ${key}`,
    );
  assert.throws(
    () => assertDeploymentConfig({ vars: everyKey }, "fixture"),
    /fixture enables a disallowed/u,
  );
});

test("environment-scoped production vars are checked too", () => {
  for (const environment of ["production", "preview"]) {
    const config = {
      env: {
        [environment]: {
          vars: { APP_ENV: environment, AUTH_MODE: "dev_bearer" },
        },
      },
    };
    assert.deepEqual(deploymentConfigErrors(config), [
      `env.${environment}.vars.AUTH_MODE`,
    ]);
  }
  assert.deepEqual(deploymentConfigErrors({ vars: { APP_ENV: "local" } }), [
    "vars.APP_ENV=local",
  ]);
});

test("diagnostics do not echo secret values", () => {
  const canary = "secret-canary-value";
  assert.throws(
    () =>
      assertDeploymentConfig(
        { vars: { AUTH_RATE_LIMIT_KEY: canary, DEV_AUTH_IDENTITIES: canary } },
        "fixture",
      ),
    (error) => {
      assert.doesNotMatch(error.message, new RegExp(canary, "u"));
      return true;
    },
  );
});

test("the CLI rejects a bad config without an unbounded dump", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tanikun-deployment-config-"));
  try {
    const path = join(directory, "wrangler.jsonc");
    await writeFile(
      path,
      '{\n  "vars": { "AUTH_MODE": "session", "AUTH_RATE_LIMIT_KEY": "canary" }\n}\n',
    );
    const command = spawnSync(
      process.execPath,
      [join(root, "scripts/check-deployment-config.mjs"), path],
      { cwd: root, encoding: "utf8" },
    );
    assert.notEqual(command.status, 0);
    assert.match(command.stderr, /AUTH_MODE/u);
    assert.doesNotMatch(`${command.stdout}${command.stderr}`, /canary/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
