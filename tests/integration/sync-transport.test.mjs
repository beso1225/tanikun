import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as shared from "../../packages/sync-contract/contract.mjs";
import {
  buildSyncContract,
  syncContractSource,
} from "../../scripts/build-sync-contract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = JSON.parse(
  readFileSync(join(root, "docs/contracts/sync-v1.json"), "utf8"),
);
const documentId = fixture.document_id;
const token = "local-fixture-token-alice";
const baseUrl = fixture.environment.api_origin;

// Build the same two-file browser artifact that `just build-web` produces.
// Importing the copy proves the module resolves the shared contract and that
// tests do not reach into packages/ from the browser path.
const artifactDir = mkdtempSync(join(tmpdir(), "tanikun-sync-transport-"));
after(() => rmSync(artifactDir, { recursive: true, force: true }));
copyFileSync(
  join(root, "apps/web/public/sync-transport.js"),
  join(artifactDir, "sync-transport.js"),
);
buildSyncContract(join(artifactDir, "sync-contract.mjs"));
const {
  createSyncTransport,
  SYNC_TRANSPORT_KINDS: K,
  SYNC_LIMITS,
} = await import(pathToFileURL(join(artifactDir, "sync-transport.js")).href);

const caseByName = (name) => {
  const found = fixture.cases.find((entry) => entry.name === name);
  assert.ok(found, `missing fixture case ${name}`);
  return found;
};

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function responseFrom(row) {
  return new Response(JSON.stringify(row.response.body), {
    status: row.response.status,
    headers: row.response.headers,
  });
}

function scriptedFetch(respond) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return respond(calls.length - 1);
  };
  return { calls, fetch };
}

function transportFor(fetch, options = {}) {
  return createSyncTransport({
    fetch,
    baseUrl,
    token,
    timeoutMs: 1_000,
    ...options,
  });
}

