import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
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
import { isAbsolute, join, relative, resolve } from "node:path";
import test from "node:test";

import { SYNC_WRANGLER_BIN } from "./sync-harness.mjs";

async function makeWritable(root) {
  await chmod(root, 0o755);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await makeWritable(path);
    else await chmod(path, 0o644);
  }
}

const apiRoot = process.env.TANIKUN_API_DIST
  ? resolve(process.env.TANIKUN_API_DIST)
  : null;

test(
  "packaged API config runs without source build hooks or source fallback",
  { skip: !apiRoot, timeout: 120_000 },
  async (t) => {
    const configPath = join(apiRoot, "wrangler.jsonc");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(Object.hasOwn(config, "build"), false);
    assert.equal(Object.hasOwn(config, "watch_dir"), false);
    assert.equal(Object.hasOwn(config, "$schema"), false);

    const migrations = config.d1_databases.find(
      (database) => database.binding === "DB",
    )?.migrations_dir;
    assert.equal(typeof config.main, "string");
    assert.equal(typeof migrations, "string");
    for (const relativePath of [config.main, migrations]) {
      assert.equal(isAbsolute(relativePath), false);
      const artifactPath = resolve(apiRoot, relativePath);
      assert.equal(relative(apiRoot, artifactPath).startsWith(".."), false);
      await access(artifactPath);
    }
    assert.deepEqual((await readdir(resolve(apiRoot, migrations))).toSorted(), [
      "0001_sync.sql",
      "0002_auth_storage.sql",
      "0003_auth_rate_limits.sql",
    ]);
    for (const modulePath of [
      "apps/api/http/api.mjs",
      "apps/api/http/api.js",
      "apps/api/http/session-auth.mjs",
      "apps/api/rate-limits/limiter.mjs",
      "apps/api/rate-limits/policy.mjs",
      "apps/api/repositories/auth-data.mjs",
      "apps/api/repositories/auth.mjs",
      "apps/api/session/admission.mjs",
      "apps/api/session/cookies.mjs",
    ]) {
      await access(resolve(apiRoot, modulePath));
    }

    const output = await mkdtemp(join(tmpdir(), "tanikun-packaged-api-"));
    t.after(() => rm(output, { recursive: true, force: true }));
    const artifact = join(output, "api");
    await cp(await realpath(apiRoot), artifact, { recursive: true });
    await makeWritable(artifact);
    const writableConfig = join(artifact, "wrangler.jsonc");
    for (const directory of ["home", "config", "cache", "out"]) {
      await mkdir(join(output, directory), { recursive: true });
    }
    const result = spawnSync(
      process.execPath,
      [
        SYNC_WRANGLER_BIN,
        "deploy",
        "--dry-run",
        "--config",
        writableConfig,
        "--outdir",
        join(output, "out"),
      ],
      {
        cwd: artifact,
        env: {
          ...process.env,
          HOME: join(output, "home"),
          XDG_CACHE_HOME: join(output, "cache"),
          XDG_CONFIG_HOME: join(output, "config"),
          WRANGLER_LOG_PATH: join(output, "wrangler-internal"),
          CI: "1",
          NO_COLOR: "1",
          WRANGLER_SEND_METRICS: "false",
        },
        encoding: "utf8",
        timeout: 90_000,
      },
    );
    assert.equal(
      result.status,
      0,
      `wrangler deploy --dry-run failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.doesNotMatch(
      `${result.stdout}\\n${result.stderr}`,
      /not in a Moon project|no moon\.mod/i,
    );
  },
);
