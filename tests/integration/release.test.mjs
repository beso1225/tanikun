import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
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
  for (const asset of ["sync-session.js", "sync-transport.js", "sync-shell.js"])
    await access(join(release, "web", asset));
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

test("packaged Worker bridge activates one API router and fails closed by default", async () => {
  const bridge = await readFile(
    join(release, "api/apps/api/bridges/worker.mjs"),
    "utf8",
  );
  assert.match(bridge, /from "\.\.\/http\/api\.mjs"/u);
  assert.doesNotMatch(
    bridge,
    /webauthn|session-auth|handleSessionAuthRequest/i,
  );

  const { default: worker } = await import(
    pathToFileURL(join(release, "api/apps/api/bridges/worker.mjs"))
  );
  for (const path of [
    "/api/v1/auth/session",
    "/api/v1/sync/document",
    "/api/v1/sync/documents/11111111-1111-4111-8111-111111111111/changes",
  ]) {
    const response = await worker.fetch(
      new Request(`https://example.test${path}`, {
        headers: {
          Origin: "http://127.0.0.1:4300",
          Authorization: "Bearer local-fixture-token-alice",
        },
      }),
    );
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(response.headers.get("WWW-Authenticate"), null);
    assert.deepEqual(await response.json(), { error: { code: "not_found" } });
  }
});

test("packaged API includes the self-contained WebAuthn verifier and auth entry", async () => {
  for (const path of [
    "api/apps/api/webauthn/verify.js",
    "api/apps/api/webauthn/auth.js",
  ]) {
    const bundle = await readFile(join(release, path), "utf8");
    assert.ok(bundle.length > 0);
    assert.doesNotMatch(
      bundle,
      /^\s*import\s+[^("]/mu,
      `${path} must not have external static imports`,
    );
    assert.doesNotMatch(
      bundle,
      /^\s*export\s+.*\bfrom\s+["']/mu,
      `${path} must not re-export from an external module`,
    );
    assert.doesNotMatch(bundle, /\brequire\s*\(\s*["']/u);
  }
});

test("packaged auth entry exports the session and ceremony boundaries", async () => {
  const entry = await import(
    pathToFileURL(join(release, "api/apps/api/webauthn/auth.js"))
  );
  assert.equal(typeof entry.handleWebAuthnRequest, "function");
  assert.equal(typeof entry.handleSessionAuthRequest, "function");
  assert.equal(typeof entry.createSessionMaterial, "function");
  assert.equal(typeof entry.readSessionAuthConfig, "function");
  assert.equal(typeof entry.createSessionAdmission, "function");
  assert.equal(typeof entry.createConfiguredAuthRateLimiter, "function");
  assert.equal(typeof entry.AUTH_RATE_LIMIT_POLICIES, "object");
  assert.equal(typeof entry.trustedClientAddress, "function");
});

test("packaged API includes every Worker module, migration, and runtime config", async () => {
  const api = join(release, "api");
  const required = [
    "apps/api/bridges/worker.mjs",
    "apps/api/http/api.mjs",
    "apps/api/http/api.js",
    "apps/api/http/auth.mjs",
    "apps/api/http/webauthn.mjs",
    "apps/api/http/session-auth.mjs",
    "apps/api/http/errors.mjs",
    "apps/api/http/json.mjs",
    "apps/api/http/respond.mjs",
    "apps/api/http/sync.mjs",
    "apps/api/rate-limits/limiter.mjs",
    "apps/api/rate-limits/policy.mjs",
    "apps/api/repositories/auth-data.mjs",
    "apps/api/repositories/auth.mjs",
    "apps/api/repositories/changes.mjs",
    "apps/api/session/admission.mjs",
    "apps/api/session/cookies.mjs",
    "apps/api/webauthn/auth.js",
    "apps/api/migrations/0001_sync.sql",
    "apps/api/migrations/0002_auth_storage.sql",
    "apps/api/migrations/0003_auth_rate_limits.sql",
    "packages/sync-contract/contract.mjs",
    "_build/js/release/build/beso1225/tanikun-api/tanikun-api.js",
    "wrangler.jsonc",
  ];
  for (const path of required) await access(join(api, path));

  assert.deepEqual(
    (await readdir(join(api, "apps/api/migrations"))).toSorted(),
    ["0001_sync.sql", "0002_auth_storage.sql", "0003_auth_rate_limits.sql"],
  );

  const authShim = await readFile(
    join(api, "apps/api/http/webauthn.mjs"),
    "utf8",
  );
  assert.equal(
    authShim,
    'export { handleSessionAuthRequest, handleWebAuthnRequest } from "../webauthn/auth.js";\n',
  );

  const apiShim = await readFile(join(api, "apps/api/http/api.mjs"), "utf8");
  assert.equal(apiShim, 'export { handleApiRequest } from "./api.js";\n');
  const apiBundle = await readFile(join(api, "apps/api/http/api.js"), "utf8");
  assert.ok(apiBundle.length > 0);
  assert.doesNotMatch(
    apiBundle,
    /^\s*import\s+[^("]/mu,
    "packaged API bundle must not have external static imports",
  );
  assert.doesNotMatch(
    apiBundle,
    /^\s*export\s+.*\bfrom\s+["']/mu,
    "packaged API bundle must not re-export from an external module",
  );
  assert.doesNotMatch(apiBundle, /\brequire\s*\(\s*["']/u);

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
