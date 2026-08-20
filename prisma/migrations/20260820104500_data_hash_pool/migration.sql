-- Version pool for hash-based conditional fetching.
CREATE TABLE "DataHash" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "hash" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "DataHash_hash_idx" ON "DataHash"("hash");
