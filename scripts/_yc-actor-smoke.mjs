#!/usr/bin/env node
/**
 * Small live smokes for YC Apify actors (Savra-like filters).
 * Usage: node scripts/_yc-actor-smoke.mjs
 * Reads APIFY_TOKEN from .env — never prints it.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ApifyClient } from "apify-client";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAST_2Y = [
  "Fall 2026",
  "Summer 2026",
  "Spring 2026",
  "Winter 2026",
  "Fall 2025",
  "Summer 2025",
  "Spring 2025",
  "Winter 2025",
];
const RECENT_3 = ["Fall 2026", "Summer 2026", "Spring 2026"];

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitRun(client, runId) {
  for (let i = 0; i < 120; i += 1) {
    const run = await client.run(runId).get();
    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
      return run;
    }
    await sleep(2500);
  }
  throw new Error(`Timeout waiting for run ${runId}`);
}

function summarizeLog(text) {
  const lines = String(text ?? "").split("\n");
  const algolia = lines.find((l) => /algolia/i.test(l)) ?? null;
  const forbidden = lines.find((l) => /403|forbidden/i.test(l)) ?? null;
  const html = lines.find((l) => /ycombinator\.com\/companies|html|cheerio|bootstrap|secured.?key/i.test(l)) ?? null;
  const pathHint = forbidden
    ? "HTML_403"
    : algolia
      ? "ALGOLIA"
      : html
        ? "HTML_OR_MIXED"
        : "UNKNOWN";
  return {
    pathHint,
    algoliaLine: algolia?.replace(/^\S+\s+/, "").slice(0, 200) ?? null,
    forbiddenLine: forbidden?.replace(/^\S+\s+/, "").slice(0, 200) ?? null,
    interesting: lines
      .filter((l) =>
        /algolia|403|forbidden|html|companies|error|query|founder|scraped|done|filter/i.test(
          l,
        ),
      )
      .slice(0, 25)
      .map((l) => l.slice(0, 220)),
  };
}

function sampleItem(item) {
  if (!item || typeof item !== "object") return null;
  const founders = Array.isArray(item.founders)
    ? item.founders
    : Array.isArray(item.founder)
      ? item.founder
      : [];
  const founderSample = founders.slice(0, 2).map((f) => ({
    name: f?.name ?? f?.fullName ?? null,
    linkedin: f?.linkedinUrl ?? f?.linkedin ?? f?.linkedIn ?? null,
  }));
  return {
    name: item.name ?? item.companyName ?? item.title ?? null,
    batch: item.batch ?? item.batchName ?? item.batchCode ?? null,
    website: item.website ?? item.companyWebsite ?? item.url ?? null,
    industry: item.industry ?? (Array.isArray(item.industries) ? item.industries[0] : null),
    tags: item.tags ?? null,
    oneLiner: item.oneLiner ?? item.one_liner ?? item.description ?? null,
    foundersCount: founders.length,
    founderSample,
    fieldKeys: Object.keys(item).slice(0, 40),
  };
}

async function runCase(client, { name, actorId, input, maxCharge = 1.5 }) {
  const started = Date.now();
  process.stdout.write(`\n=== ${name} (${actorId}) ===\n`);
  process.stdout.write(`input: ${JSON.stringify(input).slice(0, 500)}\n`);
  const run = await client.actor(actorId).start(input, {
    maxTotalChargeUsd: maxCharge,
  });
  const finished = await waitRun(client, run.id);
  let logSummary = { pathHint: "UNKNOWN", interesting: [] };
  try {
    const log = await client.log(finished.id).get();
    logSummary = summarizeLog(log);
  } catch {
    /* ignore */
  }
  let items = [];
  let total = 0;
  if (finished.defaultDatasetId) {
    const page = await client.dataset(finished.defaultDatasetId).listItems({
      limit: 5,
    });
    items = page.items ?? [];
    total = page.total ?? page.count ?? items.length;
  }
  const row = {
    name,
    actorId,
    status: finished.status,
    statusMessage: finished.statusMessage ?? null,
    itemCount: total,
    usageTotalUsd: finished.usageTotalUsd ?? null,
    elapsedMs: Date.now() - started,
    runId: finished.id,
    datasetId: finished.defaultDatasetId,
    pathHint: logSummary.pathHint,
    algoliaLine: logSummary.algoliaLine,
    forbiddenLine: logSummary.forbiddenLine,
    logInteresting: logSummary.interesting,
    samples: items.map(sampleItem),
    input,
  };
  process.stdout.write(
    `${JSON.stringify({ ...row, logInteresting: undefined, samples: row.samples?.slice(0, 2) }, null, 2)}\n`,
  );
  return row;
}

