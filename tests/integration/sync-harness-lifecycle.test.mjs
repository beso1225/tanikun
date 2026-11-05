import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createWriteStream } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  SyncHarness,
  WranglerLogSink,
  pathExists,
  preparePackagedArtifact,
  readTraceArchiveEntries,
  sanitizeTraceArchive,
} from "./sync-harness.mjs";

const LAUNCH_GLOBAL = "__TANIKUN_SYNC_HARNESS_TEST_LAUNCH__";
const REAL_PLAYWRIGHT_CORE = process.env.PLAYWRIGHT_CORE;

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

test(
  "parallel initial page opens share one browser and close both contexts",
  { timeout: 30_000 },
  async (t) => {
    const before = signalListenerCounts();
    const launched = [];
    const contexts = [];
    let launchCalls = 0;
    await installFakeChromium(t, async () => {
      launchCalls += 1;
      const browser = fakeBrowser({
        newContext() {
          const context = fakeContext();
          contexts.push(context);
          return context;
        },
      });
      launched.push(browser);
      return browser;
    });
    const harness = startedHarness();
    t.after(async () => {
      await harness.close().catch(() => {});
      for (const browser of launched) {
        if (browser.state.closeCount === 0)
          await browser.close().catch(() => {});
      }
    });

    const [alice, bob] = await Promise.all([
      harness.openPage("alice"),
      harness.openPage("bob"),
    ]);
    const activeBeforeClose = harness.activeContexts;
    await harness.close();

    assert.deepEqual(
      {
        launchCalls,
        contextCount: contexts.length,
        distinctContexts: new Set([alice.context, bob.context]).size,
        activeBeforeClose,
        contextCloseCounts: [
          alice.context.state.closeCount,
          bob.context.state.closeCount,
        ],
        browserCloseCounts: launched.map((browser) => browser.state.closeCount),
      },
      {
        launchCalls: 1,
        contextCount: 2,
        distinctContexts: 2,
        activeBeforeClose: 2,
        contextCloseCounts: [1, 1],
        browserCloseCounts: [1],
      },
    );
    assert.equal(harness.activeContexts, 0);
    assert.equal(harness.browser, null);
    assert.equal(harness.started, false);
    assert.deepEqual(signalListenerCounts(), before);
  },
);

test(
  "close while parallel page opens await one browser launch disposes it once",
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
      await harness.close().catch(() => {});
      if (browser.state.closeCount === 0) await browser.close().catch(() => {});
    });

    const aliceOpening = harness.openPage("alice");
    const bobOpening = harness.openPage("bob");
    await waitUntil(() => launchCalls >= 1, "browser launch did not start");
    const closing = harness.close();
    launch.resolve(browser);

    await assert.rejects(aliceOpening, /closed/);
    await assert.rejects(bobOpening, /closed/);
    await closing;
    assert.equal(launchCalls, 1);
    assert.equal(browser.state.closeCount, 1);
    assert.equal(harness.activeContexts, 0);
    assert.equal(harness.browser, null);
    assert.equal(harness.browserLaunchPromise, null);
    assert.equal(harness.pendingAcquisitions.size, 0);
    assert.equal(harness.started, false);
    await assert.rejects(harness.openPage("alice"), /closed/);
    assert.equal(launchCalls, 1);
    assert.deepEqual(signalListenerCounts(), before);
  },
);

