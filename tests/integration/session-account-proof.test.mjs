// #185 account-boundary proof. Bob signs in through the real passkey endpoint
// in a separate Chromium context and cannot read or write Alice's document
// through the production Worker, cookie session, or CSRF path. The test also
// switches from Alice to Bob while Alice has a pending outbox entry and proves
// the change is neither uploaded to Bob nor dropped. Accounts and planner data
// are fictional, and the passkeys come from Chromium's virtual authenticator.

import assert from "node:assert/strict";
import test from "node:test";

import { waitForPersistence } from "./planner-harness.mjs";
import {
  AUTH_ORIGIN,
  activeSession,
  assertEvidenceSanitized,
  assertHarnessCleaned,
  d1Counts,
  declineCopyAndSync,
  registerAndSync,
  signIn,
  signOut,
  waitForAuthState,
  waitForSyncText,
  waitSynced,
} from "./session-proof-helpers.mjs";
import { addCustomCourse, installApiGate } from "./sync-browser-helpers.mjs";
import {
  readOutboxEntries,
  readPlannerState,
  syncNow,
  waitFor,
} from "./sync-convergence-helpers.mjs";
import { SyncHarness, acceptBrowserFaults } from "./sync-harness.mjs";

const SESSION_COOKIE = "__Host-tanikun_session";
const syncGlob = "**/api/v1/sync/**";
const offlineSync = (route) => route.abort("failed");

async function readAccountState(page, documentId, accountHandle) {
  return readPlannerState(page, {
    apiOrigin: AUTH_ORIGIN,
    documentId,
    accountHandle,
  });
}

