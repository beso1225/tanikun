// #185 failure-evidence proof. A real session journey registers a fictional
// account, then fails on purpose after the browser has real session cookies.
// The retained failure log and sanitized trace must not contain the raw session
// token, CSRF token, credential ID, or credential response fields. The
// screenshot remains a human-readable UI capture and can show fictional planner
// text and the account display name. The harness must remove its temporary
// storage and processes.

import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { waitForPersistence } from "./planner-harness.mjs";
import {
  activeSession,
  assertEvidenceSanitized,
  assertHarnessCleaned,
  assertSessionCookieFlags,
  registerAndSync,
} from "./session-proof-helpers.mjs";
import { SyncHarness, readTraceArchiveEntries } from "./sync-harness.mjs";

test(
  "a failed session journey retains sanitized failure evidence and no owned resources",
  { timeout: 300_000 },
  async (t) => {
    const harness = new SyncHarness({ mode: "session" });
    t.after(() => harness.close());
    await harness.start();
    let forbidden = [];
    const plannerCanary = "Private planner assertion canary 197";
    const urlToken = Buffer.alloc(32, 251).toString("base64url");
    const name = "session-failure-evidence";
    const label = "alice";

    await assert.rejects(
      harness.runJourneyGroup(
        name,
        [{ label, identity: "alice", session: true }],
        async ([page], _errors, states) => {
          await waitForPersistence(page);
          await registerAndSync(page, "Alice Failure Evidence");
          const account = await activeSession(page);
          const cookieState = await assertSessionCookieFlags(states[0].context);
          const credentials = await harness.exportCredentials(
            states[0].authenticator,
          );
          assert.equal(credentials.length, 1);
          forbidden = [
            plannerCanary,
            urlToken,
            cookieState.session.value,
            account.csrfToken,
            credentials[0].credentialId,
            "clientExtensionResults",
            "attestationObject",
            "authenticatorData",
            "signature",
            "userHandle",
            "X-CSRF-Token",
            "Authorization",
          ];
          assert.deepEqual(
            { planner: plannerCanary, token: urlToken },
            { planner: "different planner", token: cookieState.session.value },
          );
        },
      ),
      { code: "ERR_ASSERTION" },
    );

    const failureLog = await readFile(
      join(harness.evidenceDir, `${name}-${label}-failure.log`),
      "utf8",
    );

    assert.ok(
      (await stat(join(harness.evidenceDir, `${name}-${label}-failure.png`)))
        .size > 0,
    );
    assert.match(failureLog, /Error details omitted/u);
    assert.doesNotMatch(failureLog, /AssertionError|Expected values/u);
    const trace = await readTraceArchiveEntries(
      join(harness.evidenceDir, `${name}-${label}-failure-trace.zip`),
    );
    assert.deepEqual([...trace.keys()].toSorted(), [
      "trace.network",
      "trace.trace",
    ]);
    for (const [entryName, bytes] of trace) {
      for (const value of forbidden) {
        assert.equal(
          bytes.includes(Buffer.from(value)),
          false,
          `${entryName} retained a forbidden session value`,
        );
      }
    }
    for (const value of forbidden) {
      assert.equal(
        failureLog.includes(value),
        false,
        "the failure log retained a forbidden session value",
      );
    }
    assert.equal(
      failureLog.includes("Alice Failure Evidence"),
      false,
      "the failure log retained the account display name",
    );

    await harness.close();
    await assertEvidenceSanitized(harness, forbidden);
    await assertHarnessCleaned(harness);
  },
);
