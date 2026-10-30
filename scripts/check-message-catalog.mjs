import { readFileSync } from "node:fs";

const source = readFileSync("apps/web/app/planner_transitions.mbt", "utf8");
const docs = readFileSync("docs/PHASE_2.md", "utf8");

const enumStart = source.indexOf("pub(all) enum PlannerMsg {");
if (enumStart < 0) throw new Error("PlannerMsg enum not found");
const enumEnd = source.indexOf("\n}", enumStart);
if (enumEnd < 0) throw new Error("PlannerMsg enum terminator not found");
const variants = [
  ...source.slice(enumStart, enumEnd).matchAll(/^\s*([A-Z][A-Za-z0-9_]*)\b/gm),
].map((match) => match[1]);

const sectionStart = docs.indexOf("## Message catalog");
const sectionEnd = docs.indexOf("\n## ", sectionStart + 1);
if (sectionStart < 0 || sectionEnd < 0) {
  throw new Error("message catalog section not found");
}
const rows = [
  ...docs.slice(sectionStart, sectionEnd).matchAll(/^\|\s*`([A-Za-z0-9_]+)/gm),
].map((match) => match[1]);

const missing = variants.filter((name) => !rows.includes(name));
const extra = rows.filter((name) => !variants.includes(name));
if (missing.length || extra.length) {
  const parts = [];
  if (missing.length) parts.push(`missing rows: ${missing.join(", ")}`);
  if (extra.length) parts.push(`unknown rows: ${extra.join(", ")}`);
  throw new Error(`PHASE_2 message catalog mismatch: ${parts.join("; ")}`);
}
console.log(`message catalog: ${variants.length} entries`);
