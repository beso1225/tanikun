import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { gunzipSync } from "node:zlib";

export const sqlQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;

/**
 * Forward requests to the real API, read the complete server response, then
 * destroy the client connection. The Worker commit happens; the caller sees a
 * network failure. This is used only to inject a lost response.
 */
export async function startResponseDroppingProxy(targetOrigin) {
  const target = new URL(targetOrigin);
  const records = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const forwarded = httpRequest(
        {
          hostname: target.hostname,
          port: target.port,
          method: request.method,
          path: request.url,
          headers: {
            ...request.headers,
            host: target.host,
            "accept-encoding": "identity",
          },
        },
        (upstream) => {
          const responseChunks = [];
          upstream.on("data", (chunk) => responseChunks.push(chunk));
          upstream.on("end", () => {
            records.push({
              method: request.method,
              url: request.url,
              status: upstream.statusCode,
              headers: upstream.headers,
              body: Buffer.concat(responseChunks),
            });
            response.destroy();
          });
        },
      );
      forwarded.on("error", (error) => {
        records.push({ error: error.message });
        response.destroy();
      });
      forwarded.end(body);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    records,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

export async function postAndLoseResponse({
  proxyOrigin,
  origin,
  token,
  documentId,
  envelope,
}) {
  let error = null;
  try {
    await fetch(`${proxyOrigin}/api/v1/sync/documents/${documentId}/changes`, {
      method: "POST",
      headers: {
        Origin: origin,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ changes: [envelope] }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "the lost-response request must fail at the client");
  return error;
}

export function proxyResponseText(record) {
  const body =
    record.headers["content-encoding"] === "gzip"
      ? gunzipSync(record.body)
      : record.body;
  return body.toString("utf8");
}
