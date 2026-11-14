// #185 real-session response-loss proof. A browser push reaches the production
// Worker and commits in D1, then Chromium loses the response. The unchanged
// client envelope remains in the session-scoped outbox and the retry is
// idempotent. This complements the Phase 4 dev-bearer fault suite without
// replacing the real browser, Worker, D1, cookie, or CSRF path.

import assert from "node:assert/strict";
import test from "node:test";

import { waitForPersistence } from "./planner-harness.mjs";
import {
  AUTH_ORIGIN,
  activeSession,
  assertEvidenceSanitized,
  assertHarnessCleaned,
  d1Counts,
  registerAndSync,
  waitForSyncText,
  waitSynced,
} from "./session-proof-helpers.mjs";
import { addCustomCourse } from "./sync-browser-helpers.mjs";
import {
  readD1State,
  readOutboxEntries,
  readPlannerState,
  readSyncState,
  syncNow,
  waitFor,
} from "./sync-convergence-helpers.mjs";
import { SyncHarness, acceptBrowserFaults } from "./sync-harness.mjs";

const changesGlob = "**/api/v1/sync/documents/*/changes*";

test(
  "a lost session push response retries the identical envelope without a duplicate",
  { timeout: 300_000 },
  async (t) => {
    const harness = new SyncHarness({ mode: "session" });
    t.after(() => harness.close());
    await harness.start();
    const canary = "Session lost-response planner canary 185";
    let cookieValue = null;
    let csrfToken = null;
    let credentialId = null;

    await harness.runJourneyGroup(
      "session-lost-response",
      [{ label: "alice", identity: "alice", session: true }],
      async ([page], _errors, states) => {
        await waitForPersistence(page);
        await registerAndSync(page, "Alice Lost Response");
        const account = await activeSession(page);
        const [{ id: documentId }] = await harness.d1Query(
          "SELECT id FROM documents",
        );
        const cookie = (await states[0].context.cookies()).find(
          (candidate) => candidate.name === "__Host-tanikun_session",
        );
        assert.ok(cookie);
        cookieValue = cookie.value;
        csrfToken = account.csrfToken;
        const credentials = await harness.exportCredentials(
          states[0].authenticator,
        );
        credentialId = credentials[0].credentialId;

        const before = await d1Counts(harness);
        let accepted = null;
        let lost = false;
        const posts = [];
        page.on("request", (request) => {
          if (
            request.method() === "POST" &&
            new URL(request.url()).pathname.endsWith("/changes")
          )
            posts.push(request.postData());
        });
        await page.route(changesGlob, async (route) => {
          if (lost || route.request().method() !== "POST") {
            await route.continue();
            return;
          }
          lost = true;
          const response = await route.fetch();
          accepted = await response.json();
          await route.abort("connectionreset");
        });
        await addCustomCourse(page, canary);
        await waitForPersistence(page);
        await waitForSyncText(page, "オフライン");
        assert.ok(accepted, "the push reached the real Worker before loss");
        assert.equal(accepted.accepted.length, 1);
        assert.equal(posts.length, 1);
        const queued = await readOutboxEntries(page, {
          apiOrigin: AUTH_ORIGIN,
          documentId,
          accountHandle: account.accountHandle,
        });
        assert.deepEqual(
          queued.map((entry) => entry.change_id),
          accepted.accepted.map((entry) => entry.change_id),
        );
        await waitFor(
          async () => (await d1Counts(harness)).changes === before.changes + 1,
          "the committed row is visible after the response loss",
          10_000,
        );
        const committed = await d1Counts(harness);
        assert.deepEqual(committed, {
          ...before,
          changes: before.changes + 1,
          sequences: before.sequences + 1,
        });
        const d1AfterCommit = await readD1State(harness);

        await page.unroute(changesGlob);
        let retryResponse = null;
        await page.route(changesGlob, async (route) => {
          if (route.request().method() !== "POST") {
            await route.continue();
            return;
          }
          const response = await route.fetch();
          retryResponse = {
            status: response.status(),
            body: await response.json(),
          };
          await route.fulfill({ response });
        });
        await page.locator("#sync-retry").click();
        await waitSynced(page);
        assert.ok(retryResponse, "the retry reached the real Worker");
        assert.equal(retryResponse.status, 200);
        assert.deepEqual(retryResponse.body, accepted);
        assert.equal(posts.length, 2, "the retry sent a second POST");
        assert.equal(posts[1], posts[0], "the retry resent the exact envelope");
        assert.deepEqual(await d1Counts(harness), committed);
        assert.deepEqual(await readD1State(harness), d1AfterCommit);
        await syncNow(page, "同期済み");
        assert.deepEqual(
          (
            await readSyncState(page, {
              apiOrigin: AUTH_ORIGIN,
              documentId,
              accountHandle: account.accountHandle,
            })
          ).outbox,
          [],
        );
        const planner = await readPlannerState(page, {
          apiOrigin: AUTH_ORIGIN,
          documentId,
          accountHandle: account.accountHandle,
        });
        assert.equal(planner.metadata.mergedCursor, committed.sequences);

        acceptBrowserFaults(states[0], [
          {
            kind: "console",
            text: /Failed to load resource: net::ERR_CONNECTION_RESET/u,
            count: 1,
            reason: "the push response was lost after the real D1 commit",
          },
        ]);
      },
    );

    assert.ok(cookieValue);
    assert.ok(csrfToken);
    assert.ok(credentialId);
    await harness.close();
    await assertEvidenceSanitized(harness, [
      cookieValue,
      csrfToken,
      credentialId,
      canary,
      "Alice Lost Response",
      "X-CSRF-Token",
      "Authorization",
    ]);
    await assertHarnessCleaned(harness);
  },
);
