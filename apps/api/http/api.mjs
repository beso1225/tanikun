import { jsonResponse } from "./respond.mjs";
import { handleSessionAuthRequest } from "./session-auth.mjs";
import { handleSyncRequest } from "./sync.mjs";

const EXPLICIT_AUTH_MODES = new Set(["dev_bearer", "session"]);

// One Worker entry for the Phase 5 auth and sync areas. The mode gate runs
// before dispatch: an absent, unknown, or conflicting AUTH_MODE is an empty
// 404 for every auth and sync route, and no handler can infer a default
// identity. The health endpoint stays outside this router.
export async function handleApiRequest(request, env) {
  if (!env || !EXPLICIT_AUTH_MODES.has(env.AUTH_MODE))
    return jsonResponse(404, { error: { code: "not_found" } });

  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/api/v1/auth/"))
    return handleSessionAuthRequest(request, env);
  // Sync owns its remaining route matching so the exact development and
  // session rejection orders stay in one place.
  return handleSyncRequest(request, env);
}
