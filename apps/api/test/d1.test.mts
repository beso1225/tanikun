import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

beforeEach(async () => {
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS changes (id TEXT PRIMARY KEY, payload BLOB NOT NULL)",
  );
});

describe("local D1 binding", () => {
  it("starts each test with isolated storage", async () => {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM changes",
    ).first();
    expect(row.count).toBe(0);
  });

  it("stores and returns change bytes through the Worker", async () => {
    const payload = [1, 2, 3, 4];
    const response = await SELF.fetch("https://example.test/api/changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "change-1", payload }),
    });
    expect(response.status).toBe(200);

    const stored = await SELF.fetch("https://example.test/api/changes/change-1");
    expect(stored.status).toBe(200);
    expect(await stored.json()).toEqual({ id: "change-1", payload });
  });

  it("reads the row directly through env.DB", async () => {
    await env.DB.prepare(
      "INSERT INTO changes (id, payload) VALUES (?1, ?2)",
    ).bind("change-2", new Uint8Array([9, 8])).run();
    const row = await env.DB.prepare(
      "SELECT payload FROM changes WHERE id = ?1",
    ).bind("change-2").first();
    expect(Array.from(new Uint8Array(row.payload))).toEqual([9, 8]);
  });

  it("returns 404 for an unknown change", async () => {
    const response = await SELF.fetch("https://example.test/api/changes/missing");
    expect(response.status).toBe(404);
  });
});