test(
  "Bob's real session cannot read or write Alice's document",
  { timeout: 300_000 },
  async (t) => {
    const harness = new SyncHarness({ mode: "session" });
    t.after(() => harness.close());
    await harness.start();
    const canary = "Bob foreign-write canary 185";
    let alice = null;
    let bob = null;
    let aliceDocument = null;
    let bobDocument = null;
    let bobToken = null;
    let bobCsrf = null;
    let bobCredentialId = null;

    await harness.runJourneyGroup(
      "session-account-boundary",
      [
        { label: "alice", identity: "alice", session: true },
        { label: "bob", identity: "bob", session: true },
      ],
      async ([pageA, pageB], _errors, states) => {
        await waitForPersistence(pageA);
        await waitForPersistence(pageB);
        await registerAndSync(pageA, "Alice Boundary");
        alice = await activeSession(pageA);
        await declineCopyAndSync(pageB, "Bob Boundary");
        bob = await activeSession(pageB);

        const rows = await harness.d1Query(
          `SELECT u.handle, d.id AS document_id, d.last_seq
            FROM users u JOIN documents d ON d.owner_id = u.id
            WHERE u.handle IS NOT NULL`,
        );
        aliceDocument = rows.find(
          (row) => row.handle === alice.accountHandle,
        )?.document_id;
        bobDocument = rows.find(
          (row) => row.handle === bob.accountHandle,
        )?.document_id;
        assert.ok(aliceDocument);
        assert.ok(bobDocument);
        assert.notEqual(aliceDocument, bobDocument);

        const cookie = (await states[1].context.cookies()).find(
          (candidate) => candidate.name === SESSION_COOKIE,
        );
        assert.ok(cookie);
        bobToken = cookie.value;
        bobCsrf = bob.csrfToken;
        const credentials = await harness.exportCredentials(
          states[1].authenticator,
        );
        assert.equal(credentials.length, 1);
        bobCredentialId = credentials[0].credentialId;

        const gate = await installApiGate(pageB);
        gate.offline = true;
        await addCustomCourse(pageB, canary);
        await waitForPersistence(pageB);
        await waitForSyncText(pageB, "オフライン");
        const queued = await waitFor(
          async () => {
            const entries = await readOutboxEntries(pageB, {
              apiOrigin: AUTH_ORIGIN,
              documentId: bobDocument,
              accountHandle: bob.accountHandle,
            });
            return entries.length > 0 ? entries : null;
          },
          "Bob queued a real client envelope",
          10_000,
        );
        const bobEnvelope = queued[0].envelope;
        assert.equal(bobEnvelope.document_id, bobDocument);
        const foreignEnvelope = {
          ...bobEnvelope,
          document_id: aliceDocument,
          aad: { ...bobEnvelope.aad, document_id: aliceDocument },
        };
        gate.offline = false;
        const before = await d1Counts(harness);
        const aliceBefore = await readAccountState(
          pageA,
          aliceDocument,
          alice.accountHandle,
        );
        const foreign = await pageB.evaluate(
          async ({ aliceDocument: targetDocument, csrfToken, envelope }) => {
            const read = await fetch(
              `/api/v1/sync/documents/${targetDocument}/changes?after=0&limit=100`,
              { credentials: "same-origin" },
            );
            const readBody = await read.json();
            const write = await fetch(
              `/api/v1/sync/documents/${targetDocument}/changes`,
              {
                method: "POST",
                credentials: "same-origin",
                headers: {
                  "Content-Type": "application/json",
                  "X-CSRF-Token": csrfToken,
                },
                body: JSON.stringify({ changes: [envelope] }),
              },
            );
            const writeBody = await write.json();
            const noCsrf = await fetch(
              `/api/v1/sync/documents/${targetDocument}/changes`,
              {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ changes: [envelope] }),
              },
            );
            const noCsrfBody = await noCsrf.json();
            return {
              read: { status: read.status, body: readBody },
              write: { status: write.status, body: writeBody },
              noCsrf: { status: noCsrf.status, body: noCsrfBody },
            };
          },
          {
            aliceDocument,
            csrfToken: bobCsrf,
            envelope: foreignEnvelope,
          },
        );
        assert.equal(foreign.read.status, 404);
        assert.deepEqual(foreign.read.body, { error: { code: "not_found" } });
        assert.equal(foreign.write.status, 404);
        assert.deepEqual(foreign.write.body, { error: { code: "not_found" } });
        assert.equal(foreign.noCsrf.status, 403);
        assert.deepEqual(foreign.noCsrf.body, {
          error: { code: "csrf_forbidden" },
        });
        assert.deepEqual(await d1Counts(harness), before);
        const aliceAfterForeign = await readAccountState(
          pageA,
          aliceDocument,
          alice.accountHandle,
        );
        assert.deepEqual(
          {
            source: aliceAfterForeign.source,
            heads: aliceAfterForeign.heads,
          },
          { source: aliceBefore.source, heads: aliceBefore.heads },
        );
        assert.deepEqual(
          (
            await readOutboxEntries(pageB, {
              apiOrigin: AUTH_ORIGIN,
              documentId: bobDocument,
              accountHandle: bob.accountHandle,
            })
          ).map((entry) => entry.change_id),
          [bobEnvelope.change_id],
          "the rejected foreign write did not drain Bob's own outbox",
        );

        const ownRead = await pageB.evaluate(
          async ({ bobDocument: ownDocument }) => {
            const response = await fetch(
              `/api/v1/sync/documents/${ownDocument}/changes?after=0&limit=100`,
              { credentials: "same-origin" },
            );
            return { status: response.status, body: await response.json() };
          },
          { bobDocument },
        );
        assert.equal(ownRead.status, 200);
        assert.ok(Array.isArray(ownRead.body.changes));

        await pageB.locator("#sync-retry").click();
        await waitSynced(pageB);
        await syncNow(pageB, "同期済み");
        const bobChanges = await harness.d1Query(
          "SELECT document_id, change_id FROM changes ORDER BY seq",
        );
        assert.equal(
          bobChanges.some(
            (row) =>
              row.document_id === bobDocument &&
              row.change_id === bobEnvelope.change_id,
          ),
          true,
        );
        assert.equal(
          bobChanges.some(
            (row) =>
              row.document_id === aliceDocument &&
              row.change_id === bobEnvelope.change_id,
          ),
          false,
        );
        assert.deepEqual(await d1Counts(harness), {
          ...before,
          changes: before.changes + 1,
          sequences: before.sequences + 1,
        });
        const aliceAfter = await readAccountState(
          pageA,
          aliceDocument,
          alice.accountHandle,
        );
        assert.deepEqual(
          { source: aliceAfter.source, heads: aliceAfter.heads },
          { source: aliceBefore.source, heads: aliceBefore.heads },
        );

        acceptBrowserFaults(states[1], [
          {
            kind: "console",
            text: /Failed to load resource: net::ERR_FAILED/u,
            count: 1,
            reason: "Bob edited while the real API was gated offline",
          },
          {
            kind: "console",
            text: /Failed to load resource: the server responded with a status of 404/u,
            count: 2,
            reason:
              "Bob's real session was rejected when it read and wrote Alice's document",
          },
          {
            kind: "console",
            text: /Failed to load resource: the server responded with a status of 403/u,
            count: 1,
            reason:
              "Bob's foreign write without a CSRF token was rejected before ownership",
          },
        ]);
      },
    );

    assert.ok(bobToken);
    assert.ok(bobCredentialId);
    await harness.close();
    await assertEvidenceSanitized(harness, [
      bobToken,
      bobCsrf,
      bobCredentialId,
      canary,
      "X-CSRF-Token",
      "Authorization",
    ]);
    await assertHarnessCleaned(harness);
    assert.equal(bobToken.length, 43);
  },
);

