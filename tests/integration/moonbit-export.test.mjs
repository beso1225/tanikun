import assert from "node:assert/strict";
import test from "node:test";
import { health_body } from "../../_build/js/release/build/beso1225/tanikun-api/tanikun-api.js";

test("MoonBit exports a native JavaScript string through ESM", () => {
  const body = health_body();
  assert.equal(typeof body, "string");
  assert.deepEqual(JSON.parse(body), { status: "ok" });
});
