#!/usr/bin/env npx tsx
/**
 * One-shot YC orchestrator call. Prints a single JSON object to stdout.
 * Usage: npx tsx scripts/_yc-orch-one.mts "education companies in 2025"
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnv();
delete process.env.SCRAPER_TEST_MODE;
if (process.env.NODE_ENV === "test") process.env.NODE_ENV = "development";

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.log(JSON.stringify({ ok: false, error: "missing query argv" }));
  process.exit(2);
}

const { orchestrateYcSearch } = await import(
  "../src/lib/ai/yc-search-orchestrator.ts"
);
const { prepareYcActorInput } = await import(
  "../src/lib/connectors/yc-companies.ts"
);

try {
  const result = await orchestrateYcSearch(query);
  const actorInput = prepareYcActorInput(result.params);
  console.log(
    JSON.stringify({
      ok: true,
      params: result.params,
      actorInput,
      rationale: result.rationale,
      toolCalls: result.toolCalls,
      source: result.source,
    }),
  );
} catch (err) {
  const e = err as { code?: string; message?: string; status?: number };
  console.log(
    JSON.stringify({
      ok: false,
      error: e?.message ?? String(err),
      code: e?.code ?? "UNKNOWN",
      status: e?.status,
    }),
  );
  process.exitCode = 1;
}