async function main() {
  const env = loadEnv();
  const token = env.APIFY_TOKEN?.trim();
  if (!token || token.includes("test-")) {
    throw new Error("APIFY_TOKEN missing or test token");
  }
  const client = new ApifyClient({ token });
  const results = [];

  // Current actor: empty query + recent batches (known-good shape historically)
  results.push(
    await runCase(client, {
      name: "apivault_empty_query_recent_batches",
      actorId: "apivault_labs/yc-companies-scraper",
      input: {
        query: "",
        batches: RECENT_3,
        industries: [],
        regions: [],
        statuses: [],
        tags: [],
        isHiring: false,
        topCompaniesOnly: false,
        slugs: [],
        maxResults: 20,
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
      },
    }),
  );

  // Current actor: Savra-like keywords in query
  results.push(
    await runCase(client, {
      name: "apivault_query_teaching_AI",
      actorId: "apivault_labs/yc-companies-scraper",
      input: {
        query: "AI teaching",
        batches: PAST_2Y,
        industries: ["Education"],
        regions: [],
        statuses: [],
        tags: ["AI"],
        isHiring: false,
        topCompaniesOnly: false,
        slugs: [],
        maxResults: 20,
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
      },
    }),
  );

  // haketa — direct Algolia; Savra-like
  results.push(
    await runCase(client, {
      name: "haketa_savra_like",
      actorId: "haketa/ycombinator-companies-scraper",
      input: {
        query: "",
        batches: PAST_2Y,
        industries: ["Education"],
        hiringOnly: false,
        topCompaniesOnly: false,
        maxRecords: 25,
        hitsPerPage: 100,
        requestDelay: 200,
      },
    }),
  );

  // haketa with AI query + tags if supported
  results.push(
    await runCase(client, {
      name: "haketa_AI_query_past2y",
      actorId: "haketa/ycombinator-companies-scraper",
      input: {
        query: "AI",
        batches: PAST_2Y,
        industries: ["Education"],
        tags: ["AI"],
        hiringOnly: false,
        topCompaniesOnly: false,
        maxRecords: 25,
        hitsPerPage: 100,
        requestDelay: 200,
      },
    }),
  );

  // memo23 companies mode — Algolia, no founder enrich (avoid HTML)
  results.push(
    await runCase(client, {
      name: "memo23_companies_savra_like",
      actorId: "memo23/y-combinator-scraper",
      input: {
        mode: "companies",
        startUrls: [],
        queries: [],
        batch: PAST_2Y,
        industries: ["Education"],
        regions: ["All regions"],
        isHiring: false,
        topCompany: false,
        scrapeFounderDetails: false,
        scrapeOpenJobs: false,
        maxItems: 25,
      },
    }),
  );

  // memo23 with AI query
  results.push(
    await runCase(client, {
      name: "memo23_companies_AI_query",
      actorId: "memo23/y-combinator-scraper",
      input: {
        mode: "companies",
        startUrls: [],
        queries: ["AI"],
        batch: PAST_2Y,
        industries: ["Education"],
        regions: ["All regions"],
        isHiring: false,
        topCompany: false,
        scrapeFounderDetails: false,
        scrapeOpenJobs: false,
        maxItems: 25,
      },
    }),
  );

  const outPath = join(ROOT, "evals", "yc-actor-smoke-raw.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  process.stdout.write(`\nWrote ${outPath}\n`);
  process.stdout.write(
    `\nSUMMARY\n${results
      .map(
        (r) =>
          `${r.name}: ${r.status} items=${r.itemCount} path=${r.pathHint} usd=${r.usageTotalUsd} ms=${r.elapsedMs}`,
      )
      .join("\n")}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
