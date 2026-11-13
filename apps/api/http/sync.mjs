import {
  SYNC_LIMITS,
  requireDocumentId,
} from "../../../packages/sync-contract/contract.mjs";
import { createChangeRepository } from "../repositories/changes.mjs";
import {
  createSessionAdmission,
  assertSessionOrigin,
} from "../session/admission.mjs";
import { appendSetCookies, clearSessionCookie } from "../session/cookies.mjs";
import { readSessionAuthConfig } from "../webauthn/config.mjs";
import { assertOrigin, readDevEnvironment, resolveIdentity } from "./auth.mjs";
import { ApiError, methodNotAllowed } from "./errors.mjs";
import { assertEmptyBody, parsePagination, readJsonBody } from "./json.mjs";
import {
  emptyResponse,
  errorResponse,
  jsonResponse,
  sessionErrorResponse,
  withCors,
} from "./respond.mjs";

const bootstrapPath = "/api/v1/sync/document";
const changesPath = /^\/api\/v1\/sync\/documents\/([^/]+)\/changes$/;

function matchDevRoute(pathname) {
  if (pathname === bootstrapPath)
    return { kind: "bootstrap", methods: ["GET"], allow: "GET, OPTIONS" };
  const match = changesPath.exec(pathname);
  if (match)
    return {
      kind: "changes",
      documentId: match[1],
      methods: ["GET", "POST"],
      allow: "GET, POST, OPTIONS",
    };
  return null;
}

// Session mode has no preflight, and bootstrap is a POST-only provisioning
// operation. GET on the old bootstrap path receives 405 with Allow: POST.
function matchSessionRoute(pathname) {
  if (pathname === bootstrapPath)
    return { kind: "bootstrap", methods: ["POST"], allow: "POST" };
  const match = changesPath.exec(pathname);
  if (match)
    return {
      kind: "changes",
      documentId: match[1],
      methods: ["GET", "POST"],
      allow: "GET, POST",
    };
  return null;
}

function preflight(request, route) {
  const method = request.headers.get("Access-Control-Request-Method");
  if (method === null || !route.methods.includes(method))
    throw new ApiError("origin_forbidden");
  const requestedHeaders = request.headers.get(
    "Access-Control-Request-Headers",
  );
  if (requestedHeaders !== null) {
    for (const header of requestedHeaders.split(",")) {
      const name = header.trim().toLowerCase();
      if (name && name !== "authorization" && name !== "content-type")
        throw new ApiError("origin_forbidden");
    }
  }
  return emptyResponse(204, {
    "Access-Control-Allow-Methods": method,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "0",
  });
}

function assertJsonRequest(request) {
  const contentType = request.headers.get("Content-Type");
  if (contentType === null) throw new ApiError("unsupported_media_type");
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json")
    throw new ApiError("unsupported_media_type");
}

function assertNoQuery(url) {
  if (url.searchParams.toString() !== "")
    throw new ApiError("malformed_request");
}

function appendChanges(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Object.hasOwn(body, "changes")
  )
    throw new ApiError("malformed_request");
  const changes = body.changes;
  if (!Array.isArray(changes) || changes.length === 0)
    throw new ApiError("malformed_request");
  if (changes.length > SYNC_LIMITS.maxBatchChanges)
    throw new ApiError("request_too_large");
  return changes;
}

async function dispatchDev(request, env) {
  // ADR-0014 order: local gate, Origin, route existence, preflight, bearer,
  // method, owned resource, media type, size/syntax, operation. The explicit
  // AUTH_MODE=dev_bearer gate is part of readDevEnvironment.
  const dev = readDevEnvironment(request, env);
  if (!dev) throw new ApiError("not_found");
  assertOrigin(request);
  const url = new URL(request.url);
  const route = matchDevRoute(url.pathname);
  if (!route) throw new ApiError("not_found");
  if (request.method === "OPTIONS") return preflight(request, route);
  const identity = resolveIdentity(request, dev);
  if (!route.methods.includes(request.method))
    throw methodNotAllowed(route.allow);

  // Test-only fixture hook: the golden-fixture bootstrap-new case sets this
  // so its server-generated document is deterministic. Session mode rejects it
  // in configuration; production, preview, and default configs never set it.
  const repository = createChangeRepository(
    env.DB,
    typeof env.TEST_NEW_DOCUMENT_ID === "string" &&
      env.TEST_NEW_DOCUMENT_ID.length > 0
      ? { newDocumentId: () => env.TEST_NEW_DOCUMENT_ID }
      : undefined,
  );
  if (route.kind === "bootstrap") {
    assertNoQuery(url);
    return jsonResponse(200, await repository.bootstrap(identity.ownerId));
  }

  requireDocumentId(route.documentId);
  await repository.findOwnedDocument(identity.ownerId, route.documentId);
  if (request.method === "POST") {
    assertJsonRequest(request);
    assertNoQuery(url);
    const body = await readJsonBody(request, SYNC_LIMITS.maxRequestBytes);
    const changes = appendChanges(body);
    return jsonResponse(
      200,
      await repository.append(identity.ownerId, route.documentId, changes),
    );
  }

  const page = parsePagination(url);
  return jsonResponse(
    200,
    await repository.pull(identity.ownerId, route.documentId, page),
  );
}

