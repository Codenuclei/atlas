import { pgBatch, pgQuery } from "@/lib/cohesivity/postgres";

const SCHEMA_STATEMENTS = [
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
];

let ensured = false;

/** Idempotent table bootstrap for Cohesivity Postgres (HTTP edge). */
export async function ensureCohesivitySchema() {
  if (ensured) return;
  // CREATE INDEX / TABLE cannot share one multi-statement string; run as batch txn.
  await pgBatch(SCHEMA_STATEMENTS.map((query) => ({ query })));
  ensured = true;
}

export async function cohesivityHealthcheck() {
  await ensureCohesivitySchema();
  const result = await pgQuery(`SELECT 1 AS ok`);
  return result.rows[0]?.ok === 1 || result.rows[0]?.ok === "1";
}
