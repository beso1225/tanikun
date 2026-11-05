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

function runSyncRecipe(just, bin, log) {
  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    JUST_CALL_LOG: log,
  };
  delete env.TANIKUN_WEB_DIST;
  delete env.TANIKUN_API_DIST;
  return spawnSync(just, ["test-sync"], {
    cwd: repositoryRoot,
    env,
    encoding: "utf8",
    timeout: 20_000,
  });
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

    const result = runSyncRecipe(just, bin, log);
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const calls = (await readFile(log, "utf8")).trim().split("\n");
    assert.deepEqual(calls, ["just build-web"]);
  },
);

test(
  "test-sync builds both artifacts before running the node tests when builds succeed",
  { timeout: 30_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "tanikun-justfile-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const just = await justBinary();
    const { bin, log } = await installFakeCommands(root);

    const result = runSyncRecipe(just, bin, log);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const calls = (await readFile(log, "utf8")).trim().split("\n");
    assert.deepEqual(calls.slice(0, 2), ["just build-web", "just build"]);
    assert.match(calls[2], /^node --test /);
    assert.match(calls[2], /sync-harness\.test\.mjs/);
    assert.match(calls[2], /sync-harness-lifecycle\.test\.mjs/);
    assert.match(calls[2], /justfile\.test\.mjs/);
    assert.match(calls[2], /sync-journey\.test\.mjs/);
    assert.equal(calls.length, 3);
  },
);
