// Fail-closed check for default, preview, and production Wrangler configs.
// Phase 5 permits dev bearer and session auth only in explicit local/test
// configurations. A deployment config must not carry either mode, dev
// mappings, the deterministic test-document hook, or a public plaintext sync
// switch. Keep diagnostics bounded: report the config location and key name,
// never the configured value.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { parseJsonc } from "./parse-jsonc.mjs";

export const FORBIDDEN_AUTH_KEYS = Object.freeze([
  "AUTH_MODE",
  "DEV_AUTH",
  "DEV_AUTH_IDENTITIES",
  "AUTH_ORIGIN",
  "RP_ID",
  "AUTH_RATE_LIMIT_KEY",
  "TEST_NEW_DOCUMENT_ID",
]);

export const FORBIDDEN_PUBLIC_SYNC_KEYS = Object.freeze([
  "ALLOW_PUBLIC_SYNC",
  "SYNC_PUBLIC",
  "SYNC_PLAINTEXT_PUBLIC",
  "PUBLIC_PLAINTEXT_SYNC",
]);

function configSections(config) {
  const sections = [{ label: "vars", vars: config?.vars }];
  if (
    config?.env &&
    typeof config.env === "object" &&
    !Array.isArray(config.env)
  ) {
    for (const [name, environment] of Object.entries(config.env)) {
      sections.push({
        label: `env.${name}.vars`,
        vars: environment?.vars,
      });
    }
  }
  return sections;
}

export function deploymentConfigErrors(config) {
  const errors = [];
  const forbidden = new Set([
    ...FORBIDDEN_AUTH_KEYS,
    ...FORBIDDEN_PUBLIC_SYNC_KEYS,
  ]);
  for (const { label, vars } of configSections(config)) {
    if (!vars || typeof vars !== "object" || Array.isArray(vars)) continue;
    for (const key of Object.keys(vars))
      if (forbidden.has(key)) errors.push(`${label}.${key}`);
    if (vars.APP_ENV === "local") errors.push(`${label}.APP_ENV=local`);
  }
  return errors;
}

export function assertDeploymentConfig(config, source = "deployment config") {
  const errors = deploymentConfigErrors(config);
  if (errors.length > 0)
    throw new Error(
      `${source} enables a disallowed Phase 5 auth or public sync setting: ${errors.join(
        ", ",
      )}`,
    );
}

function main(argv) {
  const path = argv[2] ?? "wrangler.jsonc";
  const config = parseJsonc(readFileSync(path, "utf8"));
  assertDeploymentConfig(config, path);
  process.stdout.write(`${path}: deployment configuration is closed\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv);