async function dispatchSession(request, env, dependencies) {
  // PHASE_5 rejection order: mode/config gate, Origin, route, method, session,
  // CSRF, rate, owned resource/body, operation. The configuration gate is the
  // first check and failure is indistinguishable from an unknown route.
  const config = readSessionAuthConfig(env);
  if (!config) throw new ApiError("not_found");

  assertSessionOrigin(request, config);
  const url = new URL(request.url);
  const route = matchSessionRoute(url.pathname);
  if (!route) throw new ApiError("not_found");
  if (!route.methods.includes(request.method))
    throw methodNotAllowed(route.allow);

  const admission = createSessionAdmission({
    db: env.DB,
    ...(dependencies.now ? { now: dependencies.now } : {}),
  });
  // This is the #180/#181 session admission handoff: exact Origin, one active
  // cookie session, CSRF on writes, and the 120/minute session sync window.
  // A valid presented session may complete after a concurrent revocation by
  // contract; append keeps the principal resolved here and retains ADR-0013
  // retry semantics.
  const admitted = await admission.admitSessionSync(request, config, env, {
    csrf: request.method === "POST",
  });
  const ownerId = admitted.session.userId;
  const repository = createChangeRepository(
    env.DB,
    dependencies.now ? { now: dependencies.now } : {},
  );

  if (route.kind === "bootstrap") {
    assertNoQuery(url);
    await assertEmptyBody(request);
    return jsonResponse(
      200,
      await repository.provisionSessionDocument(ownerId),
    );
  }

  requireDocumentId(route.documentId);
  // Resolve ownership before interpreting the body. A foreign or missing
  // document stays indistinguishable 404 even when the body or query is
  // malformed, and it is never rebound or provisioned.
  await repository.findOwnedDocument(ownerId, route.documentId);
  if (request.method === "POST") {
    assertJsonRequest(request);
    assertNoQuery(url);
    const body = await readJsonBody(request, SYNC_LIMITS.maxRequestBytes);
    const changes = appendChanges(body);
    return jsonResponse(
      200,
      await repository.append(ownerId, route.documentId, changes),
    );
  }

  const page = parsePagination(url);
  return jsonResponse(
    200,
    await repository.pull(ownerId, route.documentId, page),
  );
}

function sessionFailure(request, error) {
  const response = sessionErrorResponse(error);
  // An invalid, duplicate, expired, or revoked presented cookie is cleared.
  // A missing cookie and a storage failure leave the response untouched.
  if (error?.code === "unauthorized" && request.headers.get("Cookie") !== null)
    return appendSetCookies(response, [clearSessionCookie()]);
  return response;
}

export async function handleSyncRequest(request, env, dependencies = {}) {
  if (env?.AUTH_MODE === "session") {
    try {
      return await dispatchSession(request, env, dependencies);
    } catch (error) {
      return sessionFailure(request, error);
    }
  }
  if (env?.AUTH_MODE === "dev_bearer") {
    let response;
    try {
      response = await dispatchDev(request, env);
    } catch (error) {
      response = errorResponse(error);
    }
    return withCors(response, request);
  }
  // No mode, an unknown mode, or a conflicting configuration fails closed
  // before routing, Origin, session, or D1 access. There is no implicit dev or
  // cookie fallback.
  return jsonResponse(404, { error: { code: "not_found" } });
}
