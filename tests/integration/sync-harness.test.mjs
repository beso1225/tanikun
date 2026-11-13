import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";

import { waitForPersistence } from "./planner-harness.mjs";
import {
  SYNC_IDENTITIES,
  SYNC_WEB_ORIGIN,
  SyncHarness,
  identityToken,
  pathExists,
  processGroupExists,
  readTraceArchiveEntries,
  waitForSync,
} from "./sync-harness.mjs";

const fixture = JSON.parse(
  await readFile(
    new URL("../../docs/contracts/sync-v1.json", import.meta.url),
    "utf8",
  ),
);

function envelopeFor(documentId, envelope = fixture.envelope) {
  return {
    ...envelope,
    document_id: documentId,
    aad: { ...envelope.aad, document_id: documentId },
  };
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test(
  "migrates before the first request and exercises health, bootstrap, append, pull, and ownership",
  { timeout: 180_000 },
  async (t) => {
    const harness = new SyncHarness();
    t.after(() => harness.close());
    await harness.start();

    assert.equal(harness.webOrigin, SYNC_WEB_ORIGIN);
    assert.notEqual(new URL(harness.apiOrigin).port, "4300");

    const health = await harness.health();
    assert.equal(health.status, 200);
    assert.match(health.headers["content-type"], /^application\/json\b/);
    assert.deepEqual(health.json(), { status: "ok" });

    const aliceDocument = await harness.bootstrap("alice");
    const bobDocument = await harness.bootstrap("bob");
    assert.match(
      aliceDocument.document_id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.equal(aliceDocument.cursor, 0);
    assert.notEqual(aliceDocument.document_id, bobDocument.document_id);

    const envelope = envelopeFor(bobDocument.document_id);
    const appended = await harness.append("bob", bobDocument.document_id, [
      envelope,
    ]);
    assert.deepEqual(appended, {
      document_id: bobDocument.document_id,
      accepted: [{ change_id: envelope.change_id, server_sequence: 1 }],
      cursor: 1,
    });

    const pulled = await harness.pull("bob", bobDocument.document_id, {
      after: 0,
      limit: 100,
    });
    assert.deepEqual(pulled, {
      document_id: bobDocument.document_id,
      changes: [{ ...envelope, server_sequence: 1 }],
      next_cursor: 1,
      has_more: false,
      cursor: 1,
    });

    const foreign = await harness.request(
      "alice",
      `/api/v1/sync/documents/${bobDocument.document_id}/changes?after=0&limit=100`,
    );
    assert.equal(foreign.status, 404);
    assert.deepEqual(foreign.json(), { error: { code: "not_found" } });
    const foreignOwn = await harness.request(
      "bob",
      `/api/v1/sync/documents/${aliceDocument.document_id}/changes?after=0&limit=100`,
    );
    assert.equal(foreignOwn.status, 404);
    assert.deepEqual(foreignOwn.json(), { error: { code: "not_found" } });

    assert.ok(
      await pathExists(join(harness.tempDir, "migration-wrangler-internal")),
    );
    assert.equal(
      (await readdir(harness.evidenceDir)).some((name) =>
        name.includes("wrangler-internal"),
      ),
      false,
    );
    await harness.close();
    assert.equal(await pathExists(harness.tempDir), false);
    assert.ok(await pathExists(join(harness.evidenceDir, "migration.log")));
    assert.ok(await pathExists(join(harness.evidenceDir, "wrangler.log")));
    const wranglerLog = await readFile(
      join(harness.evidenceDir, "wrangler.log"),
      "utf8",
    );
    assert.ok(!wranglerLog.includes(aliceDocument.document_id));
    assert.ok(!wranglerLog.includes(bobDocument.document_id));
    assert.equal(harness.wranglerPid !== null, true);
    assert.equal(processGroupExists(harness.wranglerPid), false);
    await assert.rejects(
      fetch(`${harness.apiOrigin}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      }),
    );
  },
);

test(
  "two sequential runs use fresh D1 state and release the web port",
  { timeout: 180_000 },
  async (t) => {
    const first = new SyncHarness();
    t.after(() => first.close());
    await first.start();
    const firstOrigin = first.apiOrigin;
    const firstDocument = await first.bootstrap("alice");
    const firstPid = first.wranglerPid;
    await first.close();

    assert.equal(processGroupExists(firstPid), false);
    assert.equal(await pathExists(first.tempDir), false);
    await assert.rejects(
      fetch(`${firstOrigin}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      }),
    );

    const second = new SyncHarness();
    t.after(() => second.close());
    await second.start();
    const secondDocument = await second.bootstrap("alice");
    assert.notEqual(firstDocument.document_id, secondDocument.document_id);
    const empty = await second.pull("alice", secondDocument.document_id);
    assert.deepEqual(empty.changes, []);
    assert.equal(second.webOrigin, SYNC_WEB_ORIGIN);
  },
);

test(
  "a missing packaged API fails clearly and keeps startup evidence",
  { timeout: 60_000 },
  async (t) => {
    const harness = new SyncHarness({
      apiRoot: join(import.meta.dirname, "fixtures/missing-api"),
    });
    t.after(() => harness.close());
    await assert.rejects(harness.start(), /wrangler\.jsonc/);
    assert.equal(harness.wranglerPid, null);
    assert.equal(await pathExists(harness.tempDir), false);
    assert.match(
      await readFile(join(harness.evidenceDir, "startup-error.log"), "utf8"),
      /wrangler\.jsonc/,
    );
  },
);

test(
  "an occupied contract web port fails clearly without touching the listener",
  { timeout: 60_000 },
  async (t) => {
    const blocker = createServer((_request, response) => response.end("held"));
    await new Promise((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(4300, "127.0.0.1", resolve);
    });
    t.after(() => closeServer(blocker));

    const harness = new SyncHarness();
    t.after(() => harness.close());
    await assert.rejects(
      harness.start(),
      /http:\/\/127\.0\.0\.1:4300[\s\S]*already in use/,
    );
    assert.equal(blocker.listening, true);
    assert.equal(harness.wranglerPid, null);
    assert.equal(await pathExists(harness.tempDir), false);
    assert.match(
      await readFile(join(harness.evidenceDir, "startup-error.log"), "utf8"),
      /4300[\s\S]*already in use/,
    );
  },
);

test(
  "a startup failure after Wrangler starts reaps the process group and keeps evidence",
  { timeout: 90_000 },
  async (t) => {
    const harness = new SyncHarness({ readinessTimeoutMs: 1 });
    t.after(() => harness.close());
    await assert.rejects(harness.start(), /Wrangler startup timed out/);
    const pid = harness.wranglerPid;
    assert.notEqual(pid, null);
    assert.equal(processGroupExists(pid), false);
    assert.equal(await pathExists(harness.tempDir), false);
    assert.match(
      await readFile(join(harness.evidenceDir, "startup-error.log"), "utf8"),
      /Wrangler startup timed out/,
    );
    assert.ok(await pathExists(join(harness.evidenceDir, "wrangler.log")));
  },
);

test(
  "the built page reaches sync through the real Worker and D1 at the injected origin",
  { timeout: 180_000 },
  async (t) => {
    const harness = new SyncHarness();
    t.after(() => harness.close());
    await harness.start();

    let documentId = null;
    await harness.runJourney("browser-plumbing", "alice", async (page) => {
      assert.equal(new URL(page.url()).origin, SYNC_WEB_ORIGIN);
      await waitForPersistence(page);
      await waitForSync(page, "同期済み");
      const config = await page.evaluate(
        () => globalThis["__TANIKUN_SYNC_CONFIG__"],
      );
      assert.deepEqual(config, {
        mode: "dev_bearer",
        apiOrigin: harness.apiOrigin,
        token: identityToken("alice"),
        maxRetry: 0,
      });
      documentId = (await harness.bootstrap("alice")).document_id;
      const changes = await harness.waitForChanges(
        "alice",
        documentId,
        1,
        20_000,
      );
      assert.ok(changes.changes.length >= 1);
    });

    assert.notEqual(documentId, null);
    assert.equal(new URL(harness.apiOrigin).origin, harness.apiOrigin);
    assert.notEqual(harness.apiOrigin, harness.webOrigin);
    assert.ok(
      await pathExists(join(harness.evidenceDir, "browser-plumbing-trace.zip")),
    );
    const trace = await readTraceArchiveEntries(
      join(harness.evidenceDir, "browser-plumbing-trace.zip"),
    );
    assert.deepEqual([...trace.keys()].toSorted(), [
      "trace.network",
      "trace.trace",
    ]);
    const traceText = [...trace.values()].join("\n");
    assert.equal(traceText.includes(identityToken("alice")), false);
    assert.equal(traceText.includes(documentId), false);
    assert.equal(traceText.includes("Authorization"), false);
  },
);

test(
  "a browser journey failure keeps a screenshot, trace, and log and closes the context",
  { timeout: 180_000 },
  async (t) => {
    const harness = new SyncHarness();
    t.after(() => harness.close());
    await harness.start();

    await assert.rejects(
      harness.runJourney("injected-failure", "alice", async () => {
        throw new Error("injected journey failure");
      }),
      /injected journey failure/,
    );
    assert.equal(harness.activeContexts, 0);
    assert.ok(
      (await stat(join(harness.evidenceDir, "injected-failure-failure.png")))
        .size > 0,
    );
    assert.ok(
      (
        await stat(
          join(harness.evidenceDir, "injected-failure-failure-trace.zip"),
        )
      ).size > 0,
    );
    assert.match(
      await readFile(
        join(harness.evidenceDir, "injected-failure-failure.log"),
        "utf8",
      ),
      /injected journey failure/,
    );
    const trace = await readTraceArchiveEntries(
      join(harness.evidenceDir, "injected-failure-failure-trace.zip"),
    );
    const traceText = [...trace.values()].join("\n");
    assert.equal(traceText.includes(identityToken("alice")), false);
    assert.equal(traceText.includes("Authorization"), false);

    await harness.close();
    assert.equal(harness.activeContexts, 0);
    assert.equal(processGroupExists(harness.wranglerPid), false);
    assert.equal(await pathExists(harness.tempDir), false);
  },
);

assert.equal(SYNC_IDENTITIES.length, 2);
