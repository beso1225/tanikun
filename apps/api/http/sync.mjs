import {
  SYNC_LIMITS,
  requireDocumentId,
} from "../../../packages/sync-contract/contract.mjs";
import { createChangeRepository } from "../repositories/changes.mjs";
import { assertOrigin, readDevEnvironment, resolveIdentity } from "./auth.mjs";
import { ApiError, methodNotAllowed } from "./errors.mjs";
import { parsePagination, readJsonBody } from "./json.mjs";
import {
  emptyResponse,
  errorResponse,
  jsonResponse,
  withCors,
} from "./respond.mjs";

const bootstrapPath = "/api/v1/sync/document";
const changesPath = /^\/api\/v1\/sync\/documents\/([^/]+)\/changes$/;

function matchRoute(pathname) {
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

async function dispatch(request, env) {
  // ADR-0014 order: local gate, Origin, route existence, preflight, bearer,
  // method, owned resource, media type, size/syntax, operation.
  const dev = readDevEnvironment(request, env);
  if (!dev) throw new ApiError("not_found");
  assertOrigin(request);
  const url = new URL(request.url);
  const route = matchRoute(url.pathname);
  if (!route) throw new ApiError("not_found");
  if (request.method === "OPTIONS") return preflight(request, route);
  const identity = resolveIdentity(request, dev);
  if (!route.methods.includes(request.method))
    throw methodNotAllowed(route.allow);

  // Test-only fixture hook: the golden-fixture bootstrap-new case sets this
  // so its server-generated document is deterministic. Production, preview,
  // and default configurations must never set it.
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

export async function handleSyncRequest(request, env) {
  let response;
  try {
    response = await dispatch(request, env);
  } catch (error) {
    response = errorResponse(error);
  }
  return withCors(response, request);
}