test(
  "a failed initial browser launch is retried for a later page open",
  { timeout: 30_000 },
  async (t) => {
    const before = signalListenerCounts();
    const browser = fakeBrowser();
    let launchCalls = 0;
    await installFakeChromium(t, async () => {
      launchCalls += 1;
      if (launchCalls === 1) throw new Error("injected launch failure");
      return browser;
    });
    const harness = startedHarness();
    t.after(async () => {
      await harness.close().catch(() => {});
      if (browser.state.closeCount === 0) await browser.close().catch(() => {});
    });

    await assert.rejects(harness.openPage("alice"), /injected launch failure/);
    assert.equal(launchCalls, 1);
    assert.equal(harness.activeContexts, 0);
    assert.equal(harness.browser, null);
    assert.equal(harness.browserLaunchPromise, null);

    const bob = await harness.openPage("bob");
    await harness.close();
    assert.equal(launchCalls, 2);
    assert.equal(bob.context.state.closeCount, 1);
    assert.equal(browser.state.closeCount, 1);
    assert.equal(harness.activeContexts, 0);
    assert.equal(harness.browser, null);
    assert.equal(harness.started, false);
    assert.deepEqual(signalListenerCounts(), before);
  },
);

function zipModules() {
  const require = createRequire(import.meta.url);
  assert.ok(
    REAL_PLAYWRIGHT_CORE,
    "PLAYWRIGHT_CORE must be set for archive tests",
  );
  return require(join(REAL_PLAYWRIGHT_CORE, "lib/utilsBundle.js"));
}

async function writeZip(path, entries) {
  const { yazl } = zipModules();
  const zip = new yazl.ZipFile();
  for (const [name, contents] of Object.entries(entries)) {
    zip.addBuffer(Buffer.from(contents), name);
  }
  const output = createWriteStream(path);
  const done = finished(output);
  zip.outputStream.pipe(output);
  zip.end();
  await done;
}

const TRACE_TOKEN = "retained-trace-token-alice";
const TRACE_DOCUMENT_ID = "123e4567-e89b-42d3-a456-426614174000";
const TRACE_CHANGE_ID = "a".repeat(64);
const TRACE_PAYLOAD = "planner-payload-secret";
const TRACE_ENVELOPE = JSON.stringify({
  changes: [
    {
      document_id: TRACE_DOCUMENT_ID,
      change_id: TRACE_CHANGE_ID,
      payload: Buffer.from(TRACE_PAYLOAD).toString("base64"),
    },
  ],
});

