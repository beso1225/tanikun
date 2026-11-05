import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve, sep } from "node:path";
import { finished } from "node:stream/promises";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "../..");
export const SYNC_WRANGLER_BIN = join(
  repositoryRoot,
  "node_modules/wrangler/bin/wrangler.js",
);
const wranglerBin = SYNC_WRANGLER_BIN;

export const SYNC_WEB_ORIGIN = "http://127.0.0.1:4300";
export const SYNC_EVIDENCE_ROOT = join(repositoryRoot, ".cache/verify/sync");
export const SYNC_IDENTITIES = Object.freeze([
  Object.freeze({
    name: "alice",
    token: "sync-harness-token-alice",
    ownerId: "sync-harness-alice",
  }),
  Object.freeze({
    name: "bob",
    token: "sync-harness-token-bob",
    ownerId: "sync-harness-bob",
  }),
]);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
]);

const delay = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

// Trace archives use the Playwright installation that was active when this
// module loaded. Lifecycle tests temporarily point PLAYWRIGHT_CORE at a fake
// chromium module, but still need the real bundled zip implementation.
const traceArchiveCore = process.env.PLAYWRIGHT_CORE ?? null;

export function redactEvidenceText(text) {
  let redacted = String(text);
  for (const identity of SYNC_IDENTITIES) {
    redacted = redacted
      .replaceAll(identity.token, "<redacted-token>")
      .replaceAll(identity.ownerId, "<redacted-owner>");
  }
  return redacted
    .replace(/\bBearer\s+\S+/gi, "Bearer <redacted>")
    .replace(/(\/api\/v1\/sync\/documents\/)[^/\s?#"'<>]+/g, "$1<document-id>")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "<document-id>",
    )
    .replace(/\b[0-9a-f]{64}\b/gi, "<change-id>")
    .replace(
      /("(?:envelope|nonce|payload)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi,
      '$1"<redacted>"',
    )
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "<redacted-binary>");
}

function identityFor(name) {
  const identity = SYNC_IDENTITIES.find((candidate) => candidate.name === name);
  if (!identity) throw new Error(`unknown dev identity: ${name}`);
  return identity;
}

export function identityToken(name) {
  return identityFor(name).token;
}

export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function processGroupExists(pid) {
  if (!pid) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

export async function waitForSync(page, expected, timeout = 20_000) {
  try {
    await page.waitForFunction(
      (value) =>
        document.querySelector("#sync-status-text")?.textContent === value,
      expected,
      { timeout },
    );
  } catch (error) {
    const observed = await page
      .evaluate(() => ({
        text: document.querySelector("#sync-status-text")?.textContent ?? null,
        state: document.querySelector("#sync-status")?.dataset.state ?? null,
        history: globalThis.tanikunSyncShell?.history ?? [],
      }))
      .catch(() => null);
    throw new Error(
      `sync status did not become ${JSON.stringify(expected)}: ${JSON.stringify(observed)}`,
      { cause: error },
    );
  }
}

export function parseJsonc(text) {
  let withoutComments = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        withoutComments += character;
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      withoutComments += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      withoutComments += character;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    withoutComments += character;
  }

  let withoutTrailingCommas = "";
  let inStringValues = false;
  let escapedValues = false;
  for (let index = 0; index < withoutComments.length; index += 1) {
    const character = withoutComments[index];
    if (inStringValues) {
      withoutTrailingCommas += character;
      if (escapedValues) escapedValues = false;
      else if (character === "\\") escapedValues = true;
      else if (character === '"') inStringValues = false;
      continue;
    }
    if (character === '"') {
      inStringValues = true;
      withoutTrailingCommas += character;
      continue;
    }
    if (character === ",") {
      let cursor = index + 1;
      while (/\s/.test(withoutComments[cursor] ?? "")) cursor += 1;
      if (withoutComments[cursor] === "}" || withoutComments[cursor] === "]") {
        continue;
      }
    }
    withoutTrailingCommas += character;
  }
  return JSON.parse(withoutTrailingCommas);
}

const MAX_TRACE_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_TRACE_EVENTS = 5_000;
const MAX_TRACE_NETWORK_EVENTS = 2_000;

let zipModulesPromise = null;

async function loadZipModules() {
  if (!zipModulesPromise) {
    zipModulesPromise = (async () => {
      if (!traceArchiveCore)
        throw new Error(
          "PLAYWRIGHT_CORE is not set; run the sync harness inside `nix develop`",
        );
      const require = createRequire(import.meta.url);
      const utils = require(join(traceArchiveCore, "lib/utilsBundle.js"));
      return { yauzl: utils.yauzl, yazl: utils.yazl };
    })();
  }
  return zipModulesPromise;
}

async function readZipEntries(
  path,
  { names = null, maxEntryBytes = MAX_TRACE_ENTRY_BYTES } = {},
) {
  const { yauzl } = await loadZipModules();
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    yauzl.open(path, { lazyEntries: true }, (error, zipFile) => {
      if (error) {
        rejectOnce(error);
        return;
      }
      const entries = new Map();
      zipFile.on("error", rejectOnce);
      zipFile.on("end", () => {
        if (settled) return;
        settled = true;
        resolvePromise(entries);
      });
      zipFile.on("entry", (entry) => {
        if (settled) return;
        if (entry.fileName.endsWith("/")) {
          zipFile.readEntry();
          return;
        }
        if (names && !names.has(entry.fileName)) {
          zipFile.readEntry();
          return;
        }
        if (entry.uncompressedSize > maxEntryBytes) {
          rejectOnce(
            new Error(
              `trace entry ${entry.fileName} is too large (${entry.uncompressedSize} bytes)`,
            ),
          );
          zipFile.close();
          return;
        }
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            rejectOnce(streamError);
            return;
          }
          const chunks = [];
          let total = 0;
          stream.on("data", (chunk) => {
            total += chunk.length;
            if (total > maxEntryBytes) {
              rejectOnce(
                new Error(
                  `trace entry ${entry.fileName} exceeds ${maxEntryBytes} bytes`,
                ),
              );
              stream.destroy();
              return;
            }
            chunks.push(chunk);
          });
          stream.on("error", rejectOnce);
          stream.on("end", () => {
            if (settled) return;
            entries.set(entry.fileName, Buffer.concat(chunks));
            zipFile.readEntry();
          });
        });
      });
      zipFile.readEntry();
    });
  });
}

