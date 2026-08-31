#!/usr/bin/env node
/**
 * Deploy this app to Cohesivity Railway hosting.
 *
 * Prerequisites:
 *   1. npx @cohesivity/init   (writes .cohesivity with management key)
 *   2. Env vars available via process.env or .env (APIFY_TOKEN, etc.)
 *
 * Usage: npm run deploy:cohesivity
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const COHESIVITY_FILE = join(ROOT, ".cohesivity");
const BASE = "https://cohesivity.ai";

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "coverage",
  "test-results",
  "playwright-report",
  "blob-report",
  ".cursor",
]);

const EXCLUDE_FILES = new Set([".env", ".cohesivity", ".DS_Store"]);

const ENV_KEYS = [
  "APIFY_TOKEN",
  "ANTHROPIC_API_KEY",
  "APP_ACCESS_TOKEN",
  "APP_PUBLIC_HOST",
  "APP_PUBLIC_URL",
  "DATABASE_URL",
  "DATABASE_PROVIDER",
  "COH_APPLICATION_KEY",
  "SCRAPER_TEST_MODE",
  "NODE_ENV",
  "MAX_ITEMS_CAP",
  "MAX_QUERY_COST_USD",
];

const DEFAULT_ENV = {
  DATABASE_URL: "file:./prod.db",
  DATABASE_PROVIDER: "cohesivity",
  SCRAPER_TEST_MODE: "0",
  NODE_ENV: "production",
  MAX_QUERY_COST_USD: "0",
};

function loadDotEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function parseCohesivity(raw) {
  const managementKey =
    raw.match(/coh_management_key[=:\s]+(coh_man_[a-z0-9]+)/i)?.[1] ||
    raw.match(/(coh_man_[a-z0-9]+)/i)?.[1];
  const applicationKey =
    raw.match(/coh_application_key[=:\s]+(coh_app_[a-z0-9]+)/i)?.[1] ||
    raw.match(/(coh_app_[a-z0-9]+)/i)?.[1];
  const tenantId =
    raw.match(/tenant_id[=:\s]+([a-z0-9-]+)/i)?.[1] ||
    raw.match(/tenant[=:\s]+([a-z0-9-]+)/i)?.[1];
  if (!managementKey) {
    throw new Error(
      "Could not find coh_management_key in .cohesivity. Run: npx @cohesivity/init",
    );
  }
  return { managementKey, applicationKey, tenantId };
}

function shouldSkip(relPath) {
  const parts = relPath.split(/[/\\]/);
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return true;
  const name = basename(relPath);
  if (EXCLUDE_FILES.has(name)) return true;
  if (name.startsWith(".env")) return true;
  if (name.endsWith(".db") || name.endsWith(".db-journal")) return true;
  return false;
}

function collectFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = relative(ROOT, abs);
    if (shouldSkip(rel)) continue;
    if (entry.isDirectory()) {
      collectFiles(abs, files);
    } else if (entry.isFile()) {
      files.push({ abs, rel: rel.split("\\").join("/") });
    }
  }
  return files;
}

async function api(method, path, { managementKey, body, formData } = {}) {
  const headers = {
    Authorization: `Bearer ${managementKey}`,
    "User-Agent": "AtlasAgent/1.0 (Cursor)",
  };
  let payload;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: payload,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok && res.status !== 202) {
    throw new Error(
      `${method} ${path} failed (${res.status}): ${typeof json === "object" ? JSON.stringify(json) : text}`,
    );
  }
  return { status: res.status, json };
}

async function main() {
  if (!existsSync(COHESIVITY_FILE)) {
    console.error("Missing .cohesivity. Run first:\n  npx @cohesivity/init");
    process.exit(1);
  }

  const { managementKey, applicationKey, tenantId } = parseCohesivity(
    readFileSync(COHESIVITY_FILE, "utf8"),
  );
  console.log(
    `Using Cohesivity tenant${tenantId ? ` ${tenantId}` : ""} (management key present).`,
  );

  const fileEnv = {
    ...loadDotEnv(join(ROOT, ".env")),
    ...loadDotEnv(join(ROOT, ".env.local")),
  };
  if (applicationKey && !fileEnv.COH_APPLICATION_KEY && !process.env.COH_APPLICATION_KEY) {
    fileEnv.COH_APPLICATION_KEY = applicationKey;
  }

  console.log("Provisioning railway-hosting (idempotent)...");
  const provision = await api("POST", "/api/resources/railway-hosting", {
    managementKey,
  });
  const deploymentUrl =
    provision.json.deployment_url ||
    (tenantId ? `https://${tenantId}.cohesivity.app` : null);
  if (deploymentUrl) console.log(`Deployment URL: ${deploymentUrl}`);
  if (provision.json.already_provisioned) {
    console.log("railway-hosting already provisioned.");
  }

  if (deploymentUrl) {
    try {
      const publicHost = new URL(deploymentUrl).host;
      fileEnv.APP_PUBLIC_URL = deploymentUrl;
      fileEnv.APP_PUBLIC_HOST = publicHost;
      console.log(`Public host for CORS: ${publicHost}`);
    } catch {
      /* ignore */
    }
  }

  console.log("Setting Railway env vars...");
  for (const key of ENV_KEYS) {
    let value =
      process.env[key] ?? fileEnv[key] ?? DEFAULT_ENV[key] ?? undefined;
    // Local sqlite file: URLs are not suitable as-is; use ephemeral prod.db on Railway.
    if (
      key === "DATABASE_URL" &&
      typeof value === "string" &&
      value.startsWith("file:")
    ) {
      value = DEFAULT_ENV.DATABASE_URL;
    }
    if (value === undefined || value === "") {
      if (key === "DATABASE_URL" || key === "SCRAPER_TEST_MODE" || key === "NODE_ENV") {
        // defaults covered above
        continue;
      }
      console.warn(`  skip ${key} (not set in process.env or .env)`);
      continue;
    }
    await api("POST", "/api/railway/env", {
      managementKey,
      body: { key, value: String(value) },
    });
    console.log(`  set ${key}`);
  }

  // Ensure defaults even if missing from env files
  for (const [key, value] of Object.entries(DEFAULT_ENV)) {
    const existing = process.env[key] ?? fileEnv[key];
    if (existing === undefined || existing === "") {
      await api("POST", "/api/railway/env", {
        managementKey,
        body: { key, value },
      });
      console.log(`  set ${key}=${value} (default)`);
    }
  }

  const files = collectFiles(ROOT);
  console.log(`Packing ${files.length} source files for upload...`);

  const form = new FormData();
  for (const { abs, rel } of files) {
    const st = statSync(abs);
    if (st.size > 20 * 1024 * 1024) {
      console.warn(`  skip large file ${rel} (${st.size} bytes)`);
      continue;
    }
    const blob = new Blob([readFileSync(abs)]);
    form.append("files", blob, rel);
  }

  console.log("Deploying (wait=ready)...");
  const deploy = await api("POST", "/api/railway/deploy?wait=ready", {
    managementKey,
    formData: form,
  });

  console.log(JSON.stringify(deploy.json, null, 2));
  if (deploy.json.deployment_url) {
    console.log(`\nLive at: ${deploy.json.deployment_url}`);
  } else if (deploymentUrl) {
    console.log(`\nProvisioned URL: ${deploymentUrl}`);
  }
  if (deploy.json.wait_timed_out) {
    console.warn(
      "Wait timed out; poll logs_url / deployment detail until ready.",
    );
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
