import { defineConfig } from "vitest/config";
import path from "node:path";

process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING = "true";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false,
    env: {
      SCRAPER_TEST_MODE: "1",
      DATABASE_URL: "file:./test.db",
      MAX_QUERY_COST_USD: "5",
      MAX_ITEMS_CAP: "100",
      APIFY_TOKEN: "test-apify-token",
      ANTHROPIC_API_KEY: "test-anthropic-key",
      OPENROUTER_API_KEY: "sk-or-v-test-placeholder-not-live",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
