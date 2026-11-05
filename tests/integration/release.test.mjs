import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
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
  assert.match(css, /\.bg-primary\{/);
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

test("packaged API includes every Worker module, migration, and runtime config", async () => {
  const api = join(release, "api");
  const required = [
    "apps/api/bridges/worker.mjs",
    "apps/api/http/auth.mjs",
    "apps/api/http/errors.mjs",
    "apps/api/http/json.mjs",
    "apps/api/http/respond.mjs",
    "apps/api/http/sync.mjs",
    "apps/api/repositories/changes.mjs",
    "apps/api/migrations/0001_sync.sql",
    "packages/sync-contract/contract.mjs",
    "_build/js/release/build/beso1225/tanikun-api/tanikun-api.js",
    "wrangler.jsonc",
  ];
  for (const path of required) await access(join(api, path));

  const configText = await readFile(join(api, "wrangler.jsonc"), "utf8");
  assert.match(configText, /"main":\s*"apps\/api\/bridges\/worker\.mjs"/);
  assert.match(configText, /"migrations_dir":\s*"apps\/api\/migrations"/);
  assert.doesNotMatch(configText, /"build"|watch_dir|\$schema/);

  const config = JSON.parse(configText);
  assert.equal(Object.hasOwn(config, "build"), false);
  assert.equal(Object.hasOwn(config, "watch_dir"), false);
  assert.equal(Object.hasOwn(config, "$schema"), false);
  for (const relative of [
    config.main,
    config.d1_databases.find((database) => database.binding === "DB")
      .migrations_dir,
  ]) {
    assert.equal(relative.startsWith("/"), false);
    await access(join(api, relative));
  }
});
