#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

function usesCohesivity() {
  if (process.env.SCRAPER_TEST_MODE === "1" || process.env.NODE_ENV === "test") {
    return false;
  }
  if (process.env.DATABASE_PROVIDER === "sqlite") return false;
  if (process.env.DATABASE_PROVIDER === "cohesivity") return true;
  return Boolean(
    process.env.COH_APPLICATION_KEY?.trim() ||
      process.env.COHESIVITY_APPLICATION_KEY?.trim(),
  );
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    cwd: path.join(root, ".."),
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (usesCohesivity()) {
  run("node", [path.join(root, "ensure-cohesivity-schema.mjs")]);
} else {
  run("npx", ["prisma", "migrate", "deploy"]);
}

const port = process.env.PORT || "3000";
run("npx", ["next", "start", "-H", "0.0.0.0", "-p", String(port)]);
