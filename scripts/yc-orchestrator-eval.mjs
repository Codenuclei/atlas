#!/usr/bin/env node
/**
 * Run YC orchestrator eval queries one-by-one and grade filters.
 *
 * Usage:
 *   node scripts/yc-orchestrator-eval.mjs
 *   node scripts/yc-orchestrator-eval.mjs --id B01
 *   node scripts/yc-orchestrator-eval.mjs --from C01 --limit 5
 *   node scripts/yc-orchestrator-eval.mjs --tier basic
 *
 * Never prints API keys.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSV_PATH = join(ROOT, "evals/yc-orchestrator-queries.csv");
const RESULTS_JSONL = join(ROOT, "evals/yc-orchestrator-results.jsonl");
const RESULTS_CSV = join(ROOT, "evals/yc-orchestrator-results.csv");
const LATEST_JSON = join(ROOT, "evals/yc-orchestrator-latest.json");
const YEAR_2025 = ["Winter 2025", "Spring 2025", "Summer 2025", "Fall 2025"];

function loadEnvIntoProcess() {
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

/** Minimal RFC4180-ish CSV parser (handles quotes and newlines in fields). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).map((cells) => {
    const obj = {};
    for (let h = 0; h < headers.length; h += 1) {
      obj[headers[h]] = cells[h] ?? "";
    }
    return obj;
  });
}

function parseArgs(argv) {
  const out = { id: null, from: null, limit: null, tier: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--id") out.id = argv[++i];
    else if (a === "--from") out.from = argv[++i];
    else if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--tier") out.tier = argv[++i];
  }
  return out;
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].map((x) => x.toLowerCase()).sort();
  const sb = [...b].map((x) => x.toLowerCase()).sort();
  return sa.every((v, idx) => v === sb[idx]);
}

function grade(row, payload) {
  const failures = [];
  if (!payload.ok) {
    const code = String(payload.code ?? "");
    const kind =
      code === "UNAUTHORIZED" || code === "INTERNAL" || code === "UNKNOWN"
        ? "code_failure"
        : "plan_invalid";
    failures.push(`${kind}: ${payload.error ?? "orchestrator failed"}`);
    return { pass: false, failures, kind };
  }

  const params = payload.params ?? {};
  const actor = payload.actorInput ?? {};
  const industry = String(params.industry ?? actor.industries?.[0] ?? "");
  const batches = Array.isArray(actor.batches) ? actor.batches : [];
  const tags = Array.isArray(actor.tags) ? actor.tags : [];
  const query = String(actor.query ?? "");
  const isHiring = Boolean(actor.isHiring);

  if (row.expect_industry) {
    if (industry.toLowerCase() !== row.expect_industry.toLowerCase()) {
      failures.push(
        `industry: want ${row.expect_industry}, got ${industry || "(empty)"}`,
      );
    }
  }

  const mode = row.expect_batches_mode || "";
  if (mode === "none") {
    if (batches.length !== 0) {
      failures.push(`batches: want none, got ${JSON.stringify(batches)}`);
    }
  } else if (mode === "year:2025") {
    if (!sameSet(batches, YEAR_2025)) {
      failures.push(
        `batches: want four 2025 seasons, got ${JSON.stringify(batches)}`,
      );
    }
  } else if (mode === "year:2025_or_months") {
    const yearOk = sameSet(batches, YEAR_2025);
    const monthsOk = batches.length >= 3 && batches.length <= 8;
    if (!yearOk && !monthsOk) {
      failures.push(
        `batches: want 2025 seasons or months lookback, got ${JSON.stringify(batches)}`,
      );
    }
  } else if (mode === "months:12") {
    if (batches.length < 3 || batches.length > 5) {
      failures.push(
        `batches: want ~12mo (3-5 seasons), got ${batches.length}: ${JSON.stringify(batches)}`,
      );
    }
  } else if (mode === "months:24") {
    if (batches.length < 6 || batches.length > 10) {
      failures.push(
        `batches: want ~24mo (6-10 seasons), got ${batches.length}: ${JSON.stringify(batches)}`,
      );
    }
  } else if (mode.startsWith("batch:")) {
    const want = mode.slice("batch:".length);
    if (!batches.map((b) => b.toLowerCase()).includes(want.toLowerCase())) {
      failures.push(`batches: missing ${want}, got ${JSON.stringify(batches)}`);
    }
  } else if (mode === "current") {
    if (batches.length !== 1) {
      failures.push(
        `batches: want current (1), got ${JSON.stringify(batches)}`,
      );
    }
  } else if (mode === "none_or_one" || mode === "none_or_Fintech") {
    // soft: no hard batch requirement
  } else if (mode === "constrained" || mode === "prefer_explicit_or_2025") {
    if (!industry && batches.length === 0 && !query) {
      failures.push("filters: empty after constrained ask");
    }
  }

  const tagExpect = row.expect_tags || "";
  if (tagExpect === "empty") {
    if (tags.length !== 0) {
      failures.push(`tags: want empty, got ${JSON.stringify(tags)}`);
    }
  } else if (tagExpect === "AI") {
    if (!tags.some((t) => t.toLowerCase() === "ai")) {
      failures.push(`tags: want AI, got ${JSON.stringify(tags)}`);
    }
  } else if (tagExpect === "minimal") {
    if (tags.length > 1) {
      failures.push(`tags: want <=1, got ${JSON.stringify(tags)}`);
    }
  }

  if (String(row.expect_query_empty).toLowerCase() === "true") {
    if (query !== "") {
      failures.push(`query: want empty, got ${JSON.stringify(query)}`);
    }
  }

  if (row.expect_is_hiring === "true" || row.expect_is_hiring === "false") {
    const want = row.expect_is_hiring === "true";
    if (isHiring !== want) {
      failures.push(`isHiring: want ${want}, got ${isHiring}`);
    }
  }

  if (/^\d{4}$/.test(query.trim()) || query.trim() === "2025") {
    failures.push(`query: year leaked into query (${query})`);
  }
  if (/\b2025\b/.test(query) && query.trim().length <= 8) {
    failures.push(`query: year-ish query ${JSON.stringify(query)}`);
  }

  if (
    industry &&
    tags.some((t) => t.toLowerCase() === industry.toLowerCase())
  ) {
    failures.push(`duplicate industry+tag concept: ${industry}`);
  }

  if (mode === "none_or_Fintech") {
    if (
      industry &&
      industry.toLowerCase() !== "fintech" &&
      industry.toLowerCase() !== ""
    ) {
      // allow empty or Fintech only when brand noise present
      if (industry.toLowerCase() !== "fintech") {
        failures.push(
          `industry: want empty or Fintech for brand-noise ask, got ${industry}`,
        );
      }
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    kind: failures.length ? "grade_fail" : "pass",
  };
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function runOne(query) {
  const env = { ...process.env };
  delete env.SCRAPER_TEST_MODE;
  if (env.NODE_ENV === "test") env.NODE_ENV = "development";

  const res = spawnSync(
    "npx",
    ["tsx", "scripts/_yc-orch-one.mts", query],
    {
      cwd: ROOT,
      env,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 180_000,
    },
  );

  const stdout = (res.stdout || "").trim();
  const stderr = (res.stderr || "").trim();
  let payload;
  try {
    const line = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1);
    payload = JSON.parse(line || "{}");
  } catch {
    payload = {
      ok: false,
      error: `bad JSON from one-shot (status=${res.status}): ${stdout.slice(0, 400)} ${stderr.slice(0, 400)}`,
      code: "UNKNOWN",
    };
  }
  return { payload, stderr, status: res.status };
}

function main() {
  loadEnvIntoProcess();
  mkdirSync(join(ROOT, "evals"), { recursive: true });

  const args = parseArgs(process.argv.slice(2));
  let rows = parseCsv(readFileSync(CSV_PATH, "utf8"));
  if (args.tier) rows = rows.filter((r) => r.tier === args.tier);
  if (args.id) rows = rows.filter((r) => r.id === args.id);
  if (args.from) {
    const idx = rows.findIndex((r) => r.id === args.from);
    if (idx >= 0) rows = rows.slice(idx);
  }
  if (args.limit != null && Number.isFinite(args.limit)) {
    rows = rows.slice(0, args.limit);
  }

  if (!rows.length) {
    console.error("No rows to run");
    process.exit(1);
  }

  const hasKey =
    (process.env.ANTHROPIC_API_KEY || "").startsWith("sk-ant-") &&
    !(process.env.ANTHROPIC_API_KEY || "").includes("test-");
  if (!hasKey) {
    console.error("ANTHROPIC_API_KEY missing or placeholder — cannot run live eval");
    process.exit(1);
  }

  const summary = {
    startedAt: new Date().toISOString(),
    total: rows.length,
    passed: 0,
    failed: 0,
    codeFailures: 0,
    results: [],
  };

  const csvHeader =
    "id,tier,pass,kind,industry,batches,tags,query,isHiring,toolCalls,failures,rationale\n";
  if (!existsSync(RESULTS_CSV)) writeFileSync(RESULTS_CSV, csvHeader);

  for (const row of rows) {
    process.stdout.write(`\n=== ${row.id} [${row.tier}/${row.category}] ===\n`);
    process.stdout.write(`Q: ${row.query.replace(/\n/g, " / ")}\n`);
    const { payload } = runOne(row.query);
    const graded = grade(row, payload);
    const actor = payload.actorInput ?? {};
    const line = {
      id: row.id,
      tier: row.tier,
      category: row.category,
      query: row.query,
      pass: graded.pass,
      kind: graded.kind,
      failures: graded.failures,
      params: payload.params ?? null,
      actorInput: actor,
      rationale: payload.rationale ?? "",
      toolCalls: payload.toolCalls ?? 0,
      error: payload.error ?? null,
      code: payload.code ?? null,
      at: new Date().toISOString(),
    };
    appendFileSync(RESULTS_JSONL, `${JSON.stringify(line)}\n`);
    appendFileSync(
      RESULTS_CSV,
      [
        row.id,
        row.tier,
        graded.pass ? "PASS" : "FAIL",
        graded.kind,
        actor.industries?.[0] ?? payload.params?.industry ?? "",
        (actor.batches ?? []).join("|"),
        (actor.tags ?? []).join("|"),
        actor.query ?? "",
        String(Boolean(actor.isHiring)),
        String(payload.toolCalls ?? ""),
        graded.failures.join("; "),
        payload.rationale ?? "",
      ]
        .map(csvEscape)
        .join(",") + "\n",
    );

    if (graded.pass) {
      summary.passed += 1;
      console.log(
        `PASS  industry=${actor.industries?.[0] ?? ""} batches=${JSON.stringify(actor.batches ?? [])} tags=${JSON.stringify(actor.tags ?? [])} query=${JSON.stringify(actor.query ?? "")} hiring=${Boolean(actor.isHiring)} tools=${payload.toolCalls ?? 0}`,
      );
    } else {
      summary.failed += 1;
      if (graded.kind === "code_failure") summary.codeFailures += 1;
      console.log(`FAIL  ${graded.failures.join(" | ")}`);
      if (payload.ok) {
        console.log(
          `      got industry=${actor.industries?.[0] ?? ""} batches=${JSON.stringify(actor.batches ?? [])} tags=${JSON.stringify(actor.tags ?? [])} query=${JSON.stringify(actor.query ?? "")} hiring=${Boolean(actor.isHiring)}`,
        );
      }
    }
    summary.results.push({
      id: row.id,
      pass: graded.pass,
      kind: graded.kind,
      failures: graded.failures,
    });
  }

  summary.finishedAt = new Date().toISOString();
  writeFileSync(LATEST_JSON, JSON.stringify(summary, null, 2));
  console.log(
    `\nDone: ${summary.passed}/${summary.total} passed, ${summary.failed} failed (${summary.codeFailures} code failures)`,
  );
  process.exit(summary.failed ? 1 : 0);
}

main();
