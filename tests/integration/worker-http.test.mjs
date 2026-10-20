import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";

test("MoonBit health endpoint runs in local Workers runtime", { timeout: 45_000 }, async (t) => {
  const worker = spawn(process.execPath, [
    "node_modules/wrangler/bin/wrangler.js", "dev",
    "--config", "wrangler.jsonc", "--local",
    "--ip", "127.0.0.1", "--port", "0", "--inspector-port", "0",
  ], {
    detached: true,
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_LOG_PATH: ".wrangler/logs",
      BROWSER: "none",
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (!worker.pid || worker.exitCode !== null || worker.signalCode !== null) return;
    const exited = once(worker, "exit");
    process.kill(-worker.pid, "SIGTERM");
    const timer = setTimeout(() => {
      try { process.kill(-worker.pid, "SIGKILL"); } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }, 5_000);
    try { await exited; } finally { clearTimeout(timer); }
  });

  let output = "";
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Wrangler startup timed out:\n${output}`)), 30_000);
    function finish(error, url) {
      clearTimeout(timer);
      worker.off("error", onError);
      worker.off("exit", onExit);
      if (error) reject(error); else resolve(url);
    }
    function onError(error) { finish(error); }
    function onExit(code) { finish(new Error(`Wrangler exited (${code}):\n${output}`)); }
    function onData(data) {
      output += data;
      const match = output.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) finish(null, match[1]);
    }
    worker.once("error", onError);
    worker.once("exit", onExit);
    worker.stdout.on("data", onData);
    worker.stderr.on("data", onData);
  });

  const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^application\/json\b/);
  assert.deepEqual(await response.json(), { status: "ok" });

  const missing = await fetch(`${origin}/api/missing`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(missing.status, 404);
  await missing.body.cancel();

  const wrongMethod = await fetch(`${origin}/api/health`, {
    method: "POST", signal: AbortSignal.timeout(5_000),
  });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "GET");
  await wrongMethod.body.cancel();
});
