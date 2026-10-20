import { execFileSync, spawn } from "node:child_process";

const cli = "node_modules/@tailwindcss/cli/dist/index.mjs";
const cssArgs = ["-i", "apps/web/styles/input.css", "-o", "apps/web/public/styles.css"];

// Warren must find the stylesheet on its first build.
execFileSync(process.execPath, [cli, ...cssArgs], { stdio: "inherit" });

const children = [];
let stopping = false;
let timer;

function signalGroup(child, signal) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) signalGroup(child, "SIGTERM");
  timer = setTimeout(() => {
    for (const child of children) signalGroup(child, "SIGKILL");
  }, 5_000);
}

function start(command, args) {
  const child = spawn(command, args, { detached: true, stdio: "inherit" });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => stop(code ?? 1));
  child.on("close", () => {
    if (children.every((process) => process.exitCode !== null || process.signalCode !== null || !process.pid)) {
      clearTimeout(timer);
    }
  });
}

process.once("SIGINT", () => stop(130));
process.once("SIGTERM", () => stop(143));
start(process.execPath, [cli, ...cssArgs, "--watch=always"]);
start("warren", ["-C", "apps/web", "dev"]);