export function readTraceArchiveEntries(path) {
  return readZipEntries(path, { maxEntryBytes: 64 * 1024 * 1024 });
}

async function writeZipFile(path, entries) {
  const { yazl } = await loadZipModules();
  const zip = new yazl.ZipFile();
  for (const [name, buffer] of entries) zip.addBuffer(buffer, name);
  const output = createWriteStream(path);
  const done = finished(output);
  zip.outputStream.pipe(output);
  zip.end();
  await done;
}

function truncateEvidence(value, limit = 4_000) {
  const text = String(value);
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function sanitizeError(value) {
  if (!value) return null;
  if (typeof value === "string")
    return { message: truncateEvidence(redactEvidenceText(value)) };
  const message = value.message ?? value.error?.message;
  const stack = value.stack ?? value.error?.stack;
  const safe = {};
  if (typeof message === "string")
    safe.message = truncateEvidence(redactEvidenceText(message));
  if (typeof stack === "string")
    safe.stack = truncateEvidence(redactEvidenceText(stack));
  return Object.keys(safe).length > 0 ? safe : null;
}

function safeTraceEvent(event) {
  if (!event || typeof event !== "object") return null;
  switch (event.type) {
    case "context-options":
      return {
        type: "context-options",
        version: event.version,
        origin: event.origin,
        browserName: event.browserName,
        playwrightVersion: event.playwrightVersion,
        platform: event.platform,
        wallTime: event.wallTime,
        monotonicTime: event.monotonicTime,
        sdkLanguage: event.sdkLanguage,
      };
    case "before":
    case "action":
      return {
        type: event.type,
        callId: event.callId,
        startTime: event.startTime,
        class: event.class,
        method: event.method,
      };
    case "after": {
      const safe = {
        type: "after",
        callId: event.callId,
        endTime: event.endTime,
      };
      const error = sanitizeError(event.error);
      if (error) safe.error = error;
      return safe;
    }
    case "error":
      return {
        type: "error",
        message: truncateEvidence(
          redactEvidenceText(event.message ?? event.error?.message ?? ""),
        ),
      };
    default:
      return null;
  }
}

function sanitizeTraceNdjson(text) {
  const output = [];
  let sawContext = false;
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type === "context-options") sawContext = true;
    const safe = safeTraceEvent(event);
    if (!safe) continue;
    output.push(JSON.stringify(safe));
    if (output.length >= MAX_TRACE_EVENTS) break;
  }
  if (!sawContext)
    throw new Error("trace archive has no context-options event");
  return `${output.join("\n")}\n`;
}

function sanitizeTraceUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return `${url.origin}${redactEvidenceText(url.pathname)}`;
  } catch {
    return truncateEvidence(redactEvidenceText(value), 2_000);
  }
}

function sanitizeTimings(value) {
  const timings = {};
  for (const key of ["dns", "connect", "ssl", "send", "wait", "receive"]) {
    if (Number.isFinite(value?.[key])) timings[key] = value[key];
  }
  return timings;
}

function sanitizeNetworkNdjson(text) {
  const output = [];
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type !== "resource-snapshot" || !event.snapshot) continue;
    const snapshot = event.snapshot;
    const request = snapshot.request ?? {};
    const response = snapshot.response ?? {};
    output.push(
      JSON.stringify({
        type: "resource-snapshot",
        snapshot: {
          pageref: snapshot.pageref,
          startedDateTime: snapshot.startedDateTime,
          time: snapshot.time,
          request: {
            method: request.method ?? "GET",
            url: sanitizeTraceUrl(request.url),
            httpVersion: request.httpVersion ?? "HTTP/1.1",
            cookies: [],
            headers: [],
            queryString: [],
            headersSize: -1,
            bodySize: 0,
          },
          response: {
            status: response.status ?? 0,
            statusText: "",
            httpVersion: response.httpVersion ?? "HTTP/1.1",
            cookies: [],
            headers: [],
            content: { size: -1, mimeType: "application/octet-stream" },
            headersSize: -1,
            bodySize: -1,
            redirectURL: "",
          },
          cache: {},
          timings: sanitizeTimings(snapshot.timings),
        },
      }),
    );
    if (output.length >= MAX_TRACE_NETWORK_EVENTS) break;
  }
  return output.length > 0 ? `${output.join("\n")}\n` : "";
}

