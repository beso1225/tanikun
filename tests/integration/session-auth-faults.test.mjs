// #185 real browser authentication-fault proof. Registration and sign-in run
// through the production WebAuthn endpoints and verifier in Chromium with a
// virtual authenticator. The test replays a consumed challenge, tampers with a
// challenge and binding, exercises CSRF and Origin rejection with the real
// cookie jar, revokes a session by logout, and expires a session in D1. It
// asserts rejected requests leave no account, credential, session, document, or
// change writes, then checks sanitized evidence and owned teardown.

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
  captureNextRequest,
  d1Counts,
  postFromBrowserContext,
  postJsonFromPage,
  registerAndSync,
  restoreCookie,
  sessionCookies,
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

test(
  "real browser sessions reject replayed challenges, CSRF, and Origin without writes",
  { timeout: 300_000 },
  async (t) => {
    const harness = new SyncHarness({ mode: "session" });
    t.after(() => harness.close());
    await harness.start();
    const canary = "Session auth fault planner canary 185";
    let cookieState = null;
    let alice = null;
    let credentialId = null;
    let challengeId = null;
    let registrationSession = null;
    let registrationCsrf = null;
    let expiredSession = null;
    let expiredCsrf = null;

    await harness.runJourneyGroup(
      "session-auth-faults",
      [{ label: "alice", identity: "alice", session: true }],
      async ([page], _errors, states) => {
        await waitForPersistence(page);
        const empty = await d1Counts(harness);
        assert.equal(empty.users, 0);
        assert.equal(empty.challenges, 0);

        // A page fetch cannot override the browser-controlled Origin header.
        // The context request keeps Chromium's cookie jar and TLS settings and
        // sends one explicit hostile Origin to the real Worker.
        const originOptions = await postFromBrowserContext(
          states[0].context,
          "/api/v1/auth/register/options",
          {
            origin: "https://evil.example",
            body: { display_name: "Origin Probe" },
          },
        );
        assert.equal(originOptions.status, 403);
        assert.deepEqual(originOptions.json, {
          error: { code: "origin_forbidden" },
        });
        assert.deepEqual(await d1Counts(harness), empty);

        const captured = await captureNextRequest(
          page,
          "**/api/v1/auth/register/verify",
          async (request) => {
            // This challenge is still unused and the browser has signed it.
            // Reject the wrong binding, then let the identical request succeed
            // with its original binding to isolate the binding check.
            const { binding } = await sessionCookies(states[0].context);
            assert.ok(binding);
            const beforeWrongBinding = await d1Counts(harness);
            await restoreCookie(states[0].context, {
              ...binding,
              value: "B".repeat(43),
            });
            try {
              const wrongBinding = await postFromBrowserContext(
                states[0].context,
                "/api/v1/auth/register/verify",
                { body: JSON.parse(request.body) },
              );
              assert.equal(wrongBinding.status, 401);
              assert.deepEqual(wrongBinding.json, {
                error: { code: "authentication_failed" },
              });
              assert.deepEqual(await d1Counts(harness), beforeWrongBinding);
              assert.equal(
                (await sessionCookies(states[0].context)).session,
                null,
              );
            } finally {
              await restoreCookie(states[0].context, binding);
            }
          },
        );
        await registerAndSync(page, "Alice Auth Faults");
        await captured.stop();
        const registrationRequest = captured.get();
        assert.ok(registrationRequest?.body, "captured the registration body");
        const registrationBody = JSON.parse(registrationRequest.body);
        challengeId = registrationBody.challenge_id;
        assert.match(challengeId, /^[A-Za-z0-9_-]{22}$/u);
        alice = await activeSession(page);
        const [{ id: documentId }] = await harness.d1Query(
          "SELECT id FROM documents",
        );
        cookieState = await assertSessionCookieFlags(states[0].context);
        registrationSession = cookieState.session.value;
        registrationCsrf = alice.csrfToken;
        const credentials = await harness.exportCredentials(
          states[0].authenticator,
        );
        assert.equal(credentials.length, 1);
        credentialId = credentials[0].credentialId;
        assert.equal(
          JSON.stringify(registrationBody).includes("clientExtensionResults"),
          false,
        );
        assert.equal(JSON.stringify(registrationBody).includes("prf"), false);

        const gate = await installApiGate(page);
        gate.offline = true;
        await addCustomCourse(page, canary);
        await waitForPersistence(page);
        await waitForSyncText(page, "オフライン");
        const queued = await waitFor(
          async () => {
            const entries = await readOutboxEntries(page, {
              apiOrigin: AUTH_ORIGIN,
              documentId,
              accountHandle: alice.accountHandle,
            });
            return entries.length > 0 ? entries : null;
          },
          "the session account queued a planner change",
          10_000,
        );
        const envelope = queued[0].envelope;
        gate.offline = false;

        const path = `/api/v1/sync/documents/${documentId}/changes`;
        const beforeRejection = await d1Counts(harness);
        const missing = await postJsonFromPage(page, path, {
          body: { changes: [envelope] },
        });
        assert.equal(missing.status, 403);
        assert.deepEqual(missing.json, { error: { code: "csrf_forbidden" } });
        const wrong = await postJsonFromPage(page, path, {
          csrfToken: "C".repeat(43),
          body: { changes: [envelope] },
        });
        assert.equal(wrong.status, 403);
        assert.deepEqual(wrong.json, { error: { code: "csrf_forbidden" } });
        const originAppend = await postFromBrowserContext(
          states[0].context,
          path,
          {
            origin: "https://evil.example",
            csrfToken: alice.csrfToken,
            body: { changes: [envelope] },
          },
        );
        assert.equal(originAppend.status, 403);
        assert.deepEqual(originAppend.json, {
          error: { code: "origin_forbidden" },
        });
        assert.deepEqual(await d1Counts(harness), beforeRejection);
        const valid = await postJsonFromPage(page, path, {
          csrfToken: alice.csrfToken,
          body: { changes: [envelope] },
        });
        assert.equal(valid.status, 200);
        assert.equal(valid.json.accepted.length, 1);

        const replayBefore = await d1Counts(harness);
        const cookies = await sessionCookies(states[0].context);
        assert.ok(cookies.session);
        assert.ok(cookies.binding);
        await states[0].context.clearCookies({ name: SESSION_COOKIE });
        const replay = await postJsonFromPage(
          page,
          "/api/v1/auth/register/verify",
          { body: registrationBody },
        );
        assert.equal(replay.status, 401);
        assert.deepEqual(replay.json, {
          error: { code: "authentication_failed" },
        });
        assert.deepEqual(await d1Counts(harness), replayBefore);

        const tampered = structuredClone(registrationBody);
        tampered.challenge_id = "A".repeat(22);
        const invalid = await postJsonFromPage(
          page,
          "/api/v1/auth/register/verify",
          { body: tampered },
        );
        assert.equal(invalid.status, 401);
        assert.deepEqual(invalid.json, {
          error: { code: "authentication_failed" },
        });
        assert.deepEqual(await d1Counts(harness), replayBefore);

        await restoreCookie(states[0].context, cookies.session);

        const logoutSession = (await sessionCookies(states[0].context)).session;
        assert.ok(logoutSession);
        const beforeLogout = await d1Counts(harness);
        await signOut(page);
        await waitForAuthState(page, "signed_out");
        const revoked = await harness.d1Query(
          "SELECT revoke_reason FROM sessions WHERE revoked_at IS NOT NULL",
        );
        assert.equal(revoked.length >= 1, true);
        assert.equal(
          revoked.some((row) => row.revoke_reason === "logout"),
          true,
        );
        await restoreCookie(states[0].context, logoutSession);
        const revokedRead = await postJsonFromPage(
          page,
          "/api/v1/auth/session",
          { method: "GET" },
        );
        assert.equal(revokedRead.status, 401);
        assert.deepEqual(revokedRead.json, { error: { code: "unauthorized" } });
        const afterRevokedRead = await sessionCookies(states[0].context);
        assert.equal(afterRevokedRead.session, null);
        const afterLogout = await d1Counts(harness);
        assert.equal(afterLogout.documents, beforeLogout.documents);
        assert.equal(afterLogout.changes, beforeLogout.changes);
        assert.equal(afterLogout.credentials, beforeLogout.credentials);

        await signIn(page);
        const signedInAgain = await waitForAuthState(page, "active");
        assert.equal(signedInAgain.accountHandle, alice.accountHandle);
        await waitSynced(page);
        await syncNow(page, "同期済み");
        const renewed = await activeSession(page);
        expiredSession = (await sessionCookies(states[0].context)).session
          .value;
        expiredCsrf = renewed.csrfToken;
        const beforeExpiry = await d1Counts(harness);
        await harness.d1Query(
          `UPDATE sessions
              SET created_at = 0, last_seen_at = 0, expires_at = 43200000,
                  idle_expires_at = 1800000
            WHERE revoked_at IS NULL`,
        );
        const unauthorizedStatus = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/v1/auth/session" &&
            response.status() === 401,
          { timeout: 30_000 },
        );
        await page.reload();
        assert.equal((await unauthorizedStatus).status(), 401);
        await waitForPersistence(page);
        const expired = await waitForAuthState(page, "reauth_required");
        assert.equal(expired.generation, renewed.generation);
        assert.equal(expired.accountHandle, alice.accountHandle);
        assert.equal((await sessionCookies(states[0].context)).session, null);
        const localPlan = await readPlannerState(page, {
          apiOrigin: AUTH_ORIGIN,
          documentId,
          accountHandle: alice.accountHandle,
        });
        assert.ok(localPlan.source, "the account plan stays locally readable");
        assert.ok(Array.isArray(localPlan.source.enrollments));
        assert.ok(Array.isArray(localPlan.source.catalogue));
        const afterExpiry = await d1Counts(harness);
        assert.equal(afterExpiry.changes, beforeExpiry.changes);
        assert.equal(afterExpiry.credentials, beforeExpiry.credentials);
        assert.equal(afterExpiry.documents, beforeExpiry.documents);

        acceptBrowserFaults(states[0], [
          {
            kind: "console",
            text: /Failed to load resource: net::ERR_FAILED/u,
            count: 1,
            reason:
              "the auth-fault account edited while the real API was gated offline",
          },
          {
            kind: "console",
            text: /Failed to load resource: the server responded with a status of 403/u,
            count: 2,
            reason:
              "the real Worker rejected the missing and wrong CSRF tokens on page writes",
          },
          {
            kind: "console",
            text: /Failed to load resource: the server responded with a status of 401/u,
            count: 4,
            reason:
              "the real Worker rejected replay, tamper, revoked, and expired sessions",
          },
        ]);
      },
    );

    assert.ok(alice);
    assert.ok(credentialId);
    assert.ok(challengeId);
    assert.ok(registrationSession);
    assert.ok(registrationCsrf);
    assert.ok(expiredSession);
    assert.ok(expiredCsrf);
    await harness.close();
    await assertEvidenceSanitized(harness, [
      registrationSession,
      registrationCsrf,
      expiredSession,
      expiredCsrf,
      credentialId,
      challengeId,
      canary,
      "Alice Auth Faults",
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
