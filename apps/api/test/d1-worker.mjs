export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/changes" && request.method === "POST") {
      const body = await request.json();
      await env.DB.prepare(
        "INSERT INTO changes (id, payload) VALUES (?1, ?2) " +
          "ON CONFLICT(id) DO UPDATE SET payload = ?2",
      ).bind(body.id, new Uint8Array(body.payload)).run();
      return Response.json({ ok: true });
    }
    const match = url.pathname.match(/^\/api\/changes\/([^/]+)$/);
    if (match && request.method === "GET") {
      const row = await env.DB.prepare(
        "SELECT id, payload FROM changes WHERE id = ?1",
      ).bind(decodeURIComponent(match[1])).first();
      if (!row) return new Response("Not Found", { status: 404 });
      return Response.json({
        id: row.id,
        payload: Array.from(new Uint8Array(row.payload)),
      });
    }
    return new Response("Not Found", { status: 404 });
  },
};