function hangingFetch() {
  const calls = [];
  return {
    calls,
    fetch(url, init) {
      calls.push({ url, init });
      return new Promise((_, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      });
    },
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

test("rejects a base URL with a path, query, or fragment", () => {
  for (const invalid of [
    "https://host.example/sync",
    "https://host.example?tenant=1",
    "https://host.example#fragment",
  ]) {
    assert.throws(
      () =>
        createSyncTransport({
          fetch: async () => {},
          baseUrl: invalid,
          token,
        }),
      /baseUrl must not include a path, query, or fragment/,
    );
  }
});

test("the browser artifact uses the shared contract module unchanged", () => {
  assert.equal(
    readFileSync(join(artifactDir, "sync-contract.mjs"), "utf8"),
    readFileSync(syncContractSource, "utf8"),
  );
  assert.deepEqual(SYNC_LIMITS, shared.SYNC_LIMITS);
  assert.match(
    readFileSync(join(root, "apps/web/public/sync-transport.js"), "utf8"),
    /from "\.\/sync-contract\.mjs"/,
  );
});

test("bootstrap parses the exact ADR fixture response", async () => {
  const row = caseByName("bootstrap-new");
  const { calls, fetch } = scriptedFetch(() => responseFrom(row));
  const result = await transportFor(fetch).bootstrap();
  assert.deepEqual(result, { kind: K.BOOTSTRAPPED, ...row.response.body });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${baseUrl}${row.request.path}`);
  assert.equal(calls[0].init.method, row.request.method);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[0].init.headers.Accept, "application/json");
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.body, undefined);
});

test("push sends the fixture envelope batch and parses acceptance", async () => {
  const row = caseByName("append");
  const changes = deepFreeze(structuredClone(row.request.body.changes));
  const { calls, fetch } = scriptedFetch(() => responseFrom(row));
  const result = await transportFor(fetch).push(documentId, changes);
  assert.deepEqual(result, { kind: K.PUSHED, ...row.response.body });
  assert.deepEqual(JSON.parse(calls[0].init.body), row.request.body);
  assert.equal(calls[0].url, `${baseUrl}${row.request.path}`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(changes, row.request.body.changes);
});

test("push treats a duplicate envelope as an acknowledged success", async () => {
  const row = caseByName("duplicate");
  const { fetch } = scriptedFetch(() => responseFrom(row));
  const result = await transportFor(fetch).push(
    documentId,
    structuredClone(row.request.body.changes),
  );
  assert.deepEqual(result, { kind: K.PUSHED, ...row.response.body });
  assert.deepEqual(result.accepted, [
    {
      change_id: fixture.envelope.change_id,
      server_sequence: 1,
    },
  ]);
});

test("push reports same-hash different-bytes as a conflict", async () => {
  const row = caseByName("conflict-rolls-back-new-row");
  const { calls, fetch } = scriptedFetch(() => responseFrom(row));
  const result = await transportFor(fetch).push(
    documentId,
    structuredClone(row.request.body.changes),
  );
  assert.deepEqual(result, {
    kind: K.CONFLICT,
    status: 409,
    code: "change_conflict",
    retryable: false,
  });
  assert.equal(calls.length, 1);
});

test("pull parses an ordered fixture page", async () => {
  const row = caseByName("pull");
  const { calls, fetch } = scriptedFetch(() => responseFrom(row));
  const result = await transportFor(fetch).pull(documentId, {
    after: 0,
    limit: 100,
  });
  assert.deepEqual(result, { kind: K.PULLED, ...row.response.body });
  assert.equal(calls[0].url, `${baseUrl}${row.request.path}`);
});

test("pull preserves has_more and cursor fields on a partial page", async () => {
  const row = caseByName("paged-pull");
  const { fetch } = scriptedFetch(() => responseFrom(row));
  const result = await transportFor(fetch).pull(documentId, {
    after: 0,
    limit: 1,
  });
  assert.deepEqual(result, { kind: K.PULLED, ...row.response.body });
  assert.equal(result.next_cursor, 1);
  assert.equal(result.has_more, true);
  assert.equal(result.cursor, 2);
});

test("pull parses the empty page at the cursor", async () => {
  const row = caseByName("empty-page");
  const { fetch } = scriptedFetch(() => responseFrom(row));
  const result = await transportFor(fetch).pull(documentId, {
    after: 1,
    limit: 100,
  });
  assert.deepEqual(result, { kind: K.PULLED, ...row.response.body });
  assert.deepEqual(result.changes, []);
});

test("push enforces shared batch, payload, and body limits before fetch", async () => {
  const { calls, fetch } = scriptedFetch(() => assert.fail("unexpected fetch"));
  const transport = transportFor(fetch);
  assert.deepEqual(await transport.push(documentId, []), {
    kind: K.INVALID_REQUEST,
    code: "malformed_request",
    retryable: false,
  });
  const tooMany = await transport.push(
    documentId,
    Array.from({ length: SYNC_LIMITS.maxBatchChanges + 1 }, () =>
      structuredClone(fixture.envelope),
    ),
  );
  assert.equal(tooMany.kind, K.INVALID_REQUEST);
  assert.equal(tooMany.code, "request_too_large");
  const tooLarge = await transport.push(documentId, [
    {
      ...fixture.envelope,
      payload: btoa("x".repeat(SYNC_LIMITS.maxPayloadBytes + 1)),
    },
  ]);
  assert.equal(tooLarge.kind, K.INVALID_REQUEST);
  assert.equal(tooLarge.code, "request_too_large");
  const largeBody = Array.from({ length: SYNC_LIMITS.maxBatchChanges }, () => ({
    ...fixture.envelope,
    payload: btoa("y".repeat(SYNC_LIMITS.maxPayloadBytes)),
  }));
  const bodyResult = await transport.push(documentId, largeBody);
  assert.equal(bodyResult.kind, K.INVALID_REQUEST);
  assert.equal(bodyResult.code, "request_too_large");
  assert.equal(calls.length, 0);
});

test("pull validates document, cursor, and page size before fetch", async () => {
  const { calls, fetch } = scriptedFetch(() => assert.fail("unexpected fetch"));
  const transport = transportFor(fetch);
  for (const [id, options] of [
    ["not-a-uuid", {}],
    [documentId, { after: -1 }],
    [documentId, { after: 1.5 }],
    [documentId, { after: Number.MAX_SAFE_INTEGER + 1 }],
    [documentId, { limit: 0 }],
    [documentId, { limit: SYNC_LIMITS.maxPageChanges + 1 }],
    [documentId, { limit: 1.5 }],
  ]) {
    const result = await transport.pull(id, options);
    assert.deepEqual(result, {
      kind: K.INVALID_REQUEST,
      code: "malformed_request",
      retryable: false,
    });
  }
  const invalidPush = await transport.push("not-a-uuid", [fixture.envelope]);
  assert.equal(invalidPush.kind, K.INVALID_REQUEST);
  assert.equal(invalidPush.code, "malformed_request");
  const malformedEnvelope = await transport.push(documentId, [{}]);
  assert.equal(malformedEnvelope.kind, K.INVALID_REQUEST);
  assert.equal(malformedEnvelope.code, "malformed_request");
  assert.equal(calls.length, 0);
});

test("401 and 404 map to explicit terminal results", async () => {
  const unauthorized = caseByName("unauthorized");
  const unauthorizedResult = await transportFor(
    scriptedFetch(() => responseFrom(unauthorized)).fetch,
  ).bootstrap();
  assert.deepEqual(unauthorizedResult, {
    kind: K.UNAUTHORIZED,
    status: 401,
    code: "unauthorized",
    retryable: false,
  });
  const missing = caseByName("foreign-document");
  const missingResult = await transportFor(
    scriptedFetch(() => responseFrom(missing)).fetch,
  ).pull(fixture.foreign_document_id);
  assert.deepEqual(missingResult, {
    kind: K.NOT_FOUND,
    status: 404,
    code: "not_found",
    retryable: false,
  });
});

test("cursor conflicts keep the server cursor", async () => {
  const ahead = caseByName("cursor-ahead");
  const aheadResult = await transportFor(
    scriptedFetch(() => responseFrom(ahead)).fetch,
  ).pull(documentId, { after: 2 });
  assert.deepEqual(aheadResult, {
    kind: K.CONFLICT,
    status: 409,
    code: "cursor_ahead",
    cursor: 1,
    retryable: false,
  });
  const gap = caseByName("log-gap");
  const gapResult = await transportFor(
    scriptedFetch(() => responseFrom(gap)).fetch,
  ).pull(documentId);
  assert.deepEqual(gapResult, {
    kind: K.CONFLICT,
    status: 409,
    code: "log_gap",
    cursor: 2,
    retryable: false,
  });
});

test("413 and 5xx results expose the code and retryability", async () => {
  const tooLarge = caseByName("oversized-batch");
  const tooLargeResult = await transportFor(
    scriptedFetch(() => responseFrom(tooLarge)).fetch,
  ).push(
    documentId,
    structuredClone(caseByName("append").request.body.changes),
  );
  assert.deepEqual(tooLargeResult, {
    kind: K.REQUEST_REJECTED,
    status: 413,
    code: "request_too_large",
    retryable: false,
  });
  const unavailable = { error: { code: "temporarily_unavailable" } };
  const unavailableResult = await transportFor(
    scriptedFetch(() => jsonResponse(unavailable, { status: 503 })).fetch,
  ).bootstrap();
  assert.deepEqual(unavailableResult, {
    kind: K.SERVER_ERROR,
    status: 503,
    code: "temporarily_unavailable",
    retryable: true,
  });
  const retryResult = await transportFor(
    scriptedFetch(() =>
      jsonResponse(unavailable, {
        status: 503,
        headers: { "Retry-After": "30" },
      }),
    ).fetch,
  ).bootstrap();
  assert.deepEqual(retryResult, {
    kind: K.SERVER_ERROR,
    status: 503,
    code: "temporarily_unavailable",
    retryable: true,
    retry_after: 30,
  });
  const invalidRetryResult = await transportFor(
    scriptedFetch(() =>
      jsonResponse(unavailable, {
        status: 503,
        headers: { "Retry-After": "soon" },
      }),
    ).fetch,
  ).bootstrap();
  assert.deepEqual(invalidRetryResult, {
    kind: K.SERVER_ERROR,
    status: 503,
    code: "temporarily_unavailable",
    retryable: true,
  });
  const exhausted = fixture.sequence_allocation_cases.find(
    (entry) => entry.name === "exhausted-counter",
  );
  assert.ok(exhausted);
  const exhaustedResult = await transportFor(
    scriptedFetch(() =>
      jsonResponse(exhausted.body, { status: exhausted.status }),
    ).fetch,
  ).bootstrap();
  assert.deepEqual(exhaustedResult, {
    kind: K.SERVER_ERROR,
    status: 503,
    code: "sequence_exhausted",
    retryable: false,
  });
});

test("network failure, timeout, and caller abort are distinct", async () => {
  const offlineResult = await transportFor(async () => {
    throw new TypeError("failed to fetch");
  }).bootstrap();
  assert.deepEqual(offlineResult, { kind: K.OFFLINE, retryable: true });
  const timeoutFetch = hangingFetch();
  const timeoutResult = await createSyncTransport({
    fetch: timeoutFetch.fetch,
    baseUrl,
    token,
    timeoutMs: 5,
  }).bootstrap();
  assert.deepEqual(timeoutResult, { kind: K.TIMEOUT, retryable: true });
  const abortFetch = hangingFetch();
  const controller = new AbortController();
  const pending = createSyncTransport({
    fetch: abortFetch.fetch,
    baseUrl,
    token,
    timeoutMs: 1_000,
  }).bootstrap({ signal: controller.signal });
  controller.abort();
  assert.deepEqual(await pending, { kind: K.ABORTED, retryable: false });
  const bodyAbortFetch = (() => {
    const calls = [];
    return {
      calls,
      fetch(url, init) {
        calls.push({ url, init });
        const body = new ReadableStream({
          start(streamController) {
            init.signal.addEventListener(
              "abort",
              () => streamController.error(new Error("aborted")),
              { once: true },
            );
          },
        });
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    };
  })();
  const bodyController = new AbortController();
  const bodyPending = transportFor(bodyAbortFetch.fetch).bootstrap({
    signal: bodyController.signal,
  });
  await new Promise((finish) => setTimeout(finish, 0));
  bodyController.abort();
  assert.deepEqual(await bodyPending, {
    kind: K.ABORTED,
    retryable: false,
  });
  const bodyFailureResult = await transportFor(
    async () =>
      new Response(
        new ReadableStream({
          start(streamController) {
            streamController.error(new TypeError("body failed"));
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  ).bootstrap();
  assert.deepEqual(bodyFailureResult, {
    kind: K.OFFLINE,
    retryable: true,
  });
  const preAbortedFetch = hangingFetch();
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  assert.deepEqual(
    await createSyncTransport({
      fetch: preAbortedFetch.fetch,
      baseUrl,
      token,
      timeoutMs: 1_000,
    }).bootstrap({ signal: alreadyAborted.signal }),
    { kind: K.ABORTED, retryable: false },
  );
  assert.equal(preAbortedFetch.calls.length, 0);
});

test("malformed JSON, content type, and envelopes are explicit results", async () => {
  const valid = caseByName("pull").response.body;
  for (const respond of [
    () =>
      new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    () =>
      new Response(JSON.stringify(valid), {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    () =>
      new Response(JSON.stringify(valid), {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      }),
  ]) {
    const result = await transportFor(scriptedFetch(respond).fetch).pull(
      documentId,
    );
    assert.deepEqual(result, { kind: K.MALFORMED_RESPONSE, retryable: false });
  }
  const badEnvelope = structuredClone(valid);
  badEnvelope.changes[0].payload = "?";
  const envelopeResult = await transportFor(
    scriptedFetch(() => jsonResponse(badEnvelope)).fetch,
  ).pull(documentId);
  assert.deepEqual(envelopeResult, {
    kind: K.MALFORMED_RESPONSE,
    retryable: false,
  });
  const skippedSequence = structuredClone(valid);
  skippedSequence.changes[0].server_sequence = 2;
  const gapResult = await transportFor(
    scriptedFetch(() => jsonResponse(skippedSequence)).fetch,
  ).pull(documentId);
  assert.deepEqual(gapResult, {
    kind: K.MALFORMED_RESPONSE,
    retryable: false,
  });
  const wrongDocument = structuredClone(valid);
  wrongDocument.document_id = fixture.foreign_document_id;
  const documentResult = await transportFor(
    scriptedFetch(() => jsonResponse(wrongDocument)).fetch,
  ).pull(documentId);
  assert.deepEqual(documentResult, {
    kind: K.MALFORMED_RESPONSE,
    retryable: false,
  });
  const inconsistent = structuredClone(valid);
  inconsistent.has_more = !inconsistent.has_more;
  const cursorResult = await transportFor(
    scriptedFetch(() => jsonResponse(inconsistent)).fetch,
  ).pull(documentId);
  assert.deepEqual(cursorResult, {
    kind: K.MALFORMED_RESPONSE,
    retryable: false,
  });
  const missingAcceptance = structuredClone(caseByName("append").response.body);
  missingAcceptance.accepted = [];
  const pushResult = await transportFor(
    scriptedFetch(() => jsonResponse(missingAcceptance)).fetch,
  ).push(
    documentId,
    structuredClone(caseByName("append").request.body.changes),
  );
  assert.deepEqual(pushResult, {
    kind: K.MALFORMED_RESPONSE,
    retryable: false,
  });

  const duplicateDocument = `{"document_id":"${documentId}","document_id":"${documentId}","cursor":0}`;
  const duplicateResult = await transportFor(
    scriptedFetch(
      () =>
        new Response(duplicateDocument, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ).fetch,
  ).bootstrap();
  assert.deepEqual(duplicateResult, {
    kind: K.MALFORMED_RESPONSE,
    retryable: false,
  });

  const unauthorizedWithCursor = jsonResponse(
    { error: { code: "unauthorized" }, cursor: 0 },
    { status: 401 },
  );
  const cursorShapeResult = await transportFor(
    scriptedFetch(() => unauthorizedWithCursor).fetch,
  ).bootstrap();
  assert.deepEqual(cursorShapeResult, {
    kind: K.MALFORMED_RESPONSE,
    retryable: false,
  });

  const gapWithoutCursor = jsonResponse(
    { error: { code: "log_gap" } },
    { status: 409 },
  );
  const gapShapeResult = await transportFor(
    scriptedFetch(() => gapWithoutCursor).fetch,
  ).pull(documentId, { after: 2 });
  assert.deepEqual(gapShapeResult, {
    kind: K.MALFORMED_RESPONSE,
    retryable: false,
  });

  const oversizedBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(SYNC_LIMITS.maxResponseBytes + 1));
      controller.close();
    },
  });
  const oversizedResponse = new Response(oversizedBody, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  const oversizedResult = await transportFor(
    scriptedFetch(() => oversizedResponse).fetch,
  ).bootstrap();
  assert.deepEqual(oversizedResult, {
    kind: K.MALFORMED_RESPONSE,
    retryable: false,
  });
});

test("transport does not read local state or log request bytes", async () => {
  const row = caseByName("pull");
  const guarded = [
    "indexedDB",
    "localStorage",
    "sessionStorage",
    "document",
    "Automerge",
    "tanikunStorage",
  ];
  const previous = new Map();
  for (const key of guarded) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      get() {
        throw new Error(`transport accessed ${key}`);
      },
    });
  }
  const methods = ["log", "info", "warn", "error", "debug"];
  const output = [];
  const original = {};
  for (const method of methods) {
    original[method] = console[method];
    console[method] = (...args) => {
      output.push(args);
    };
  }
  try {
    const result = await transportFor(
      scriptedFetch(() => responseFrom(row)).fetch,
    ).pull(documentId);
    assert.equal(result.kind, K.PULLED);
  } finally {
    for (const method of methods) console[method] = original[method];
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
  assert.deepEqual(output, []);
});
