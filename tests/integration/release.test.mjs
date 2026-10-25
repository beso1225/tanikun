import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const release = process.env.TANIKUN_RELEASE;
assert.ok(release, "TANIKUN_RELEASE must point to the Nix release output");

test("release contains linked HTML, JavaScript, and MoonBit-derived CSS", async () => {
  const html = await readFile(join(release, "web/index.html"), "utf8");
  assert.match(html, /src="\.\/index\.js"/);
  assert.match(html, /href="\.\/styles\.css"/);
  const js = await readFile(join(release, "web/index.js"), "utf8");
  assert.ok(js.length > 0);
  const css = await readFile(join(release, "web/styles.css"), "utf8");
  assert.match(css, /\.gap-2\{/);
  assert.match(css, /\.p-6\{/);
});

test("packaged Worker imports and handles requests without build-tree files", async () => {
  const { default: worker } = await import(
    pathToFileURL(join(release, "api/apps/api/bridges/worker.mjs"))
  );
  const health = await worker.fetch(
    new Request("https://example.test/api/health"),
  );
  assert.equal(health.status, 200);
  assert.equal(
    health.headers.get("Content-Type"),
    "application/json; charset=utf-8",
  );
  assert.deepEqual(await health.json(), { status: "ok" });
  assert.equal(
    (await worker.fetch(new Request("https://example.test/missing"))).status,
    404,
  );
  const post = await worker.fetch(
    new Request("https://example.test/api/health", { method: "POST" }),
  );
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("Allow"), "GET");
});
