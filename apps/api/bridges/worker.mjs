import { health_body } from "../../../_build/js/release/build/beso1225/tanikun-api/tanikun-api.js";
import { handleSyncRequest } from "../http/sync.mjs";

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/health") {
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { Allow: "GET" },
        });
      }
      return new Response(health_body(), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    if (pathname === "/api/v1" || pathname.startsWith("/api/v1/"))
      return handleSyncRequest(request, env);
    return new Response("Not Found", { status: 404 });
  },
};
