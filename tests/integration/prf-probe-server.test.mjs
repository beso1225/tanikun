import assert from "node:assert/strict";
import { request as httpsRequest } from "node:https";
import test from "node:test";

import { startPrfProbeServer } from "../../tools/prf-probe/server.mjs";

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: "127.0.0.1",
        port: 4300,
        path,
        method: options.method ?? "GET",
        servername: "localhost",
        rejectUnauthorized: false,
        headers: {
          Host: options.host ?? "localhost:4300",
          ...options.headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("PRF probe server serves only the isolated page contract", async (t) => {
  const logs = [];
  const harness = await startPrfProbeServer({ log: (line) => logs.push(line) });
  t.after(() => harness.close());

  const index = await request("/");
  assert.equal(index.status, 200);
  assert.match(index.headers["content-type"], /text\/html/u);
  assert.match(index.headers["content-security-policy"], /connect-src 'none'/u);
  assert.equal(index.headers["access-control-allow-origin"], undefined);
  assert.equal(index.headers["set-cookie"], undefined);
  assert.match(index.body, /PRF physical probe/u);

  const core = await request("/probe-core.mjs");
  assert.equal(core.status, 200);
  assert.match(core.headers["content-type"], /text\/javascript/u);

  const css = await request("/probe.css");
  assert.equal(css.status, 200);
  assert.match(css.headers["content-type"], /text\/css/u);

  const missing = await request("/missing");
  assert.equal(missing.status, 404);

  const query = await request("/?anything=1");
  assert.equal(query.status, 404);

  const traversal = await request("/../package.json");
  assert.equal(traversal.status, 404);

  const post = await request("/", { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, "GET, HEAD");

  const head = await request("/", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.body, "");

  const wrongHost = await request("/", { host: "127.0.0.1:4300" });
  assert.equal(wrongHost.status, 421);

  assert.equal(
    logs.some((line) => line.includes("TANIKUN-PRF")),
    false,
  );
});

test("PRF probe server refuses an occupied origin without changing it", async () => {
  const harness = await startPrfProbeServer({ log: () => {} });
  try {
    await assert.rejects(
      startPrfProbeServer({ log: () => {} }),
      /https:\/\/localhost:4300 is already in use/u,
    );
  } finally {
    await harness.close();
  }
});

test("PRF probe server closes its listener and is idempotent", async () => {
  const harness = await startPrfProbeServer({ log: () => {} });
  await harness.close();
  await harness.close();
  await assert.rejects(request("/"), (error) => error.code === "ECONNREFUSED");
});
