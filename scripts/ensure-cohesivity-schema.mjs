#!/usr/bin/env node
/** Idempotent Cohesivity Postgres schema bootstrap (no TS/bundler required). */

const EDGE_URL = "https://cohesivity.ai/edge/postgres";
const USER_AGENT = "AtlasResearch/1.0 (start)";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "Query" (
    "id" TEXT PRIMARY KEY,
    "text" TEXT NOT NULL,
    "interpretation" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "synthesisStartedAt" TIMESTAMPTZ,
    "costEstimateUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS "Job" (
    "id" TEXT PRIMARY KEY,
    "queryId" TEXT NOT NULL REFERENCES "Query"("id") ON DELETE CASCADE,
    "connectorId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "apifyRunId" TEXT,
    "apifyDatasetId" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "finishedAt" TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS "Result" (
    "id" TEXT PRIMARY KEY,
    "queryId" TEXT NOT NULL REFERENCES "Query"("id") ON DELETE CASCADE,
    "jobId" TEXT NOT NULL REFERENCES "Job"("id") ON DELETE CASCADE,
    "sourceType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "mergeKey" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "data" JSONB NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "DataHash" (
    "key" TEXT PRIMARY KEY,
    "hash" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS "Job_queryId_stepIndex_idx" ON "Job"("queryId", "stepIndex")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Result_queryId_mergeKey_key" ON "Result"("queryId", "mergeKey")`,
  `CREATE INDEX IF NOT EXISTS "Result_queryId_sourceType_idx" ON "Result"("queryId", "sourceType")`,
  `CREATE INDEX IF NOT EXISTS "DataHash_hash_idx" ON "DataHash"("hash")`,
  `ALTER TABLE "Query" ADD COLUMN IF NOT EXISTS "progressiveBrief" JSONB`,
];

function applicationKey() {
  return (
    process.env.COH_APPLICATION_KEY?.trim() ||
    process.env.COHESIVITY_APPLICATION_KEY?.trim() ||
    ""
  );
}

function usesCohesivity() {
  if (process.env.SCRAPER_TEST_MODE === "1" || process.env.NODE_ENV === "test") {
    return false;
  }
  if (process.env.DATABASE_PROVIDER === "sqlite") return false;
  if (process.env.DATABASE_PROVIDER === "cohesivity") return true;
  return Boolean(applicationKey());
}

async function pgBatch(statements) {
  const key = applicationKey();
  if (!key) throw new Error("COH_APPLICATION_KEY is required");
  const response = await fetch(`${EDGE_URL}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      statements: statements.map((query) => ({ query, params: [] })),
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Schema bootstrap failed (${response.status}): ${text}`);
  }
}

async function main() {
  if (!usesCohesivity()) {
    console.log("[db] skipping Cohesivity schema (sqlite/test mode)");
    return;
  }
  await pgBatch(STATEMENTS);
  console.log("[db] Cohesivity Postgres schema ready");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
