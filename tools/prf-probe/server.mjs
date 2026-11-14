/*
 * Minimal HTTPS server for the isolated PRF physical probe.
 *
 * The server serves four static files on https://localhost:4300. It has no
 * API, no cookies, no CORS, and no request logging. It binds only to loopback.
 * The default certificate is disposable and self-signed. A parent may supply a
 * certificate that the browser already trusts, but this server never installs,
 * imports, or changes trust.
 */

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PROBE_ORIGIN, PROBE_PORT, PROBE_RP_ID } from "./public/probe-core.mjs";

const PUBLIC_ROOT = fileURLToPath(new URL("./public/", import.meta.url));
const HOST = "127.0.0.1";
const EXPECTED_HOST = `localhost:${PROBE_PORT}`;

const FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/probe.js", "probe.js"],
  ["/probe-core.mjs", "probe-core.mjs"],
  ["/probe.css", "probe.css"],
]);

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
]);

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "manifest-src 'none'",
    "worker-src 'none'",
  ].join("; "),
  "Permissions-Policy":
    "publickey-credentials-create=(self), publickey-credentials-get=(self), camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function loopback(address) {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function send(response, status, headers, body = "") {
  response.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  response.end(body);
}

function handler(request, response) {
  if (!loopback(request.socket.remoteAddress)) {
    send(response, 403, { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  if (request.headers.host !== EXPECTED_HOST) {
    send(response, 421, { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    send(
      response,
      405,
      {
        Allow: "GET, HEAD",
        "Content-Type": "text/plain; charset=utf-8",
      },
      request.method === "HEAD" ? "" : "method not allowed\n",
    );
    return;
  }

  let url;
  try {
    url = new URL(request.url ?? "/", PROBE_ORIGIN);
  } catch {
    send(response, 400, { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  if (url.search !== "") {
    send(response, 404, { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  if (url.pathname === "/favicon.ico") {
    response.writeHead(204, SECURITY_HEADERS);
    response.end();
    return;
  }

  const file = FILES.get(url.pathname);
  if (!file) {
    send(response, 404, { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  readFile(join(PUBLIC_ROOT, file))
    .then((body) => {
      const contentType =
        CONTENT_TYPES.get(extname(file)) ?? "application/octet-stream";
      response.writeHead(200, {
        ...SECURITY_HEADERS,
        "Content-Type": contentType,
      });
      if (request.method === "HEAD") response.end();
      else response.end(body);
    })
    .catch(() => {
      send(response, 404, { "Content-Type": "text/plain; charset=utf-8" });
    });
}

async function generateTls() {
  const directory = await mkdtemp(join(tmpdir(), "tanikun-prf-tls-"));
  const keyPath = join(directory, "key.pem");
  const certPath = join(directory, "cert.pem");
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) {
    await rm(directory, { recursive: true, force: true });
    throw new Error(
      `cannot create the loopback TLS test certificate: ${
        result.error?.message ?? result.stderr?.trim() ?? result.status
      }`,
    );
  }
  return {
    key: await readFile(keyPath),
    cert: await readFile(certPath),
    directory,
    source: "generated",
  };
}

function checkSuppliedCertificate(certPath) {
  const result = spawnSync(
    "openssl",
    ["x509", "-in", certPath, "-noout", "-checkhost", "localhost"],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) {
    throw new Error("the supplied TLS certificate is not valid for localhost");
  }
}

async function loadTls(options = {}) {
  const certPath = options.certPath ?? process.env.TANIKUN_PRF_TLS_CERT;
  const keyPath = options.keyPath ?? process.env.TANIKUN_PRF_TLS_KEY;
  if (Boolean(certPath) !== Boolean(keyPath)) {
    throw new Error(
      "set both TANIKUN_PRF_TLS_CERT and TANIKUN_PRF_TLS_KEY, or neither",
    );
  }
  if (!certPath || !keyPath) return generateTls();
  checkSuppliedCertificate(certPath);
  return {
    key: await readFile(keyPath),
    cert: await readFile(certPath),
    directory: null,
    source: "supplied",
  };
}

export async function startPrfProbeServer(options = {}) {
  const log = options.log ?? console.log;
  const tls = await loadTls(options);
  const server = createServer({ key: tls.key, cert: tls.cert }, handler);

  try {
    await new Promise((resolve, reject) => {
      server.once("error", (error) => {
        if (error.code === "EADDRINUSE") {
          reject(
            new Error(
              `${PROBE_ORIGIN} is already in use. Stop the existing listener; do not change the origin, RP ID, or port.`,
              { cause: error },
            ),
          );
          return;
        }
        reject(error);
      });
      server.listen(PROBE_PORT, HOST, resolve);
    });
  } catch (error) {
    if (tls.directory) {
      await rm(tls.directory, { recursive: true, force: true });
    }
    throw error;
  }

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
    if (tls.directory) {
      await rm(tls.directory, { recursive: true, force: true });
    }
    log(`closed ${PROBE_ORIGIN}`);
  }

  log(`origin=${PROBE_ORIGIN}`);
  log(`rpId=${PROBE_RP_ID}`);
  log(`tls=${tls.source}`);
  return { server, origin: PROBE_ORIGIN, tlsSource: tls.source, close };
}

async function main() {
  const harness = await startPrfProbeServer();
  const stop = async () => {
    await harness.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(
    [
      "Tanikun PRF physical probe",
      `Open ${PROBE_ORIGIN} in the approved browser.`,
      "This page is not the product login and creates disposable passkeys only.",
      "Do not install the disposable certificate, change a trust store, or use certificate flags.",
      "Stop with Ctrl-C.",
    ].join("\n"),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
