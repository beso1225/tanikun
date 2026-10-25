import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("Tailwind detects MoonBit utilities without scanning unrelated tests", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tanikun-tailwind-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, "styles.css");
  execFileSync(
    process.execPath,
    [
      "node_modules/@tailwindcss/cli/dist/index.mjs",
      "-i",
      "apps/web/styles/input.css",
      "-o",
      output,
      "--minify",
    ],
    { stdio: "pipe" },
  );
  const css = await readFile(output, "utf8");
  assert.match(css, /\.max-w-6xl\{/);
  assert.match(css, /\.gap-2\{/);
  assert.match(css, /\.p-6\{/);
  // This candidate exists only outside the Web sources and must not leak in.
  assert.ok(!css.includes(".w-\\[137px\\]"));
});
