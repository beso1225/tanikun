import { health_body } from "../../../_build/js/release/build/beso1225/tanikun-api/tanikun-api.js";

export default {
  fetch(request) {
    if (new URL(request.url).pathname !== "/api/health") {
      return new Response("Not Found", { status: 404 });
    }
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET" },
      });
    }
    return new Response(health_body(), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  },
};
