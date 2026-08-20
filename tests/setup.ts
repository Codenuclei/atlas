import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

process.env.SCRAPER_TEST_MODE = "1";
process.env.DATABASE_URL = "file:./test.db";
process.env.MAX_QUERY_COST_USD = "5";
process.env.MAX_ITEMS_CAP = "100";
process.env.APIFY_TOKEN = "test-apify-token";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

const dbPath = path.resolve(process.cwd(), "prisma/test.db");
rmSync(dbPath, { force: true });
rmSync(`${dbPath}-journal`, { force: true });
execSync("npx prisma db push --skip-generate --accept-data-loss", {
  stdio: "pipe",
  env: { ...process.env, DATABASE_URL: "file:./test.db" },
});
