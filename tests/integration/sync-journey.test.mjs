import assert from "node:assert/strict";
import test from "node:test";

import { waitForPersistence } from "./planner-harness.mjs";
import {
  SYNC_WEB_ORIGIN,
  SyncHarness,
  identityToken,
  waitForSync,
} from "./sync-harness.mjs";

test(
  "Alice and Bob reach sync state with distinct documents through the real Worker",
  { timeout: 240_000 },
  async (t) => {
    const harness = new SyncHarness();
    t.after(() => harness.close());
    await harness.start();

    const observed = {};
    for (const name of ["alice", "bob"]) {
      await harness.runJourney(`sync-${name}`, name, async (page) => {
        assert.equal(new URL(page.url()).origin, SYNC_WEB_ORIGIN);
        await waitForPersistence(page);
        await waitForSync(page, "同期済み", 30_000);
        const config = await page.evaluate(
          () => globalThis["__TANIKUN_SYNC_CONFIG__"],
        );
        assert.equal(config.apiOrigin, harness.apiOrigin);
        assert.equal(config.token, identityToken(name));
        const document = await harness.bootstrap(name);
        const changes = await harness.waitForChanges(
          name,
          document.document_id,
          1,
          20_000,
        );
        observed[name] = {
          documentId: document.document_id,
          changeCount: changes.changes.length,
        };
      });
    }

    assert.notEqual(observed.alice.documentId, observed.bob.documentId);
    assert.ok(observed.alice.changeCount >= 1);
    assert.ok(observed.bob.changeCount >= 1);
    assert.notEqual(identityToken("alice"), identityToken("bob"));
  },
);