export async function sanitizeTraceArchive(sourcePath, destinationPath) {
  const entries = await readZipEntries(sourcePath, {
    names: new Set(["trace.trace", "trace.network"]),
  });
  const trace = entries.get("trace.trace");
  if (!trace) throw new Error("trace archive has no trace.trace entry");
  const safeEntries = new Map();
  safeEntries.set(
    "trace.trace",
    Buffer.from(sanitizeTraceNdjson(trace.toString("utf8"))),
  );
  const network = entries.get("trace.network");
  if (network) {
    safeEntries.set(
      "trace.network",
      Buffer.from(sanitizeNetworkNdjson(network.toString("utf8"))),
    );
  }
  const temporary = `${destinationPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await writeZipFile(temporary, safeEntries);
    await rename(temporary, destinationPath);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export function assertPackagedRuntimeConfig(config, configPath) {
  for (const key of ["build", "watch_dir"]) {
    if (Object.hasOwn(config, key)) {
      throw new Error(
        `packaged API config must not contain ${key}: ${configPath}`,
      );
    }
  }
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(true);
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => finish(false), timeoutMs);
    function finish(exited) {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onError);
      resolvePromise(exited);
    }
    function onExit() {
      finish(true);
    }
    function onError() {
      finish(true);
    }
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

function waitForChildClose(child, timeoutMs) {
  if (!child || child.closed) return Promise.resolve(true);
  if (child.stdout?.readableEnded && child.stderr?.readableEnded)
    return Promise.resolve(true);
  return new Promise((resolvePromise) => {
    let settled = false;
    const timer = setTimeout(() => finish(false), timeoutMs);
    function finish(closed) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("close", onClose);
      child.off("error", onError);
      resolvePromise(closed);
    }
    function onClose() {
      finish(true);
    }
    function onError() {
      finish(false);
    }
    child.once("close", onClose);
    child.once("error", onError);
  });
}

async function waitForGroupGone(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processGroupExists(pid)) return true;
    await delay(50);
  }
  return !processGroupExists(pid);
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

export class WranglerLogSink {
  #stream;
  #child = null;
  #record = null;
  #buffer = "";
  #ended = false;
  #finishPromise = null;
  errorMessages = [];
  droppedLines = 0;

  constructor(stream) {
    this.#stream = stream;
    stream.on("error", (error) => {
      this.errorMessages.push(error.message);
    });
  }

  attach(child) {
    if (this.#child) throw new Error("Wrangler log sink is already attached");
    this.#child = child;
    this.#record = (data) => this.#recordChunk(data);
    child.stdout?.on("data", this.#record);
    child.stderr?.on("data", this.#record);
  }

  detach() {
    const child = this.#child;
    const record = this.#record;
    this.#child = null;
    this.#record = null;
    if (!child || !record) return;
    child.stdout?.off("data", record);
    child.stderr?.off("data", record);
  }

  async finish(child = this.#child, timeoutMs = 1_000) {
    if (this.#finishPromise) return this.#finishPromise;
    this.#finishPromise = (async () => {
      await waitForChildClose(child, timeoutMs);
      this.detach();
      if (this.#buffer) {
        this.#writeLine(this.#buffer);
        this.#buffer = "";
      }
      this.#ended = true;
      const stream = this.#stream;
      this.#stream = null;
      if (!stream || stream.destroyed || stream.writableEnded) return;
      await new Promise((resolvePromise) => {
        const onError = () => resolvePromise();
        stream.once("error", onError);
        stream.end(() => {
          stream.off("error", onError);
          resolvePromise();
        });
      });
    })();
    return this.#finishPromise;
  }

  #recordChunk(data) {
    this.#buffer += data.toString();
    const lines = this.#buffer.split("\n");
    this.#buffer = lines.pop() ?? "";
    for (const line of lines) this.#writeLine(line);
  }

  #writeLine(line) {
    const stream = this.#stream;
    if (this.#ended || !stream || stream.destroyed || stream.writableEnded) {
      this.droppedLines += 1;
      return;
    }
    try {
      stream.write(`${redactEvidenceText(line)}\n`);
    } catch (error) {
      this.errorMessages.push(error.message);
    }
  }
}

function harnessClosedError(action) {
  return new Error(`sync harness closed during ${action}`);
}

function startWebServer(root) {
  const server = createServer(async (request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url, "http://127.0.0.1").pathname,
      );
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (pathname === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    const relativePath =
      pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = resolve(root, relativePath);
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, {
        "Content-Type":
          contentTypes.get(extname(file)) ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });

  return new Promise((resolvePromise, reject) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        reject(
          new Error(
            `sync harness requires ${SYNC_WEB_ORIGIN} because the Worker allows exactly that Origin; the port is already in use. Stop the existing listener and retry.`,
            { cause: error },
          ),
        );
        return;
      }
      reject(error);
    });
    server.listen(4300, "127.0.0.1", () => resolvePromise(server));
  });
}

async function requireFile(path, description) {
  if (!(await pathExists(path)))
    throw new Error(`missing ${description}: ${path}`);
}

async function makeTreeWritable(root) {
  await chmod(root, 0o755);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await makeTreeWritable(path);
    else if (!entry.isSymbolicLink()) await chmod(path, 0o644);
  }
}

export async function preparePackagedArtifact(apiRoot, tempRoot, paths) {
  const runtimeRoot = join(tempRoot, "api");
  await cp(await realpath(apiRoot), runtimeRoot, { recursive: true });
  await makeTreeWritable(runtimeRoot);
  const relocate = (path) => {
    const relativePath = relative(apiRoot, path);
    if (relativePath.startsWith("..") || relativePath === "") {
      throw new Error(`API artifact path is not relocatable: ${path}`);
    }
    return join(runtimeRoot, relativePath);
  };
  return {
    ...paths,
    main: relocate(paths.main),
    migrationsDir: relocate(paths.migrationsDir),
    configPath: relocate(paths.configPath),
    cwd: runtimeRoot,
  };
}

export class SyncHarness {
  constructor(options = {}) {
    const apiRoot = resolve(
      options.apiRoot ?? process.env.TANIKUN_API_DIST ?? repositoryRoot,
    );
    this.options = {
      webDist: resolve(
        options.webDist ??
          process.env.TANIKUN_WEB_DIST ??
          join(repositoryRoot, "apps/web/dist"),
      ),
      apiRoot,
      packaged: apiRoot !== repositoryRoot,
      serveWeb: options.serveWeb ?? true,
      readinessTimeoutMs: options.readinessTimeoutMs ?? 60_000,
      migrationTimeoutMs: options.migrationTimeoutMs ?? 60_000,
      closeGraceMs: options.closeGraceMs ?? 5_000,
    };
    this.evidenceDir = null;
    this.tempDir = null;
    this.apiOrigin = null;
    this.webOrigin = SYNC_WEB_ORIGIN;
    this.artifact = null;
    this.server = null;
    this.wrangler = null;
    this.wranglerPid = null;
    this.wranglerLog = null;
    this.browser = null;
    this.browserLaunchPromise = null;
    this.contexts = new Set();
    this.ownedChildren = new Set();
    this.pendingAcquisitions = new Set();
    this.cleanupProblems = [];
    this.signalHandlers = new Map();
    this.startPromise = null;
    this.closePromise = null;
    this.closing = false;
    this.abortController = new AbortController();
    this.started = false;
  }

  get activeContexts() {
    return this.contexts.size;
  }

  start() {
    if (this.closePromise)
      return Promise.reject(new Error("sync harness is closed"));
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#start().catch(async (error) => {
      await this.#writeEvidence(
        "startup-error.log",
        `${error.stack ?? String(error)}\n`,
      );
      if (!this.closing) await this.#releaseResources();
      throw error;
    });
    return this.startPromise;
  }

  async #start() {
    this.#assertOpen("startup");
    const runId = `${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
    this.evidenceDir = join(SYNC_EVIDENCE_ROOT, runId);
    await mkdir(this.evidenceDir, { recursive: true });
    this.#assertOpen("startup");
    this.tempDir = await mkdtemp(join(tmpdir(), "tanikun-sync-"));
    this.#assertOpen("startup");
    for (const directory of ["home", "config", "cache", "persistence"]) {
      await mkdir(join(this.tempDir, directory), { recursive: true });
      this.#assertOpen("startup");
    }
    this.#installSignalHandlers();
    await this.#writeEvidence(
      "harness.log",
      [
        `webOrigin=${this.webOrigin}`,
        `webDist=${this.options.webDist}`,
        `serveWeb=${this.options.serveWeb}`,
        `apiRoot=${this.options.apiRoot}`,
        `tempDir=${this.tempDir}`,
        `evidenceDir=${this.evidenceDir}`,
      ].join("\n") + "\n",
    );
    this.#assertOpen("startup");

    let paths = await this.#readArtifact();
    this.#assertOpen("startup");
    if (this.options.packaged) {
      paths = await this.#preparePackagedArtifact(paths);
      this.#assertOpen("startup");
    }

    if (this.options.serveWeb) {
      await requireFile(join(this.options.webDist, "index.html"), "web index");
      for (const file of [
        "index.js",
        "styles.css",
        "automerge.js",
        "planner-document.js",
        "persistence.js",
        "sync-contract.mjs",
        "sync-shell.js",
      ]) {
        await requireFile(
          join(this.options.webDist, file),
          `web asset ${file}`,
        );
      }
      this.#assertOpen("startup");
      const server = await startWebServer(this.options.webDist);
      this.server = server;
      this.#assertOpen("startup");
      await this.#appendEvidence("harness.log", `web server listening\n`);
      this.#assertOpen("startup");
    }

    let configPath = paths.configPath;
    if (!configPath) {
      configPath = join(this.tempDir, "wrangler.jsonc");
      const generated = {
        name: "tanikun-sync-harness",
        main: paths.main,
        compatibility_date: paths.compatibilityDate,
        ...(paths.compatibilityFlags.length > 0
          ? { compatibility_flags: paths.compatibilityFlags }
          : {}),
        send_metrics: false,
        d1_databases: [
          {
            binding: "DB",
            database_name: "tanikun-sync-harness",
            database_id: "00000000-0000-0000-0000-000000000000",
            migrations_dir: paths.migrationsDir,
          },
        ],
        dev: { ip: "127.0.0.1", port: 0 },
      };
      await writeFile(configPath, `${JSON.stringify(generated, null, 2)}\n`);
    }
    this.#assertOpen("startup");

    this.artifact = { configPath, cwd: paths.cwd };
    await this.#applyMigrations(configPath, paths.cwd);
    this.#assertOpen("startup");
    await this.#startWrangler(configPath, paths.cwd);
    this.#assertOpen("startup");
    this.started = true;
  }

  async #readArtifact() {
    const configPath = join(this.options.apiRoot, "wrangler.jsonc");
    await requireFile(
      configPath,
      "API wrangler.jsonc (run just build or point TANIKUN_API_DIST at a packaged API)",
    );
    const config = parseJsonc(await readFile(configPath, "utf8"));
    if (this.options.packaged) assertPackagedRuntimeConfig(config, configPath);
    if (typeof config.main !== "string" || config.main.length === 0)
      throw new Error(`API config has no main entry: ${configPath}`);
    if (
      typeof config.compatibility_date !== "string" ||
      config.compatibility_date.length === 0
    ) {
      throw new Error(`API config has no compatibility_date: ${configPath}`);
    }
    const database = (config.d1_databases ?? []).find(
      (candidate) => candidate.binding === "DB",
    );
    if (!database || typeof database.migrations_dir !== "string") {
      throw new Error(`API config has no DB migrations_dir: ${configPath}`);
    }
    const main = this.#artifactPath(config.main, "main");
    const migrationsDir = this.#artifactPath(
      database.migrations_dir,
      "migrations_dir",
    );
    await requireFile(main, "Worker bridge");
    await requireFile(
      join(this.options.apiRoot, "packages/sync-contract/contract.mjs"),
      "shared sync contract",
    );
    await requireFile(
      join(
        this.options.apiRoot,
        "_build/js/release/build/beso1225/tanikun-api/tanikun-api.js",
      ),
      "built MoonBit API module",
    );
    let migrationFiles;
    try {
      migrationFiles = (await readdir(migrationsDir)).filter((file) =>
        file.endsWith(".sql"),
      );
    } catch (error) {
      throw new Error(`cannot read D1 migrations at ${migrationsDir}`, {
        cause: error,
      });
    }
    if (migrationFiles.length === 0)
      throw new Error(`no D1 migrations found at ${migrationsDir}`);
    return {
      main,
      migrationsDir,
      configPath: this.options.packaged ? configPath : null,
      cwd: this.options.packaged ? this.options.apiRoot : this.tempDir,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: Array.isArray(config.compatibility_flags)
        ? config.compatibility_flags
        : [],
    };
  }

  #artifactPath(value, description) {
    const path = resolve(this.options.apiRoot, value);
    if (
      path !== this.options.apiRoot &&
      !path.startsWith(this.options.apiRoot + sep)
    ) {
      throw new Error(
        `API config ${description} must stay inside the artifact: ${value}`,
      );
    }
    return path;
  }

  async #preparePackagedArtifact(paths) {
    return preparePackagedArtifact(this.options.apiRoot, this.tempDir, paths);
  }

  #environment(kind) {
    const environment = { ...process.env };
    delete environment.CLOUDFLARE_API_TOKEN;
    delete environment.CLOUDFLARE_ACCOUNT_ID;
    return {
      ...environment,
      HOME: join(this.tempDir, "home"),
      XDG_CONFIG_HOME: join(this.tempDir, "config"),
      XDG_CACHE_HOME: join(this.tempDir, "cache"),
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_LOG_PATH: join(this.tempDir, `${kind}-wrangler-internal`),
      BROWSER: "none",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      CI: "1",
    };
  }

  async #applyMigrations(configPath, cwd) {
    const label = "D1 migration";
    const args = [
      wranglerBin,
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      join(this.tempDir, "persistence"),
      "--config",
      configPath,
    ];
    try {
      const output = await this.#runCommand(label, args, {
        cwd,
        env: this.#environment("migration"),
        timeoutMs: this.options.migrationTimeoutMs,
      });
      await this.#writeEvidence("migration.log", output);
    } catch (error) {
      await this.#writeEvidence(
        "migration.log",
        `${error.commandOutput ?? ""}${error.stack ?? String(error)}\n`,
      );
      throw error;
    }
  }

  async #runCommand(label, args, { cwd, env, timeoutMs }) {
    this.#assertOpen(`${label} command`);
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.ownedChildren.add(child);
    const onAbort = () => {
      void this.#terminateGroup(child).catch(() => {});
    };
    this.abortController.signal.addEventListener("abort", onAbort, {
      once: true,
    });
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    try {
      const exited = await waitForChildExit(child, timeoutMs);
      let timedOut = false;
      if (!exited) {
        timedOut = true;
        await this.#terminateGroup(child);
      } else {
        await waitForGroupGone(child.pid, 1_000);
      }
      if (this.closing) {
        const error = harnessClosedError(`${label} command`);
        error.commandOutput = output;
        throw error;
      }
      if (timedOut) {
        const error = new Error(
          `${label} timed out after ${timeoutMs}ms\n${output.slice(-4_000)}`,
        );
        error.commandOutput = output;
        throw error;
      }
      if (child.exitCode !== 0) {
        const error = new Error(
          `${label} exited with ${child.exitCode ?? child.signalCode}\n${output.slice(-8_000)}`,
        );
        error.commandOutput = output;
        throw error;
      }
      return output;
    } finally {
      this.abortController.signal.removeEventListener("abort", onAbort);
      this.ownedChildren.delete(child);
    }
  }

  async #startWrangler(configPath, cwd) {
    this.#assertOpen("Wrangler startup");
    const mapping = Object.fromEntries(
      SYNC_IDENTITIES.map(({ token, ownerId }) => [token, ownerId]),
    );
    const args = [
      wranglerBin,
      "dev",
      "--config",
      configPath,
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      "0",
      "--inspector-port",
      "0",
      "--persist-to",
      join(this.tempDir, "persistence"),
      "--log-level",
      "info",
      "--show-interactive-dev-session=false",
      "--var",
      "APP_ENV:local",
      "--var",
      "DEV_AUTH:true",
      "--var",
      `DEV_AUTH_IDENTITIES:${JSON.stringify(mapping)}`,
    ];
    const child = spawn(process.execPath, args, {
      cwd,
      env: this.#environment("dev"),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.wrangler = child;
    this.wranglerPid = child.pid ?? null;
    this.ownedChildren.add(child);
    this.wranglerLog = new WranglerLogSink(
      createWriteStream(join(this.evidenceDir, "wrangler.log"), {
        flags: "a",
      }),
    );
    this.wranglerLog.attach(child);
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });

    const origin = await this.#waitForReady(child, () => output);
    this.#assertOpen("Wrangler startup");
    this.apiOrigin = origin.replace(/\/+$/, "");
    await this.#appendEvidence(
      "harness.log",
      `wrangler ready at ${this.apiOrigin}\n`,
    );
    this.#assertOpen("Wrangler startup");
    await this.#waitForHealth();
  }

  #waitForReady(child, output) {
    return new Promise((resolvePromise, reject) => {
      if (this.closing) {
        reject(harnessClosedError("Wrangler readiness"));
        return;
      }
      let buffer = "";
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              `Wrangler startup timed out after ${this.options.readinessTimeoutMs}ms\n${output().slice(-8_000)}`,
            ),
          ),
        this.options.readinessTimeoutMs,
      );
      const cleanups = [];
      function finish(error, origin) {
        clearTimeout(timer);
        for (const cleanup of cleanups) cleanup();
        if (error) reject(error);
        else resolvePromise(origin);
      }
      const onAbort = () => finish(harnessClosedError("Wrangler readiness"));
      this.abortController.signal.addEventListener("abort", onAbort, {
        once: true,
      });
      const onData = (data) => {
        buffer += data.toString();
        const match = buffer.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) finish(null, match[1]);
      };
      const onExit = (code, signal) => {
        finish(
          new Error(
            `Wrangler exited before it was ready (${code ?? signal})\n${output().slice(-8_000)}`,
          ),
        );
      };
      const onError = (error) => finish(error);
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("exit", onExit);
      child.once("error", onError);
      cleanups.push(() => {
        child.stdout.off("data", onData);
        child.stderr.off("data", onData);
        child.off("exit", onExit);
        child.off("error", onError);
        this.abortController.signal.removeEventListener("abort", onAbort);
      });
    });
  }

  async #waitForHealth() {
    const deadline = Date.now() + 20_000;
    let lastError = null;
    while (Date.now() < deadline) {
      this.#assertOpen("Worker health check");
      try {
        const response = await fetch(`${this.apiOrigin}/api/health`, {
          signal: AbortSignal.any([
            AbortSignal.timeout(2_000),
            this.abortController.signal,
          ]),
        });
        await response.body?.cancel();
        if (response.status === 200) return;
        lastError = new Error(`health returned ${response.status}`);
      } catch (error) {
        if (this.closing) throw harnessClosedError("Worker health check");
        lastError = error;
      }
      await delay(100);
    }
    throw new Error(`Worker health check did not pass: ${lastError}`);
  }

  async health() {
    this.#assertStarted();
    const response = await fetch(`${this.apiOrigin}/api/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      text,
      json: () => JSON.parse(text),
    };
  }

  async request(identityName, path, { method = "GET", body } = {}) {
    this.#assertStarted();
    const identity = identityFor(identityName);
    const init = {
      method,
      headers: {
        Origin: this.webOrigin,
        Authorization: `Bearer ${identity.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      signal: AbortSignal.timeout(10_000),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetch(new URL(path, this.apiOrigin), init);
    const text = await response.text();
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      text,
      json: () => JSON.parse(text),
    };
  }

  async bootstrap(identityName) {
    const response = await this.request(identityName, "/api/v1/sync/document");
    assert.equal(
      response.status,
      200,
      `bootstrap failed: ${response.status} ${response.text}`,
    );
    return response.json();
  }

  async append(identityName, documentId, changes) {
    const response = await this.request(
      identityName,
      `/api/v1/sync/documents/${documentId}/changes`,
      { method: "POST", body: { changes } },
    );
    assert.equal(
      response.status,
      200,
      `append failed: ${response.status} ${response.text}`,
    );
    return response.json();
  }

  async pull(identityName, documentId, { after = 0, limit = 100 } = {}) {
    const query = new URLSearchParams({
      after: String(after),
      limit: String(limit),
    });
    const response = await this.request(
      identityName,
      `/api/v1/sync/documents/${documentId}/changes?${query}`,
    );
    assert.equal(
      response.status,
      200,
      `pull failed: ${response.status} ${response.text}`,
    );
    return response.json();
  }

  async waitForChanges(
    identityName,
    documentId,
    minimum = 1,
    timeout = 15_000,
  ) {
    const deadline = Date.now() + timeout;
    let last = null;
    while (Date.now() < deadline) {
      last = await this.pull(identityName, documentId);
      if (last.changes.length >= minimum) return last;
      await delay(100);
    }
    throw new Error(
      `expected at least ${minimum} changes for ${documentId}, saw ${last?.changes.length ?? "none"}`,
    );
  }

  // Test-only D1 control for isolated fault setup. Requests still use the real
  // Worker and repository; callers must not replace the production commit path.
  async d1(sql, { timeoutMs = 30_000 } = {}) {
    this.#assertStarted();
    if (!this.artifact)
      throw new Error("sync harness has no D1 artifact configuration");
    return this.#runCommand(
      "D1 execute",
      [
        wranglerBin,
        "d1",
        "execute",
        "DB",
        "--local",
        "--persist-to",
        join(this.tempDir, "persistence"),
        "--config",
        this.artifact.configPath,
        "--command",
        sql,
        "--json",
      ],
      {
        cwd: this.artifact.cwd,
        env: this.#environment("d1"),
        timeoutMs,
      },
    );
  }

  async d1Query(sql, options) {
    const output = await this.d1(sql, options);
    const start = output.indexOf("[");
    if (start < 0)
      throw new Error(`D1 query produced no JSON: ${output.slice(-1_000)}`);
    let parsed;
    try {
      parsed = JSON.parse(output.slice(start));
    } catch (error) {
      throw new Error(
        `D1 query JSON could not be parsed: ${output.slice(-1_000)}`,
        { cause: error },
      );
    }
    return parsed.flatMap((entry) => entry.results ?? []);
  }

  #browserInstance() {
    this.#assertOpen("browser launch");
    if (this.browser) return Promise.resolve(this.browser);
    if (!this.browserLaunchPromise) {
      const launch = this.#launchBrowser();
      this.browserLaunchPromise = launch;
      void launch.catch(() => {
        if (this.browserLaunchPromise === launch)
          this.browserLaunchPromise = null;
      });
    }
    return this.browserLaunchPromise;
  }

  async #launchBrowser() {
    const core = process.env.PLAYWRIGHT_CORE;
    assert.ok(
      core,
      "PLAYWRIGHT_CORE is not set; run the sync harness inside `nix develop`",
    );
    const { chromium } = await import(
      pathToFileURL(join(core, "index.mjs")).href
    );
    this.#assertOpen("browser launch");
    return this.#acquire("browser launch", () => chromium.launch(), {
      register: (browser) => {
        this.browser = browser;
      },
      dispose: (browser) =>
        this.#disposeLate("browser", () => browser.close(), 15_000),
    });
  }

  async #newPage(
    identityName,
    viewport,
    { traceName, attachFailureState = false, beforeGoto } = {},
  ) {
    this.#assertStarted();
    const identity = identityFor(identityName);
    const failureState = {
      context: null,
      page: null,
      errors: [],
      tracingStarted: false,
    };
    const browser = await this.#browserInstance();
    this.#assertOpen("browser context creation");
    const context = await this.#acquire(
      "browser context creation",
      () =>
        browser.newContext({
          viewport: viewport ?? { width: 1280, height: 900 },
        }),
      {
        register: (created) => this.contexts.add(created),
        dispose: (created) =>
          this.#disposeLate("browser context", () => created.close()),
      },
    );
    failureState.context = context;
    try {
      if (traceName) {
        await context.tracing.start({ screenshots: true, snapshots: true });
        failureState.tracingStarted = true;
      }
      this.#assertOpen("page creation");
      const page = await context.newPage();
      failureState.page = page;
      const errors = [];
      failureState.errors = errors;
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.addInitScript(
        ({ apiOrigin, token }) => {
          globalThis["__TANIKUN_SYNC_CONFIG__"] = {
            apiOrigin,
            token,
            maxRetry: 0,
          };
        },
        { apiOrigin: this.apiOrigin, token: identity.token },
      );
      if (beforeGoto) await beforeGoto(context, page);
      this.#assertOpen("page navigation");
      await page.goto(this.webOrigin);
      this.#assertOpen("page navigation");
      return { context, page, errors };
    } catch (error) {
      if (attachFailureState) {
        if (error && typeof error === "object") {
          error.syncHarnessFailureState = failureState;
        } else {
          this.contexts.delete(context);
          await context.close().catch(() => {});
        }
      } else {
        this.contexts.delete(context);
        await context.close().catch(() => {});
      }
      throw error;
    }
  }

  async openPage(identityName, { viewport } = {}) {
    this.#assertWebServer();
    return this.#newPage(identityName, viewport);
  }

  async runJourney(name, identityName, drive, { viewport } = {}) {
    this.#assertStarted();
    this.#assertWebServer();
    let context = null;
    let failureState = null;
    try {
      let page;
      let errors;
      try {
        ({ context, page, errors } = await this.#newPage(
          identityName,
          viewport,
          { traceName: name, attachFailureState: true },
        ));
      } catch (error) {
        failureState = error.syncHarnessFailureState ?? {
          context: null,
          page: null,
          errors: [],
          tracingStarted: false,
        };
        context = failureState.context;
        await this.#writeJourneyFailure(name, failureState, error);
        throw error;
      }
      try {
        await drive(page, errors);
        if (errors.length > 0)
          throw new Error(`browser errors: ${errors.join("; ")}`);
        await this.#stopSafeTrace(context, name, "trace");
      } catch (error) {
        await this.#writeJourneyFailure(
          name,
          { context, page, errors, tracingStarted: true },
          error,
        );
        throw error;
      }
    } finally {
      if (context) {
        this.contexts.delete(context);
        await context.close().catch(() => {});
      }
    }
  }

  // Run several isolated browser contexts in one named journey. Each page gets
  // its own trace, screenshot, and failure log so a two-browser failure keeps
  // evidence for both sides.
  async runJourneyGroup(name, specs, drive) {
    this.#assertStarted();
    this.#assertWebServer();
    const states = [];
    try {
      for (const spec of specs) {
        try {
          const created = await this.#newPage(spec.identity, spec.viewport, {
            traceName: `${name}-${spec.label}`,
            attachFailureState: true,
            beforeGoto: spec.beforeGoto,
          });
          states.push({ ...created, label: spec.label });
        } catch (error) {
          const failureState = error.syncHarnessFailureState ?? {
            context: null,
            page: null,
            errors: [],
            tracingStarted: false,
          };
          await this.#writeJourneyFailure(
            `${name}-${spec.label}`,
            failureState,
            error,
          );
          if (failureState.context) {
            this.contexts.delete(failureState.context);
            await failureState.context.close().catch(() => {});
          }
          throw error;
        }
      }
      try {
        await drive(
          states.map((state) => state.page),
          states.map((state) => state.errors),
          states,
        );
        const errors = states.flatMap((state) =>
          state.errors.map((message) => `[${state.label}] ${message}`),
        );
        if (errors.length > 0)
          throw new Error(`browser errors: ${errors.join("; ")}`);
        await this.#writeEvidence(
          `${name}.log`,
          `${states
            .map(
              (state) =>
                `${state.label}: page errors: ${JSON.stringify(state.errors)}`,
            )
            .join("\n")}\n`,
        );
        for (const state of states)
          await this.#stopSafeTrace(
            state.context,
            `${name}-${state.label}`,
            "trace",
          );
      } catch (error) {
        for (const state of states) {
          await this.#writeJourneyFailure(
            `${name}-${state.label}`,
            {
              context: state.context,
              page: state.page,
              errors: state.errors,
              tracingStarted: true,
            },
            error,
          );
        }
        throw error;
      }
    } finally {
      for (const state of states) {
        this.contexts.delete(state.context);
        await state.context
          .close()
          .catch((error) =>
            this.cleanupProblems.push(
              `browser context close: ${error.message}`,
            ),
          );
      }
    }
  }

  async #stopSafeTrace(context, name, suffix) {
    const rawPath = join(this.tempDir, `raw-${name}-${suffix}.zip`);
    const evidencePath = join(this.evidenceDir, `${name}-${suffix}.zip`);
    try {
      await context.tracing.stop({ path: rawPath });
      await sanitizeTraceArchive(rawPath, evidencePath);
    } finally {
      await rm(rawPath, { force: true }).catch(() => {});
    }
  }

  async #writeJourneyFailure(name, state, error) {
    const errors = state.errors ?? [];
    try {
      await this.#writeEvidence(
        `${name}-failure.log`,
        redactEvidenceText(
          `${error?.stack ?? String(error)}\npage errors: ${JSON.stringify(errors)}\n`,
        ),
      );
    } catch (writeError) {
      this.cleanupProblems.push(`failure log: ${writeError.message}`);
    }
    if (state.page) {
      try {
        await state.page.screenshot({
          path: join(this.evidenceDir, `${name}-failure.png`),
          fullPage: true,
        });
      } catch (screenshotError) {
        await this.#appendEvidence(
          `${name}-failure.log`,
          redactEvidenceText(`screenshot failed: ${screenshotError.message}\n`),
        ).catch(() => {});
      }
    }
    if (state.context && state.tracingStarted) {
      try {
        await this.#stopSafeTrace(state.context, name, "failure-trace");
      } catch (traceError) {
        await this.#appendEvidence(
          `${name}-failure.log`,
          redactEvidenceText(`trace failed: ${traceError.message}\n`),
        ).catch(() => {});
      }
    }
  }

  #assertStarted() {
    this.#assertOpen("harness use");
    if (!this.started || !this.apiOrigin)
      throw new Error("sync harness is not running");
  }

  #assertWebServer() {
    this.#assertStarted();
    if (!this.options.serveWeb)
      throw new Error(
        "sync harness web server is disabled; construct it with serveWeb: true for browser journeys",
      );
  }

  #assertOpen(action = "operation") {
    if (this.closing) throw harnessClosedError(action);
  }

  async #acquire(label, produce, { register, dispose }) {
    this.#assertOpen(label);
    const acquisition = (async () => {
      const resource = await produce();
      if (this.closing) {
        await dispose(resource);
        throw harnessClosedError(label);
      }
      register(resource);
      return resource;
    })();
    this.pendingAcquisitions.add(acquisition);
    try {
      return await acquisition;
    } finally {
      this.pendingAcquisitions.delete(acquisition);
    }
  }

  async #disposeLate(label, close, timeoutMs = 10_000) {
    try {
      await withTimeout(Promise.resolve(close()), timeoutMs, `${label} close`);
    } catch (error) {
      this.cleanupProblems.push(`${label} close: ${error.message}`);
    }
  }

  #installSignalHandlers() {
    this.#assertOpen("signal handler installation");
    for (const [signal, code] of [
      ["SIGINT", 130],
      ["SIGTERM", 143],
    ]) {
      const handler = () => {
        void this.close().finally(() => process.exit(code));
      };
      process.once(signal, handler);
      this.signalHandlers.set(signal, handler);
    }
  }

  #removeSignalHandlers() {
    for (const [signal, handler] of this.signalHandlers)
      process.off(signal, handler);
    this.signalHandlers.clear();
  }

  async #terminateGroup(child) {
    if (!child?.pid) return;
    if (processGroupExists(child.pid)) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
      if (!(await waitForGroupGone(child.pid, this.options.closeGraceMs))) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
        await waitForGroupGone(child.pid, 2_000);
      }
    }
    await waitForChildExit(child, 1_000);
  }

  async close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.#removeSignalHandlers();
    this.abortController.abort();
    this.closePromise = this.#close();
    return this.closePromise;
  }

  async #close() {
    try {
      await this.#waitForInFlightWork();
      await this.#releaseResources();
    } finally {
      this.started = false;
    }
  }

  async #waitForInFlightWork() {
    const start = this.startPromise
      ? this.startPromise.catch(() => {})
      : Promise.resolve();
    while (this.pendingAcquisitions.size > 0) {
      await Promise.allSettled(this.pendingAcquisitions);
    }
    await start;
    while (this.pendingAcquisitions.size > 0) {
      await Promise.allSettled(this.pendingAcquisitions);
    }
  }

  async #releaseResources() {
    this.#removeSignalHandlers();
    for (const context of this.contexts) {
      this.contexts.delete(context);
      try {
        await withTimeout(context.close(), 10_000, "browser context close");
      } catch (error) {
        this.cleanupProblems.push(`browser context close: ${error.message}`);
      }
    }
    const browser = this.browser;
    this.browser = null;
    this.browserLaunchPromise = null;
    if (browser) {
      try {
        await withTimeout(browser.close(), 15_000, "browser close");
      } catch (error) {
        this.cleanupProblems.push(`browser close: ${error.message}`);
      }
    }
    const wrangler = this.wrangler;
    this.wrangler = null;
    if (wrangler) {
      try {
        await this.#terminateGroup(wrangler);
      } catch (error) {
        this.cleanupProblems.push(`Wrangler cleanup: ${error.message}`);
      }
      this.ownedChildren.delete(wrangler);
    }
    for (const child of this.ownedChildren) {
      this.ownedChildren.delete(child);
      try {
        await this.#terminateGroup(child);
      } catch (error) {
        this.cleanupProblems.push(`owned command cleanup: ${error.message}`);
      }
    }
    const logSink = this.wranglerLog;
    this.wranglerLog = null;
    if (logSink) {
      try {
        await logSink.finish(wrangler, 2_000);
      } catch (error) {
        this.cleanupProblems.push(`Wrangler log close: ${error.message}`);
      }
      for (const message of logSink.errorMessages)
        this.cleanupProblems.push(`Wrangler log stream: ${message}`);
    }
    const server = this.server;
    this.server = null;
    if (server) {
      server.closeAllConnections();
      await new Promise((resolvePromise) => {
        server.close(() => resolvePromise());
      });
    }
    const cleanup = {
      wranglerPid: this.wranglerPid,
      processGroupAlive: processGroupExists(this.wranglerPid),
      tempDir: this.tempDir,
      problems: this.cleanupProblems,
    };
    if (this.evidenceDir) {
      try {
        await this.#writeEvidence(
          "cleanup.log",
          `${JSON.stringify(cleanup, null, 2)}\n`,
        );
      } catch (error) {
        this.cleanupProblems.push(`cleanup evidence: ${error.message}`);
      }
    }
    if (this.tempDir) {
      await rm(this.tempDir, { recursive: true, force: true });
    }
    this.started = false;
  }

  async #writeEvidence(name, text) {
    if (!this.evidenceDir) return;
    await writeFile(join(this.evidenceDir, name), redactEvidenceText(text));
  }

  async #appendEvidence(name, text) {
    if (!this.evidenceDir) return;
    const path = join(this.evidenceDir, name);
    const existing = (await pathExists(path))
      ? await readFile(path, "utf8")
      : "";
    await writeFile(path, redactEvidenceText(existing + text));
  }
}
