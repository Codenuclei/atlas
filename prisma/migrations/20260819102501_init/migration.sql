-- CreateTable
CREATE TABLE "Query" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "interpretation" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "synthesisStartedAt" DATETIME,
    "costEstimateUsd" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "queryId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "apifyRunId" TEXT,
    "apifyDatasetId" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "Job_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "Query" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Result" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "queryId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "mergeKey" TEXT NOT NULL,
    "score" REAL,
    "data" JSONB NOT NULL,
    CONSTRAINT "Result_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "Query" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Result_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Job_queryId_stepIndex_idx" ON "Job"("queryId", "stepIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Result_queryId_mergeKey_key" ON "Result"("queryId", "mergeKey");

-- CreateIndex
CREATE INDEX "Result_queryId_sourceType_idx" ON "Result"("queryId", "sourceType");
