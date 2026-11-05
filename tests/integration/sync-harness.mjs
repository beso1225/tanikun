import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const wranglerBin = join(
  repositoryRoot,
  "node_modules/wrangler/bin/wrangler.js",
);

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

function redactLogText(text) {
  return text
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "<document-id>",
    )
    .replace(/\b[0-9a-f]{64}\b/gi, "<change-id>")
    .replace(/\bBearer\s+\S+/gi, "Bearer <redacted>");
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

function parseJsonc(text) {
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
    const relative =
      pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = resolve(root, relative);
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

export class SyncHarness {
  constructor(options = {}) {
    this.options = {
      webDist: resolve(
        options.webDist ??
          process.env.TANIKUN_WEB_DIST ??
          join(repositoryRoot, "apps/web/dist"),
      ),
      apiRoot: resolve(
        options.apiRoot ?? process.env.TANIKUN_API_DIST ?? repositoryRoot,
      ),
      readinessTimeoutMs: options.readinessTimeoutMs ?? 60_000,
      migrationTimeoutMs: options.migrationTimeoutMs ?? 60_000,
      closeGraceMs: options.closeGraceMs ?? 5_000,
    };
    this.evidenceDir = null;
    this.tempDir = null;
    this.apiOrigin = null;
    this.webOrigin = SYNC_WEB_ORIGIN;
    this.server = null;
    this.wrangler = null;
    this.wranglerPid = null;
    this.wranglerLogStream = null;
    this.wranglerLogBuffer = "";
    this.browser = null;
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
        `apiRoot=${this.options.apiRoot}`,
        `tempDir=${this.tempDir}`,
        `evidenceDir=${this.evidenceDir}`,
      ].join("\n") + "\n",
    );
    this.#assertOpen("startup");

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
      await requireFile(join(this.options.webDist, file), `web asset ${file}`);
    }
    this.#assertOpen("startup");

    const paths = await this.#readArtifact();
    this.#assertOpen("startup");
    const server = await startWebServer(this.options.webDist);
    this.server = server;
    this.#assertOpen("startup");
    await this.#appendEvidence("harness.log", `web server listening\n`);
    this.#assertOpen("startup");

    const configPath = join(this.tempDir, "wrangler.jsonc");
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
    this.#assertOpen("startup");

    await this.#applyMigrations(configPath);
    this.#assertOpen("startup");
    await this.#startWrangler(configPath);
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
    const main = resolve(this.options.apiRoot, config.main);
    const migrationsDir = resolve(
      this.options.apiRoot,
      database.migrations_dir,
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
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: Array.isArray(config.compatibility_flags)
        ? config.compatibility_flags
        : [],
    };
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
      WRANGLER_LOG_PATH: join(this.evidenceDir, `${kind}-wrangler-internal`),
      BROWSER: "none",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      CI: "1",
    };
  }

  async #applyMigrations(configPath) {
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
        cwd: this.tempDir,
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

  async #startWrangler(configPath) {
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
      cwd: this.tempDir,
      env: this.#environment("dev"),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.wrangler = child;
    this.wranglerPid = child.pid ?? null;
    this.ownedChildren.add(child);
    this.wranglerLogStream = createWriteStream(
      join(this.evidenceDir, "wrangler.log"),
      { flags: "a" },
    );
    let output = "";
    const record = (data) => {
      output += data;
      this.wranglerLogBuffer += data.toString();
      const lines = this.wranglerLogBuffer.split("\n");
      this.wranglerLogBuffer = lines.pop();
      for (const line of lines)
        this.wranglerLogStream.write(`${redactLogText(line)}\n`);
    };
    child.stdout.on("data", record);
    child.stderr.on("data", record);

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

  async #browserInstance() {
    this.#assertOpen("browser launch");
    if (this.browser) return this.browser;
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

  async #newPage(identityName, viewport, { traceName } = {}) {
    this.#assertStarted();
    const identity = identityFor(identityName);
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
    try {
      if (traceName)
        await context.tracing.start({ screenshots: true, snapshots: true });
      this.#assertOpen("page creation");
      const page = await context.newPage();
      const errors = [];
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
      this.#assertOpen("page navigation");
      await page.goto(this.webOrigin);
      this.#assertOpen("page navigation");
      return { context, page, errors };
    } catch (error) {
      this.contexts.delete(context);
      await context.close().catch(() => {});
      throw error;
    }
  }

  async openPage(identityName, { viewport } = {}) {
    return this.#newPage(identityName, viewport);
  }

  async runJourney(name, identityName, drive, { viewport } = {}) {
    this.#assertStarted();
    const { context, page, errors } = await this.#newPage(
      identityName,
      viewport,
      { traceName: name },
    );
    try {
      try {
        await drive(page, errors);
        if (errors.length > 0)
          throw new Error(`browser errors: ${errors.join("; ")}`);
        await context.tracing.stop({
          path: join(this.evidenceDir, `${name}-trace.zip`),
        });
      } catch (error) {
        await this.#writeEvidence(
          `${name}-failure.log`,
          `${error.stack ?? String(error)}\npage errors: ${JSON.stringify(errors)}\n`,
        );
        try {
          await page.screenshot({
            path: join(this.evidenceDir, `${name}-failure.png`),
            fullPage: true,
          });
        } catch (screenshotError) {
          await this.#appendEvidence(
            `${name}-failure.log`,
            `screenshot failed: ${screenshotError.message}\n`,
          );
        }
        try {
          await context.tracing.stop({
            path: join(this.evidenceDir, `${name}-failure-trace.zip`),
          });
        } catch (traceError) {
          await this.#appendEvidence(
            `${name}-failure.log`,
            `trace failed: ${traceError.message}\n`,
          );
        }
        throw error;
      }
    } finally {
      this.contexts.delete(context);
      await context.close().catch(() => {});
    }
  }

  #assertStarted() {
    this.#assertOpen("harness use");
    if (!this.started || !this.apiOrigin)
      throw new Error("sync harness is not running");
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
    const logStream = this.wranglerLogStream;
    this.wranglerLogStream = null;
    if (logStream) {
      if (this.wranglerLogBuffer) {
        logStream.write(redactLogText(this.wranglerLogBuffer));
        this.wranglerLogBuffer = "";
      }
      await new Promise((resolvePromise) => logStream.end(resolvePromise));
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
    await writeFile(join(this.evidenceDir, name), text);
  }

  async #appendEvidence(name, text) {
    if (!this.evidenceDir) return;
    const path = join(this.evidenceDir, name);
    const existing = (await pathExists(path))
      ? await readFile(path, "utf8")
      : "";
    await writeFile(path, existing + text);
  }
}
