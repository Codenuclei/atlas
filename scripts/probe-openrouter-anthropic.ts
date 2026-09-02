import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

function loadEnv(path = resolve(process.cwd(), ".env")) {
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnv();

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("OPENROUTER_API_KEY missing");
  process.exit(1);
}

const envBase =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
// Anthropic SDK posts to `/v1/messages`, so OpenRouter needs host without trailing /v1
const fixedBase = envBase.replace(/\/v1\/?$/, "");

type Result = {
  baseURL: string;
  model: string;
  ok: boolean;
  used?: string;
  text?: string;
  stop_reason?: string | null;
  error?: string;
};

async function tryOnce(baseURL: string, model: string): Promise<Result> {
  const client = new Anthropic({
    apiKey,
    baseURL,
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/new-scraper",
      "X-Title": "new-scraper-openrouter-probe",
    },
  });
  console.log(`\n--- baseURL=${baseURL} model=${model} ---`);
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 40,
      messages: [{ role: "user", content: "ping" }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    console.log("ok: true");
    console.log("model used:", res.model ?? model);
    console.log("content text:", text);
    console.log("stop_reason:", res.stop_reason);
    return {
      baseURL,
      model,
      ok: true,
      used: res.model ?? model,
      text,
      stop_reason: res.stop_reason,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const safe = msg
      .replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]")
      .replace(/or-[a-zA-Z0-9_-]+/g, "[REDACTED]");
    const short =
      safe.startsWith("404") && safe.includes("<!DOCTYPE")
        ? "404 HTML Not Found (likely wrong path; SDK appends /v1/messages)"
        : safe.slice(0, 300);
    console.log("ok: false");
    console.log("error:", short);
    return { baseURL, model, ok: false, error: short };
  }
}

async function main() {
  const primary =
    process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4";
  const models = [...new Set([primary, "anthropic/claude-sonnet-5"])];

  console.log("apiKey present:", Boolean(apiKey), "(value not printed)");
  console.log("OPENROUTER_BASE_URL (env):", envBase);
  console.log("fixed baseURL (strip /v1):", fixedBase);
  console.log("note: Anthropic SDK path is POST {baseURL}/v1/messages");

  const results: Result[] = [];
  // 1) as configured (expected double /v1)
  for (const m of models) results.push(await tryOnce(envBase, m));
  // 2) corrected for Anthropic SDK
  if (fixedBase !== envBase) {
    for (const m of models) results.push(await tryOnce(fixedBase, m));
  }

  console.log("\n=== Summary: Messages API ===");
  const working = results.filter((r) => r.ok);
  const failing = results.filter((r) => !r.ok);
  console.log(
    "working model ids:",
    working.length
      ? working.map((r) => `${r.model} @ ${r.baseURL}`).join(" | ")
      : "(none)",
  );
  console.log(
    "failing:",
    failing.length
      ? failing.map((r) => `${r.model} @ ${r.baseURL}`).join(" | ")
      : "(none)",
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