test(
  "Alice-to-Bob switch keeps Alice's pending outbox local and off Bob's document",
  { timeout: 300_000 },
  async (t) => {
    const harness = new SyncHarness({ mode: "session" });
    t.after(() => harness.close());
    await harness.start();
    const canary = "Alice switch history canary 185";
    let alice = null;
    let bob = null;
    let aliceDocument = null;
    let bobDocument = null;
    let aliceCookie = null;
    let aliceCsrf = null;
    let aliceCredentialId = null;
    let pendingChangeId = null;
    let aliceCredentials = null;
    let aliceSeqBefore = null;

    await harness.runJourneyGroup(
      "session-account-switch",
      [{ label: "account", identity: "alice", session: true }],
      async ([page], _errors, states) => {
        await waitForPersistence(page);
        await registerAndSync(page, "Alice Switch Outbox");
        alice = await activeSession(page);
        const cookie = (await states[0].context.cookies()).find(
          (candidate) => candidate.name === SESSION_COOKIE,
        );
        assert.ok(cookie);
        aliceCookie = cookie.value;
        aliceCsrf = alice.csrfToken;
        aliceCredentials = await harness.exportCredentials(
          states[0].authenticator,
        );
        aliceCredentialId = aliceCredentials[0].credentialId;
        aliceDocument = (
          await harness.d1Query(
            `SELECT d.id FROM documents d JOIN users u ON d.owner_id = u.id
              WHERE u.handle = '${alice.accountHandle}'`,
          )
        )[0].id;
        assert.ok(aliceDocument);
        aliceSeqBefore = Number(
          (
            await harness.d1Query(
              `SELECT last_seq FROM documents WHERE id = '${aliceDocument}'`,
            )
          )[0].last_seq,
        );

        await page.route(syncGlob, offlineSync);
        await addCustomCourse(page, canary);
        await waitForPersistence(page);
        await waitForSyncText(page, "オフライン");
        const queued = await waitFor(
          async () => {
            const entries = await readOutboxEntries(page, {
              apiOrigin: AUTH_ORIGIN,
              documentId: aliceDocument,
              accountHandle: alice.accountHandle,
            });
            return entries.length > 0 ? entries : null;
          },
          "Alice queued a pending outbox change",
          10_000,
        );
        pendingChangeId = queued[0].change_id;

        await signOut(page);
        const signedOut = await waitForAuthState(page, "signed_out");
        assert.equal(signedOut.accountHandle, null);
        assert.deepEqual(
          (
            await readOutboxEntries(page, {
              apiOrigin: AUTH_ORIGIN,
              documentId: aliceDocument,
              accountHandle: alice.accountHandle,
            })
          ).map((entry) => entry.change_id),
          [pendingChangeId],
          "Alice's outbox survives sign-out",
        );
        await page.unroute(syncGlob, offlineSync);

        await states[0].authenticator.cdp.send("WebAuthn.clearCredentials", {
          authenticatorId: states[0].authenticator.authenticatorId,
        });
        await declineCopyAndSync(page, "Bob Switch Outbox");
        bob = await activeSession(page);
        assert.notEqual(bob.accountHandle, alice.accountHandle);
        const rows = await harness.d1Query(
          `SELECT u.handle, d.id AS document_id
            FROM users u JOIN documents d ON d.owner_id = u.id
            WHERE u.handle IS NOT NULL`,
        );
        bobDocument = rows.find(
          (row) => row.handle === bob.accountHandle,
        )?.document_id;
        assert.ok(bobDocument);
        assert.notEqual(bobDocument, aliceDocument);
        const changesAfterBob = await harness.d1Query(
          "SELECT document_id, change_id FROM changes ORDER BY seq",
        );
        assert.equal(
          changesAfterBob.some((row) => row.change_id === pendingChangeId),
          false,
          "Alice's pending change never reaches the server during Bob's sync",
        );
        assert.equal(
          Number(
            (
              await harness.d1Query(
                `SELECT last_seq FROM documents WHERE id = '${aliceDocument}'`,
              )
            )[0].last_seq,
          ),
          aliceSeqBefore,
          "Bob's sync cannot add a change to Alice's document",
        );
        assert.deepEqual(
          await readOutboxEntries(page, {
            apiOrigin: AUTH_ORIGIN,
            documentId: bobDocument,
            accountHandle: bob.accountHandle,
          }),
          [],
          "Bob's scope starts without Alice's outbox entry",
        );
        const bobPlan = await readPlannerState(page, {
          apiOrigin: AUTH_ORIGIN,
          documentId: bobDocument,
          accountHandle: bob.accountHandle,
        });
        assert.equal(
          JSON.stringify(bobPlan.source).includes(canary),
          false,
          "Alice's pending planner history does not leak into Bob's account plan",
        );

        await signOut(page);
        await waitForAuthState(page, "signed_out");
        await states[0].authenticator.cdp.send("WebAuthn.clearCredentials", {
          authenticatorId: states[0].authenticator.authenticatorId,
        });
        await harness.importCredentials(
          states[0].authenticator,
          aliceCredentials,
        );
        await signIn(page);
        await waitForAuthState(page, "active");
        await waitSynced(page);
        await syncNow(page, "同期済み");
        const finalChanges = await harness.d1Query(
          "SELECT document_id, change_id FROM changes ORDER BY seq",
        );
        assert.equal(
          finalChanges.some(
            (row) =>
              row.document_id === aliceDocument &&
              row.change_id === pendingChangeId,
          ),
          true,
          "Alice's retained outbox drains to Alice's own document",
        );
        assert.equal(
          finalChanges.some(
            (row) =>
              row.document_id === bobDocument &&
              row.change_id === pendingChangeId,
          ),
          false,
        );
        const alicePlan = await readPlannerState(page, {
          apiOrigin: AUTH_ORIGIN,
          documentId: aliceDocument,
          accountHandle: alice.accountHandle,
        });
        assert.equal(
          JSON.stringify(alicePlan.source).includes(canary),
          true,
          "Alice's retained history returns to her own account plan",
        );
        assert.deepEqual(
          await readOutboxEntries(page, {
            apiOrigin: AUTH_ORIGIN,
            documentId: aliceDocument,
            accountHandle: alice.accountHandle,
          }),
          [],
        );
        assert.deepEqual(
          await readOutboxEntries(page, {
            apiOrigin: AUTH_ORIGIN,
            documentId: bobDocument,
            accountHandle: bob.accountHandle,
          }),
          [],
        );

        acceptBrowserFaults(states[0], [
          {
            kind: "console",
            text: /Failed to load resource: net::ERR_FAILED/u,
            count: 1,
            reason:
              "Alice's pending edit could not sync while the real API was gated offline",
          },
        ]);
      },
    );

    assert.ok(aliceCookie);
    assert.ok(aliceCsrf);
    assert.ok(aliceCredentialId);
    assert.ok(pendingChangeId);
    await harness.close();
    await assertEvidenceSanitized(harness, [
      aliceCookie,
      aliceCsrf,
      aliceCredentialId,
      pendingChangeId,
      canary,
      "X-CSRF-Token",
      "Authorization",
    ]);
    await assertHarnessCleaned(harness);
  },
);
