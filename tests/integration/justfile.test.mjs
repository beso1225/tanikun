import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

const repositoryRoot = join(import.meta.dirname, "../..");

async function justBinary() {
  const result = spawnSync("sh", ["-c", "command -v just"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, "just must be available on PATH");
  return result.stdout.trim();
}

async function installFakeCommands(root, { buildWebStatus = 0 } = {}) {
  const bin = join(root, "bin");
  await mkdir(bin);
  const log = join(root, "calls.log");
  await writeFile(
    join(bin, "just"),
    [
      "#!/bin/sh",
      'printf "just %s\\n" "$*" >> "$JUST_CALL_LOG"',
      'case "$1" in',
      `  build-web) exit ${buildWebStatus} ;;`,
      "  build) exit 0 ;;",
      '  *) printf "unexpected just command: %s\\n" "$*" >> "$JUST_CALL_LOG"; exit 97 ;;',
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  await writeFile(
    join(bin, "node"),
    [
      "#!/bin/sh",
      'printf "node %s\\n" "$*" >> "$JUST_CALL_LOG"',
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  await chmod(join(bin, "just"), 0o755);
  await chmod(join(bin, "node"), 0o755);
  return { bin, log };
}

function runRecipe(just, bin, log, recipe, extraEnv = {}) {
  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    JUST_CALL_LOG: log,
    ...extraEnv,
  };
  if (!("TANIKUN_WEB_DIST" in extraEnv)) delete env.TANIKUN_WEB_DIST;
  if (!("TANIKUN_API_DIST" in extraEnv)) delete env.TANIKUN_API_DIST;
  return spawnSync(just, [recipe], {
    cwd: repositoryRoot,
    env,
    encoding: "utf8",
    timeout: 20_000,
  });
}

async function calls(log) {
  try {
    return (await readFile(log, "utf8")).trim().split("\n");
  } catch {
    return [];
  }
}

test(
  "test-sync stops before the API build and tests when build-web fails",
  { timeout: 30_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "tanikun-justfile-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const just = await justBinary();
    const { bin, log } = await installFakeCommands(root, {
      buildWebStatus: 42,
    });

    const result = runRecipe(just, bin, log, "test-sync");
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(await calls(log), ["just build-web"]);
  },
);

test(
  "test-sync builds both artifacts before running the Phase 4 dev-bearer tests",
  { timeout: 30_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "tanikun-justfile-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const just = await justBinary();
    const { bin, log } = await installFakeCommands(root);

    const result = runRecipe(just, bin, log, "test-sync");
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const observed = await calls(log);
    assert.deepEqual(observed.slice(0, 2), ["just build-web", "just build"]);
    assert.match(observed[2], /^node --test /);
    for (const file of [
      "sync-harness.test.mjs",
      "sync-harness-lifecycle.test.mjs",
      "packaged-api.test.mjs",
      "justfile.test.mjs",
      "sync-api-faults.test.mjs",
      "sync-journey.test.mjs",
      "sync-convergence.test.mjs",
      "sync-browser-faults.test.mjs",
    ])
      assert.match(observed[2], new RegExp(file.replaceAll(".", "\\.")));
    assert.doesNotMatch(observed[2], /session-account-journey/);
    assert.equal(observed.length, 3);
  },
);

test(
  "test-session-proof builds both artifacts then runs the bounded session suite",
  { timeout: 30_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "tanikun-justfile-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const just = await justBinary();
    const { bin, log } = await installFakeCommands(root);

    const result = runRecipe(just, bin, log, "test-session-proof");
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const observed = await calls(log);
    assert.deepEqual(observed.slice(0, 2), ["just build-web", "just build"]);
    assert.match(observed[2], /^node --test /);
    for (const file of [
      "session-sync-packaged.test.mjs",
      "webauthn-packaged.test.mjs",
      "session-account-journey.test.mjs",
      "session-credential-journey.test.mjs",
      "session-replica-proof.test.mjs",
      "session-account-proof.test.mjs",
      "session-auth-faults.test.mjs",
      "session-response-loss.test.mjs",
      "session-failure-evidence.test.mjs",
    ])
      assert.match(observed[2], new RegExp(file.replaceAll(".", "\\.")));
    assert.doesNotMatch(observed[2], /sync-convergence\.test\.mjs/);
    assert.equal(observed.length, 3);
  },
);

test(
  "both real-session recipes reuse packaged artifacts without a source build",
  { timeout: 30_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "tanikun-justfile-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const just = await justBinary();
    const { bin, log } = await installFakeCommands(root);
    const env = {
      TANIKUN_WEB_DIST: "/nix/store/web",
      TANIKUN_API_DIST: "/nix/store/api",
    };

    for (const recipe of ["test-sync", "test-session-proof"]) {
      await rm(log, { force: true });
      const result = runRecipe(just, bin, log, recipe, env);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const observed = await calls(log);
      assert.equal(observed.length, 1);
      assert.match(observed[0], /^node --test /);
    }
  },
);

test(
  "one packaged root is rejected before a build or test",
  { timeout: 30_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "tanikun-justfile-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const just = await justBinary();
    const { bin, log } = await installFakeCommands(root);

    const result = runRecipe(just, bin, log, "test-session-proof", {
      TANIKUN_WEB_DIST: "/nix/store/web",
    });
    assert.notEqual(result.status, 0);
    assert.deepEqual(await calls(log), []);
    assert.match(result.stderr, /must be set together/u);
  },
);
