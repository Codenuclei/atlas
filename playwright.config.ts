import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
    // Sandbox/CI hosts often resolve localhost to ::1 only; Chromium does
    // not fall back to IPv4, so pin localhost to the loopback the server binds.
    launchOptions: {
      args: ["--host-resolver-rules=MAP localhost 127.0.0.1"],
    },
  },
  webServer: {
    command: "npx prisma db push --skip-generate --accept-data-loss && npm run dev -- --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      SCRAPER_TEST_MODE: "1",
      DATABASE_URL: "file:./e2e.db",
      MAX_QUERY_COST_USD: "5",
      MAX_ITEMS_CAP: "100",
      APIFY_TOKEN: "test-apify-token",
      ANTHROPIC_API_KEY: "test-anthropic-key",
      OPENROUTER_API_KEY: "sk-or-v-test-placeholder-not-live",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
