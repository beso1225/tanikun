import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const syncContractSource = resolve(
  root,
  "packages/sync-contract/contract.mjs",
);

// Copy the one shared contract module unchanged. The browser imports the same
// bytes the Worker uses; there is no second validation implementation.
export function buildSyncContract(destination) {
  const target = resolve(destination);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(syncContractSource, target);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  buildSyncContract(
    process.argv[2] ?? resolve(root, "apps/web/dist/sync-contract.mjs"),
  );
}
