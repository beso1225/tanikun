import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SyncHarness, pathExists } from "./sync-harness.mjs";

const LAUNCH_GLOBAL = "__TANIKUN_SYNC_HARNESS_TEST_LAUNCH__";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function signalListenerCounts() {
  return {
    SIGINT: process.listenerCount("SIGINT"),
    SIGTERM: process.listenerCount("SIGTERM"),
  };
}

async function waitUntil(predicate, description, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
  }
  assert.fail(description);
}

async function installFakeChromium(t, launch) {
  const root = await mkdtemp(join(tmpdir(), "tanikun-sync-browser-"));
  await writeFile(
    join(root, "index.mjs"),
    `export const chromium = { launch: () => globalThis.${LAUNCH_GLOBAL}() };\n`,
  );
  const previous = process.env.PLAYWRIGHT_CORE;
  process.env.PLAYWRIGHT_CORE = root;
  globalThis[LAUNCH_GLOBAL] = launch;
  t.after(async () => {
    if (previous === undefined) delete process.env.PLAYWRIGHT_CORE;
    else process.env.PLAYWRIGHT_CORE = previous;
    delete globalThis[LAUNCH_GLOBAL];
    await rm(root, { recursive: true, force: true });
  });
}

function fakePage() {
  return {
    on() {},
    async addInitScript() {},
    async goto() {},
  };
}

function fakeContext({ newPage = async () => fakePage() } = {}) {
  const state = { closeCount: 0 };
  return {
    state,
    tracing: {
      async start() {},
      async stop() {},
    },
    newPage,
    async close() {
      state.closeCount += 1;
    },
  };
}

function fakeBrowser({ newContext } = {}) {
  const state = { closeCount: 0 };
  return {
    state,
    async newContext(options) {
      return newContext ? newContext(options) : fakeContext();
    },
    async close() {
      state.closeCount += 1;
    },
  };
}

function startedHarness() {
  const harness = new SyncHarness();
  // Browser lifecycle coverage does not need Worker, D1, or the fixed origin.
  harness.started = true;
  harness.apiOrigin = "http://127.0.0.1:1";
  return harness;
}

test(
  "close during startup cancels acquisition and leaves no signal handlers or temp directory",
  { timeout: 30_000 },
  async (t) => {
    const before = signalListenerCounts();
    const harness = new SyncHarness({
      apiRoot: join(import.meta.dirname, "fixtures/missing-api"),
    });
    t.after(async () => {
      for (const [signal, handler] of harness.signalHandlers)
        process.off(signal, handler);
      harness.signalHandlers.clear();
      if (harness.tempDir)
        await rm(harness.tempDir, { recursive: true, force: true });
      await harness.close().catch(() => {});
    });

    const starting = harness.start().then(
      () => null,
      (error) => error,
    );
    const closing = harness.close().catch((error) => error);
    const [startError, closeError] = await Promise.all([starting, closing]);

    assert.ok(startError instanceof Error);
    assert.equal(harness.started, false);
    assert.deepEqual(signalListenerCounts(), before);
    assert.equal(
      harness.tempDir === null || !(await pathExists(harness.tempDir)),
      true,
    );
    assert.equal(closeError, undefined);
  },
);

test(
  "close while a browser launch is pending disposes the browser that arrives late",
  { timeout: 30_000 },
  async (t) => {
    const before = signalListenerCounts();
    const launch = deferred();
    let launchCalls = 0;
    const browser = fakeBrowser();
    await installFakeChromium(t, () => {
      launchCalls += 1;
      return launch.promise;
    });
    const harness = startedHarness();
    t.after(async () => {
      await browser.close().catch(() => {});
      await harness.close().catch(() => {});
    });

    const opening = harness.openPage("alice");
    await waitUntil(() => launchCalls === 1, "browser launch did not start");
    const closing = harness.close();
    launch.resolve(browser);

    await assert.rejects(opening, /closed/);
    await closing;
    assert.equal(browser.state.closeCount, 1);
    assert.equal(harness.activeContexts, 0);
    assert.equal(harness.browser, null);
    assert.equal(harness.started, false);
    assert.deepEqual(signalListenerCounts(), before);
  },
);

test(
  "close while a browser context is pending closes the context and browser",
  { timeout: 30_000 },
  async (t) => {
    const before = signalListenerCounts();
    const contextReady = deferred();
    let newContextCalls = 0;
    const context = fakeContext();
    const browser = fakeBrowser({
      newContext() {
        newContextCalls += 1;
        return contextReady.promise;
      },
    });
    await installFakeChromium(t, async () => browser);
    const harness = startedHarness();
    t.after(async () => {
      await browser.close().catch(() => {});
      await harness.close().catch(() => {});
    });

    const opening = harness.openPage("alice");
    await waitUntil(
      () => newContextCalls === 1,
      "browser context creation did not start",
    );
    const closing = harness.close();
    contextReady.resolve(context);

    await assert.rejects(opening, /closed/);
    await closing;
    assert.equal(context.state.closeCount, 1);
    assert.equal(browser.state.closeCount, 1);
    assert.equal(harness.activeContexts, 0);
    assert.equal(harness.browser, null);
    assert.equal(harness.started, false);
    assert.deepEqual(signalListenerCounts(), before);
  },
);

test("the harness is one-shot after close", async () => {
  const harness = new SyncHarness();
  await harness.close();
  await assert.rejects(harness.start(), /closed/);
  assert.equal(harness.started, false);
});
