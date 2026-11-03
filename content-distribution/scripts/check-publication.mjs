#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPublication } from "./publication-gate.mjs";
const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runsRoot = join(project, "runs");
const args = process.argv.slice(2);
if (args.length < 2 || args[0] !== "--run" ||
    args.slice(2).some(x => x !== "--reserve") || args.length > 3) {
  console.error("Usage: node scripts/check-publication.mjs --run <canonical-private-run-dir> [--reserve]");
  process.exit(2);
}
try {
  const runDir = realpathSync(args[1]);
  const trust = JSON.parse(readFileSync(join(project,"config/release-trust.json"),"utf8"));
  if (trust.schema !== "content-distribution.release-trust.v1") throw Error("invalid_trust_config");
  const result = verifyPublication({
    runDir, runsRoot, release:JSON.parse(readFileSync(join(runDir,"release.json"),"utf8")),
    keys:trust.keys, accountsMarkdown:readFileSync(join(project,"accounts.md"),"utf8"),
    providers:JSON.parse(readFileSync(join(project,"config/providers.json"),"utf8")),
    reserve:args.includes("--reserve")
  });
  console.log(JSON.stringify(result,null,2));
} catch (e) {
  // Never print evidence bodies or affiliate URLs.
  console.error(JSON.stringify({status:"PRIVATE_HOLD",reason:e.message}));
  process.exitCode=1;
}
