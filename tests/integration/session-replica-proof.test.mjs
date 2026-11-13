// #185 real session-mode proof. Two isolated Chromium contexts sign in as the
// same fictional Alice account through the production Worker and WebAuthn
// verifier, converge over real HTTP sessions, and retain duplicate and reload
// behavior. Chromium's virtual authenticator supplies the passkeys. The
// disposable loopback certificate is trusted only by the harness contexts. This
// proves the local packaged/source Worker, D1, browser cookie jar, and session
// sync path. It does not prove a physical provider, screen reader, public
// deployment, or Linux execution from a Darwin host.

import assert from "node:assert/strict";
import test from "node:test";

import { waitForPersistence } from "./planner-harness.mjs";
import {
  AUTH_ORIGIN,
  SESSION_COOKIE,
  activeSession,
  assertEvidenceSanitized,
  assertHarnessCleaned,
  assertSessionCookieFlags,
  d1Counts,
  registerAndSync,
  resetReplicaToServer,
  signInNewReplica,
  waitForAuthState,
  waitForSyncText,
  waitSynced,
} from "./session-proof-helpers.mjs";
import {
  addCustomCourse,
  addOffering,
  installApiGate,
} from "./sync-browser-helpers.mjs";
import {
  assertConverged,
  readD1State,
  readOutboxEntries,
  readPlannerState,
  readSyncState,
  syncNow,
  waitFor,
} from "./sync-convergence-helpers.mjs";
import { SyncHarness, acceptBrowserFaults } from "./sync-harness.mjs";

async function waitForAccountSource(page, options, predicate, label) {
  let observed = null;
  return waitFor(
    async () => {
      observed = await readPlannerState(page, options);
      return predicate(observed);
    },
    `${label}; last state ${JSON.stringify(observed?.source ?? null)}`,
    30_000,
  ).then(() => observed);
}