async function writeLeakyTrace(path) {
  await writeZip(path, {
    "trace.trace": [
      JSON.stringify({
        version: 10,
        type: "context-options",
        origin: "library",
      }),
      JSON.stringify({
        type: "before",
        callId: "call@1",
        class: "Page",
        method: "addInitScript",
        params: { source: `globalThis.token = "${TRACE_TOKEN}"` },
      }),
      JSON.stringify({
        type: "console",
        messageType: "error",
        text: `console ${TRACE_TOKEN}`,
      }),
      JSON.stringify({
        type: "frame-snapshot",
        snapshot: {
          html: ["DIV", TRACE_DOCUMENT_ID, TRACE_PAYLOAD],
          frameUrl: `http://127.0.0.1:1/api/v1/sync/documents/${TRACE_DOCUMENT_ID}/changes`,
        },
      }),
      "",
    ].join("\n"),
    "trace.network": `${JSON.stringify({
      type: "resource-snapshot",
      snapshot: {
        request: {
          method: "POST",
          url: `http://127.0.0.1:1/api/v1/sync/documents/${TRACE_DOCUMENT_ID}/changes`,
          headers: [{ name: "Authorization", value: `Bearer ${TRACE_TOKEN}` }],
          postData: { text: "", _file: "resources/body.json" },
        },
        response: { status: 200 },
      },
    })}\n`,
    "resources/body.json": TRACE_ENVELOPE,
    "resources/page.html": `<div>${TRACE_DOCUMENT_ID}</div>`,
    "screencast/frame.jpeg": TRACE_TOKEN,
    "trace.stacks": `${TRACE_TOKEN}\n`,
  });
}

function fakeScreenshotPage({
  addInitScript = async () => {},
  goto = async () => {},
} = {}) {
  return {
    on() {},
    async addInitScript() {
      await addInitScript();
    },
    async goto() {
      await goto();
    },
    async screenshot({ path }) {
      await writeFile(path, "fake screenshot");
    },
  };
}

function fakeTraceContext({ newPage, stop } = {}) {
  const state = { closeCount: 0, traceStops: [] };
  const context = {
    state,
    tracing: {
      async start() {},
      async stop(options) {
        state.traceStops.push(options);
        if (stop) await stop(options);
        else await writeLeakyTrace(options.path);
      },
    },
    newPage,
    async close() {
      state.closeCount += 1;
    },
  };
  return context;
}

async function evidenceRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "tanikun-sync-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function startedHarnessWithEvidence(root, tempRoot) {
  const harness = startedHarness();
  harness.evidenceDir = root;
  harness.tempDir = tempRoot;
  harness.wranglerPid = null;
  return harness;
}

test(
  "page-setup failures write named failure evidence before closing the context",
  { timeout: 30_000 },
  async (t) => {
    const root = await evidenceRoot(t);
    const tempRoot = await mkdtemp(join(tmpdir(), "tanikun-sync-temp-"));
    t.after(() => rm(tempRoot, { recursive: true, force: true }));
    const context = fakeTraceContext({
      newPage: async () => {
        throw new Error("injected page creation failure");
      },
    });
    const browser = fakeBrowser({ newContext: () => context });
    await installFakeChromium(t, async () => browser);
    const harness = startedHarnessWithEvidence(root, tempRoot);
    t.after(() => harness.close().catch(() => {}));

    await assert.rejects(
      harness.runJourney("setup-failure", "alice", async () => {}),
      /injected page creation failure/,
    );

    assert.equal(context.state.closeCount, 1);
    assert.equal(harness.activeContexts, 0);
    const failureLog = await readFile(
      join(root, "setup-failure-failure.log"),
      "utf8",
    );
    assert.match(failureLog, /injected page creation failure/);
    assert.equal(
      await pathExists(join(root, "setup-failure-failure.png")),
      false,
    );
    assert.ok(await pathExists(join(root, "setup-failure-failure-trace.zip")));
  },
);

test(
  "navigation failures capture a screenshot, trace, and named failure log",
  { timeout: 30_000 },
  async (t) => {
    const root = await evidenceRoot(t);
    const tempRoot = await mkdtemp(join(tmpdir(), "tanikun-sync-temp-"));
    t.after(() => rm(tempRoot, { recursive: true, force: true }));
    const context = fakeTraceContext({
      newPage: async () =>
        fakeScreenshotPage({
          async goto() {
            throw new Error("injected navigation failure");
          },
        }),
    });
    const browser = fakeBrowser({ newContext: () => context });
    await installFakeChromium(t, async () => browser);
    const harness = startedHarnessWithEvidence(root, tempRoot);
    t.after(() => harness.close().catch(() => {}));

    await assert.rejects(
      harness.runJourney("navigation-failure", "alice", async () => {}),
      /injected navigation failure/,
    );

    assert.equal(context.state.closeCount, 1);
    assert.equal(harness.activeContexts, 0);
    assert.match(
      await readFile(join(root, "navigation-failure-failure.log"), "utf8"),
      /injected navigation failure/,
    );
    assert.ok(await pathExists(join(root, "navigation-failure-failure.png")));
    assert.ok(
      await pathExists(join(root, "navigation-failure-failure-trace.zip")),
    );
  },
);

test(
  "browser context creation failures write a named failure log without a trace",
  { timeout: 30_000 },
  async (t) => {
    const root = await evidenceRoot(t);
    const tempRoot = await mkdtemp(join(tmpdir(), "tanikun-sync-temp-"));
    t.after(() => rm(tempRoot, { recursive: true, force: true }));
    const browser = fakeBrowser({
      async newContext() {
        throw new Error("injected context creation failure");
      },
    });
    await installFakeChromium(t, async () => browser);
    const harness = startedHarnessWithEvidence(root, tempRoot);
    t.after(() => harness.close().catch(() => {}));

    await assert.rejects(
      harness.runJourney("context-failure", "alice", async () => {}),
      /injected context creation failure/,
    );

    assert.equal(harness.activeContexts, 0);
    assert.match(
      await readFile(join(root, "context-failure-failure.log"), "utf8"),
      /injected context creation failure/,
    );
    assert.equal(
      await pathExists(join(root, "context-failure-failure.png")),
      false,
    );
    assert.equal(
      await pathExists(join(root, "context-failure-failure-trace.zip")),
      false,
    );
  },
);

test(
  "init-script failures capture the page evidence before closing the context",
  { timeout: 30_000 },
  async (t) => {
    const root = await evidenceRoot(t);
    const tempRoot = await mkdtemp(join(tmpdir(), "tanikun-sync-temp-"));
    t.after(() => rm(tempRoot, { recursive: true, force: true }));
    const context = fakeTraceContext({
      newPage: async () =>
        fakeScreenshotPage({
          async addInitScript() {
            throw new Error("injected init script failure");
          },
        }),
    });
    const browser = fakeBrowser({ newContext: () => context });
    await installFakeChromium(t, async () => browser);
    const harness = startedHarnessWithEvidence(root, tempRoot);
    t.after(() => harness.close().catch(() => {}));

    await assert.rejects(
      harness.runJourney("init-failure", "alice", async () => {}),
      /injected init script failure/,
    );

    assert.equal(context.state.closeCount, 1);
    assert.match(
      await readFile(join(root, "init-failure-failure.log"), "utf8"),
      /injected init script failure/,
    );
    assert.ok(await pathExists(join(root, "init-failure-failure.png")));
    assert.ok(await pathExists(join(root, "init-failure-failure-trace.zip")));
  },
);

test(
  "retained journey traces are sanitized before they reach evidence",
  { timeout: 30_000 },
  async (t) => {
    const root = await evidenceRoot(t);
    const tempRoot = await mkdtemp(join(tmpdir(), "tanikun-sync-temp-"));
    t.after(() => rm(tempRoot, { recursive: true, force: true }));
    const browser = fakeBrowser({
      newContext: () =>
        fakeTraceContext({
          newPage: async () => fakeScreenshotPage(),
        }),
    });
    await installFakeChromium(t, async () => browser);
    const harness = startedHarnessWithEvidence(root, tempRoot);
    t.after(() => harness.close().catch(() => {}));

    await harness.runJourney("successful-trace", "alice", async () => {});
    await assert.rejects(
      harness.runJourney("failed-trace", "alice", async () => {
        throw new Error("injected journey failure");
      }),
      /injected journey failure/,
    );

    for (const name of [
      "successful-trace-trace",
      "failed-trace-failure-trace",
    ]) {
      const entries = await readTraceArchiveEntries(join(root, `${name}.zip`));
      assert.deepEqual([...entries.keys()].toSorted(), [
        "trace.network",
        "trace.trace",
      ]);
      const text = [...entries.values()].join("\n");
      for (const leaked of [
        TRACE_TOKEN,
        TRACE_DOCUMENT_ID,
        TRACE_CHANGE_ID,
        TRACE_PAYLOAD,
        TRACE_ENVELOPE,
        "Authorization",
      ]) {
        assert.equal(
          text.includes(leaked),
          false,
          `${name}.zip still contains ${leaked}`,
        );
      }
      assert.match(text, /<document-id>/);
      assert.match(text, /"method":"addInitScript"/);
      assert.match(text, /"type":"resource-snapshot"/);
    }
  },
);

test(
  "Wrangler log sink drains a delayed final line before ending its stream",
  { timeout: 30_000 },
  async (t) => {
    const root = await evidenceRoot(t);
    const logPath = join(root, "wrangler.log");
    const sink = new WranglerLogSink(createWriteStream(logPath));
    const child = new EventEmitter();
    child.pid = 999_999;
    child.exitCode = 0;
    child.signalCode = null;
    child.closed = false;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    sink.attach(child);

    const finishing = sink.finish(child, 5_000);
    setImmediate(() => {
      child.stdout.write("delayed final line\n");
      child.stdout.end();
      child.stderr.end();
      child.closed = true;
      child.emit("close", 0, null);
    });
    await finishing;

    // Output that arrives after stdio close must be ignored, not thrown.
    child.stdout.emit("data", "late output after close\n");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    const text = await readFile(logPath, "utf8");
    assert.match(text, /delayed final line/);
    assert.doesNotMatch(text, /late output after close/);
    assert.deepEqual(sink.errorMessages, []);
  },
);

test(
  "cleanup drains a delayed Wrangler line before closing evidence",
  { timeout: 30_000 },
  async (t) => {
    const root = await evidenceRoot(t);
    const tempRoot = await mkdtemp(join(tmpdir(), "tanikun-sync-temp-"));
    t.after(() => rm(tempRoot, { recursive: true, force: true }));
    const harness = startedHarnessWithEvidence(root, tempRoot);
    const child = new EventEmitter();
    child.pid = null;
    child.exitCode = 0;
    child.signalCode = null;
    child.closed = false;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const sink = new WranglerLogSink(
      createWriteStream(join(root, "wrangler.log")),
    );
    sink.attach(child);
    harness.wrangler = child;
    harness.wranglerLog = sink;

    const closing = harness.close();
    setImmediate(() => {
      child.stdout.write("delayed cleanup line\n");
      child.stdout.end();
      child.stderr.end();
      child.closed = true;
      child.emit("close", 0, null);
    });
    await closing;

    const log = await readFile(join(root, "wrangler.log"), "utf8");
    assert.match(log, /delayed cleanup line/);
    assert.deepEqual(harness.cleanupProblems, []);
    assert.equal(harness.started, false);
    assert.equal(await pathExists(tempRoot), false);
    assert.ok(await pathExists(join(root, "cleanup.log")));
  },
);

test(
  "packaged artifacts are relocated to a writable runtime root",
  { timeout: 30_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "tanikun-packaged-source-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = join(root, "source");
    await mkdir(join(source, "apps/api/bridges"), { recursive: true });
    await mkdir(join(source, "apps/api/migrations"), { recursive: true });
    const configPath = join(source, "wrangler.jsonc");
    const main = join(source, "apps/api/bridges/worker.mjs");
    const migrationsDir = join(source, "apps/api/migrations");
    const config = JSON.stringify({
      name: "packaged",
      main: "apps/api/bridges/worker.mjs",
      migrations_dir: "apps/api/migrations",
    });
    await writeFile(configPath, config);
    await writeFile(main, "export default {};\n");
    await writeFile(join(migrationsDir, "0001_sync.sql"), "select 1;\n");
    await chmod(configPath, 0o444);
    const tempRoot = join(root, "runtime");
    await mkdir(tempRoot);

    const prepared = await preparePackagedArtifact(source, tempRoot, {
      main,
      migrationsDir,
      configPath,
    });

    assert.equal(prepared.cwd, join(tempRoot, "api"));
    assert.notEqual(prepared.configPath, configPath);
    assert.ok(prepared.configPath.startsWith(`${prepared.cwd}/`));
    assert.equal(await readFile(prepared.configPath, "utf8"), config);
    assert.ok(await pathExists(prepared.main));
    assert.ok(await pathExists(prepared.migrationsDir));
    await writeFile(prepared.configPath, "{}\n");
    assert.equal(await readFile(configPath, "utf8"), config);
  },
);

test(
  "a packaged API config with source build hooks is rejected before startup",
  { timeout: 30_000 },
  async (t) => {
    const root = await evidenceRoot(t);
    await writeFile(
      join(root, "wrangler.jsonc"),
      JSON.stringify({
        name: "packaged-with-build",
        main: "worker.mjs",
        compatibility_date: "2026-10-12",
        build: { command: "moon build --target js --release --deny-warn" },
        watch_dir: ["apps/api"],
        d1_databases: [
          {
            binding: "DB",
            database_name: "packaged",
            database_id: "00000000-0000-0000-0000-000000000000",
            migrations_dir: "migrations",
          },
        ],
      }),
    );
    const harness = new SyncHarness({ apiRoot: root });
    t.after(() => harness.close().catch(() => {}));

    await assert.rejects(harness.start(), /build|watch_dir/);
    assert.equal(harness.server, null);
    assert.match(
      await readFile(join(harness.evidenceDir, "startup-error.log"), "utf8"),
      /build|watch_dir/,
    );
  },
);

test(
  "sanitized actual Playwright traces omit tokens, IDs, and sync envelopes",
  { timeout: 60_000 },
  async (t) => {
    const core = process.env.PLAYWRIGHT_CORE;
    assert.ok(core, "PLAYWRIGHT_CORE must be set for the trace regression");
    const root = await evidenceRoot(t);
    const server = createServer((request, response) => {
      if (request.url?.includes("/changes")) {
        request.resume();
        request.on("end", () => {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ accepted: [] }));
        });
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(
        `<!doctype html><html><body><p>${TRACE_DOCUMENT_ID}</p></body></html>`,
      );
    });
    await new Promise((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    t.after(
      () =>
        new Promise((resolvePromise) => server.close(() => resolvePromise())),
    );
    const origin = `http://127.0.0.1:${server.address().port}`;
    const { chromium } = await import(
      pathToFileURL(join(core, "index.mjs")).href
    );
    const browser = await chromium.launch();
    t.after(() => browser.close().catch(() => {}));
    const context = await browser.newContext();
    const raw = join(root, "raw-trace.zip");
    const safe = join(root, "safe-trace.zip");
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    await page.addInitScript(
      ({ token }) => {
        globalThis.traceToken = token;
      },
      { token: TRACE_TOKEN },
    );
    await page.goto(origin);
    await page.evaluate(
      async ({ url, token, envelope }) => {
        await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: envelope,
        });
        console.error(`console ${token}`);
      },
      {
        url: `${origin}/api/v1/sync/documents/${TRACE_DOCUMENT_ID}/changes`,
        token: TRACE_TOKEN,
        envelope: TRACE_ENVELOPE,
      },
    );
    await context.tracing.stop({ path: raw });
    await context.close();
    await browser.close();

    const rawEntries = await readTraceArchiveEntries(raw);
    const rawText = [...rawEntries.values()].join("\n");
    for (const leaked of [
      TRACE_TOKEN,
      TRACE_DOCUMENT_ID,
      TRACE_CHANGE_ID,
      Buffer.from(TRACE_PAYLOAD).toString("base64"),
      "Authorization",
    ]) {
      assert.equal(
        rawText.includes(leaked),
        true,
        `fixture is missing ${leaked}`,
      );
    }
    assert.ok(
      [...rawEntries.keys()].some((name) => name.startsWith("resources/")),
    );

    await sanitizeTraceArchive(raw, safe);
    const entries = await readTraceArchiveEntries(safe);
    assert.deepEqual([...entries.keys()].toSorted(), [
      "trace.network",
      "trace.trace",
    ]);
    const safeText = [...entries.values()].join("\n");
    for (const leaked of [
      TRACE_TOKEN,
      TRACE_DOCUMENT_ID,
      TRACE_CHANGE_ID,
      TRACE_PAYLOAD,
      Buffer.from(TRACE_PAYLOAD).toString("base64"),
      TRACE_ENVELOPE,
      "Authorization",
    ]) {
      assert.equal(
        safeText.includes(leaked),
        false,
        `sanitized trace still contains ${leaked}`,
      );
    }
    assert.match(safeText, /<document-id>/);
    assert.match(safeText, /"method":"goto"/);
    assert.match(safeText, /"type":"resource-snapshot"/);
  },
);

test("the harness is one-shot after close", async () => {
  const harness = new SyncHarness();
  await harness.close();
  await assert.rejects(harness.start(), /closed/);
  assert.equal(harness.started, false);
});
