#!/usr/bin/env node
/**
 * Live Apify input-shape experiments for yc-companies-scraper.
 * Usage: node scripts/yc-apify-variations.mjs
 * Reads APIFY_TOKEN from .env — never prints it.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ApifyClient } from "apify-client";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ACTOR = "apivault_labs/yc-companies-scraper";

function loadEnv() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) throw new Error("Missing .env");
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

function baseInput(overrides) {
  return {
    query: "",
    batches: [],
    industries: [],
    regions: [],
    statuses: [],
    tags: [],
    isHiring: false,
    topCompaniesOnly: false,
    slugs: [],
    maxResults: 40,
    fullDetails: false,
    extractIndustry: true,
    extractBatch: true,
    extractLocation: true,
    extractTeamSize: true,
    extractStatus: true,
    extractSocials: false,
    extractTags: true,
    extractFounders: false,
    extractLongDescription: false,
    extractLogo: false,
    maxConcurrency: 5,
    timeout: 30,
    ...overrides,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitRun(client, runId) {
  for (let i = 0; i < 90; i += 1) {
    const run = await client.run(runId).get();
    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
      return run;
    }
    await sleep(2000);
  }
  throw new Error(`Timeout waiting for run ${runId}`);
}

async function algoliaLine(client, runId) {
  try {
    const log = await client.log(runId).get();
    const text = typeof log === "string" ? log : String(log ?? "");
    const match = text.match(/Algolia query:[^\n]+/i);
    return match ? match[0].trim() : null;
  } catch {
    return null;
  }
}

async function runVariant(client, name, overrides) {
  const input = baseInput(overrides);
  process.stdout.write(`\n=== ${name} ===\n`);
  process.stdout.write(
    `input: ${JSON.stringify({
      query: input.query,
      batches: input.batches,
      industries: input.industries,
      tags: input.tags,
      maxResults: input.maxResults,
    })}\n`,
  );
  const run = await client.actor(ACTOR).start(input, {
    maxTotalChargeUsd: 5,
  });
  const finished = await waitRun(client, run.id);
  const filter = await algoliaLine(client, finished.id);
  let total = 0;
  if (finished.defaultDatasetId) {
    const page = await client.dataset(finished.defaultDatasetId).listItems({
      limit: 1,
    });
    total = page.total ?? page.count ?? (page.items?.length ?? 0);
  }
  const row = {
    name,
    status: finished.status,
    statusMessage: finished.statusMessage ?? null,
    itemCount: total,
    algolia: filter,
    batches: input.batches,
    industries: input.industries,
    tags: input.tags,
    runId: finished.id,
  };
  process.stdout.write(`${JSON.stringify(row, null, 2)}\n`);
  return row;
}

async function main() {
  const env = loadEnv();
  const token = env.APIFY_TOKEN?.trim();
  if (!token || token.includes("test-")) {
    throw new Error("APIFY_TOKEN missing or test token");
  }
  const client = new ApifyClient({ token });
  const seasons2025 = ["Winter 2025", "Spring 2025", "Summer 2025", "Fall 2025"];
  const pastYearish = [
    "Summer 2026",
    "Spring 2026",
    "Winter 2026",
    "Fall 2025",
  ];

  const results = [];
  results.push(
    await runVariant(client, "2025_four_seasons_only", {
      batches: seasons2025,
    }),
  );
  results.push(
    await runVariant(client, "2025_four_seasons_Education", {
      batches: seasons2025,
      industries: ["Education"],
    }),
  );
  results.push(
    await runVariant(client, "2025_four_seasons_Fintech", {
      batches: seasons2025,
      industries: ["Fintech"],
    }),
  );
  results.push(
    await runVariant(client, "Education_only_control", {
      industries: ["Education"],
    }),
  );
  results.push(
    await runVariant(client, "Education_query_2025_pollute", {
      query: "2025",
      industries: ["Education"],
    }),
  );
  results.push(
    await runVariant(client, "Education_past_yearish_batches", {
      batches: pastYearish,
      industries: ["Education"],
    }),
  );
  results.push(
    await runVariant(client, "2025_four_seasons_Education_AI_tag", {
      batches: seasons2025,
      industries: ["Education"],
      tags: ["AI"],
    }),
  );

  process.stdout.write("\n=== SUMMARY ===\n");
  for (const r of results) {
    process.stdout.write(
      `${r.name}\t${r.status}\titems=${r.itemCount}\t${r.algolia ?? "(no log line)"}\n`,
    );
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
