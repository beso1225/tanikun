import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temp = join(root, ".cache/mutation-requirements");
const sourcePackages = ["domain", "requirements"];
const targetPackages = ["tanikun-domain", "tanikun-requirements"];

rmSync(temp, { recursive: true, force: true });
mkdirSync(temp, { recursive: true });

for (const [index, source] of sourcePackages.entries()) {
  const target = join(temp, targetPackages[index]);
  mkdirSync(target, { recursive: true });
  const sourceDir = join(root, "packages", source);
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      (entry.name.endsWith(".mbt") || entry.name === "moon.pkg")
    ) {
      cpSync(join(sourceDir, entry.name), join(target, entry.name));
    }
  }
}

writeFileSync(
  join(temp, "moon.mod"),
  `name = "beso1225/tanikun-mutation"\n\nversion = "0.1.0"\n\npreferred_target = "js"\n\nsupported_targets = "js"\n`,
);

const requirementsPkg = join(temp, "tanikun-requirements", "moon.pkg");
const rewritten = readFileSync(requirementsPkg, "utf8").replace(
  '"beso1225/tanikun-domain"',
  '"beso1225/tanikun-mutation/tanikun-domain"',
);
if (rewritten === readFileSync(requirementsPkg, "utf8")) {
  throw new Error("failed to rewrite the requirements domain import");
}
writeFileSync(requirementsPkg, rewritten);

const result = spawnSync(
  "turtles",
  [
    "--dir",
    temp,
    "--file",
    "tanikun-requirements",
    "--target",
    "js",
    "--jobs",
    "2",
    "--fail-under",
    "0",
    "--json",
    join(root, ".cache", "turtles-requirements.json"),
  ],
  { cwd: root, stdio: "inherit" },
);
process.exit(result.status ?? 1);