test(
  "two Alice replicas converge over real session HTTP and retain duplicate and reload behavior",
  { timeout: 300_000 },
  async (t) => {
    const harness = new SyncHarness({ mode: "session" });
    t.after(() => harness.close());
    await harness.start();
    const canary = "Session replica planner canary 185";
    let cookieState = null;
    let alice = null;
    let credentialId = null;
    let aliceOffline = null;
    let beforeDuplicate = null;
    let server = null;

    await harness.runJourneyGroup(
      "session-replica",
      [
        { label: "alice-a", identity: "alice", session: true },
        { label: "alice-b", identity: "alice", session: true },
      ],
      async ([pageA, pageB], _errors, states) => {
        const [aliceA, aliceB] = states;
        await waitForPersistence(pageA);
        await waitForPersistence(pageB);
        await registerAndSync(pageA, "Alice Replica");
        await syncNow(pageA, "同期済み");
        alice = await activeSession(pageA);
        const [{ id: documentId }] = await harness.d1Query(
          "SELECT id FROM documents",
        );
        cookieState = await assertSessionCookieFlags(aliceA.context);
        assert.equal(
          await pageA.evaluate(() => document.cookie),
          "",
          "HttpOnly cookies are invisible to page script",
        );
        const credentials = await harness.exportCredentials(
          aliceA.authenticator,
        );
        assert.equal(credentials.length, 1);
        credentialId = credentials[0].credentialId;
        const aliceStart = await readPlannerState(pageA, {
          apiOrigin: AUTH_ORIGIN,
          documentId,
          accountHandle: alice.accountHandle,
        });
        assert.ok(aliceStart.source, "Alice has a committed account planner");
        assert.ok(aliceStart.metadata.mergedCursor > 0);

        await harness.importCredentials(aliceB.authenticator, credentials);
        await signInNewReplica(pageB);
        const replica = await waitForAuthState(pageB, "active");
        await resetReplicaToServer(pageB);
        assert.equal(replica.accountHandle, alice.accountHandle);
        await waitSynced(pageB);
        await syncNow(pageB, "同期済み");
        assertConverged(
          aliceStart,
          await readPlannerState(pageB, {
            apiOrigin: AUTH_ORIGIN,
            documentId,
            accountHandle: alice.accountHandle,
          }),
          "second Alice replica after discoverable sign-in",
        );
        const activeSessions = await harness.d1Query(
          "SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL",
        );
        assert.equal(Number(activeSessions[0].count), 2);
        assert.equal(
          (await harness.d1Query("SELECT id FROM documents")).length,
          1,
        );

        const gateA = await installApiGate(pageA);
        const gateB = await installApiGate(pageB);
        gateA.offline = true;
        gateB.offline = true;
        await addOffering(pageA, "phy302-s");
        await waitForPersistence(pageA);
        await addCustomCourse(pageB, canary);
        await waitForPersistence(pageB);
        await waitForSyncText(pageA, "オフライン");
        await waitForSyncText(pageB, "オフライン");
        aliceOffline = await waitForAccountSource(
          pageA,
          {
            apiOrigin: AUTH_ORIGIN,
            documentId,
            accountHandle: alice.accountHandle,
          },
          (state) =>
            state.source.enrollments.some(
              (row) => row.offering_id === "phy302-s",
            ),
          "Alice replica A committed its offline offering",
        );
        await waitForAccountSource(
          pageB,
          {
            apiOrigin: AUTH_ORIGIN,
            documentId,
            accountHandle: alice.accountHandle,
          },
          (state) => state.source.catalogue.some((row) => row.name === canary),
          "Alice replica B committed its offline custom course",
        );
        const queued = await waitFor(
          async () => {
            const entries = await readOutboxEntries(pageA, {
              apiOrigin: AUTH_ORIGIN,
              documentId,
              accountHandle: alice.accountHandle,
            });
            return entries.length > 0 ? entries : null;
          },
          "Alice replica A queued its offline change",
          10_000,
        );
        const duplicateEnvelope = queued[0].envelope;
        assert.equal(duplicateEnvelope.document_id, documentId);

        await pageA.reload();
        await waitForPersistence(pageA);
        await waitForSyncText(pageA, "オフライン");
        await pageB.reload();
        await waitForPersistence(pageB);
        await waitForSyncText(pageB, "オフライン");
        await waitForAccountSource(
          pageA,
          {
            apiOrigin: AUTH_ORIGIN,
            documentId,
            accountHandle: alice.accountHandle,
          },
          (state) =>
            state.source.enrollments.some(
              (row) => row.offering_id === "phy302-s",
            ),
          "Alice replica A offline offering survived reload",
        );
        await waitForAccountSource(
          pageB,
          {
            apiOrigin: AUTH_ORIGIN,
            documentId,
            accountHandle: alice.accountHandle,
          },
          (state) => state.source.catalogue.some((row) => row.name === canary),
          "Alice replica B offline custom course survived reload",
        );

        gateA.offline = false;
        gateB.offline = false;
        await pageA.locator("#sync-retry").click();
        await waitSynced(pageA);
        await pageB.locator("#sync-retry").click();
        await waitSynced(pageB);
        await syncNow(pageA, "同期済み");
        await syncNow(pageB, "同期済み");

        const convergedA = await readPlannerState(pageA, {
          apiOrigin: AUTH_ORIGIN,
          documentId,
          accountHandle: alice.accountHandle,
        });
        const convergedB = await readPlannerState(pageB, {
          apiOrigin: AUTH_ORIGIN,
          documentId,
          accountHandle: alice.accountHandle,
        });
        assertConverged(
          convergedA,
          convergedB,
          "two Alice replicas after exchange",
        );
        assert.ok(
          convergedA.source.enrollments.some(
            (row) => row.offering_id === "phy302-s",
          ),
        );
        assert.ok(
          convergedA.source.catalogue.some((row) => row.name === canary),
        );
        assert.equal(
          new Set(convergedA.heads).size,
          convergedA.heads.length,
          "merged Automerge heads are unique",
        );
        server = await readD1State(harness);
        const documentRow = server.documents.find(
          (row) => row.id === documentId,
        );
        assert.equal(server.changes.length, Number(documentRow.last_seq));
        assert.equal(
          new Set(server.changes.map((row) => row.change_id)).size,
          server.changes.length,
        );
        for (const page of [pageA, pageB]) {
          assert.deepEqual(
            (
              await readSyncState(page, {
                apiOrigin: AUTH_ORIGIN,
                documentId,
                accountHandle: alice.accountHandle,
              })
            ).outbox,
            [],
          );
        }

        // Retry the exact client-generated envelope twice through the real
        // session cookie and CSRF header. Both responses are idempotent and no
        // row is added.
        beforeDuplicate = await d1Counts(harness);
        const appendDuplicate = () =>
          pageA.evaluate(
            async ({ documentId: targetDocument, csrfToken, envelope }) => {
              const response = await fetch(
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
              return { status: response.status, json: await response.json() };
            },
            {
              documentId,
              csrfToken: alice.csrfToken,
              envelope: duplicateEnvelope,
            },
          );
        const first = await appendDuplicate();
        const second = await appendDuplicate();
        assert.equal(first.status, 200);
        assert.equal(second.status, 200);
        assert.deepEqual(second.json, first.json);
        assert.equal(first.json.accepted.length, 1);
        assert.deepEqual(await d1Counts(harness), beforeDuplicate);

        await pageA.reload();
        await waitForPersistence(pageA);
        await waitSynced(pageA);
        await pageB.reload();
        await waitForPersistence(pageB);
        await waitSynced(pageB);
        await syncNow(pageA, "同期済み");
        await syncNow(pageB, "同期済み");
        assertConverged(
          convergedA,
          await readPlannerState(pageA, {
            apiOrigin: AUTH_ORIGIN,
            documentId,
            accountHandle: alice.accountHandle,
          }),
          "Alice replica A after reload",
        );
        assertConverged(
          convergedA,
          await readPlannerState(pageB, {
            apiOrigin: AUTH_ORIGIN,
            documentId,
            accountHandle: alice.accountHandle,
          }),
          "Alice replica B after reload",
        );
        assert.deepEqual(await readD1State(harness), server);
        assert.ok(
          aliceOffline.source.enrollments.some(
            (row) => row.offering_id === "phy302-s",
          ),
        );

        acceptBrowserFaults(states[0], [
          {
            kind: "console",
            text: /Failed to load resource: net::ERR_FAILED/u,
            count: 3,
            reason:
              "Alice replica A edited and reloaded while the real API was gated offline",
          },
        ]);
        acceptBrowserFaults(states[1], [
          {
            kind: "console",
            text: /Failed to load resource: net::ERR_FAILED/u,
            count: 3,
            reason:
              "Alice replica B edited and reloaded while the real API was gated offline",
          },
        ]);
      },
    );

    assert.ok(cookieState?.session?.value);
    assert.ok(alice?.accountHandle);
    assert.ok(credentialId);
    await harness.close();
    await assertEvidenceSanitized(harness, [
      cookieState.session.value,
      alice.csrfToken,
      credentialId,
      canary,
      "clientExtensionResults",
      "attestationObject",
      "authenticatorData",
      "signature",
      "userHandle",
      "X-CSRF-Token",
      "Authorization",
    ]);
    await assertHarnessCleaned(harness);
    assert.equal(SESSION_COOKIE.startsWith("__Host-"), true);
  },
);
