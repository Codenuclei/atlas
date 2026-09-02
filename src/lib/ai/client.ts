import Anthropic from "@anthropic-ai/sdk";
import { AppError } from "@/lib/errors";
import { isTestMode } from "@/lib/utils";

let cached: Anthropic | undefined;

const DEFAULT_OPENROUTER_BASE = "https://openrouter.ai/api";

/** Strip trailing slashes and a trailing `/v1` — the Anthropic SDK appends `/v1/messages`. */
export function normalizeOpenRouterBaseURL(raw?: string | null): string {
  let base = (raw?.trim() || DEFAULT_OPENROUTER_BASE).replace(/\/+$/, "");
  if (base.endsWith("/v1")) {
    base = base.slice(0, -"/v1".length).replace(/\/+$/, "");
  }
  return base || DEFAULT_OPENROUTER_BASE;
}

function openRouterKey(): string {
  return process.env.OPENROUTER_API_KEY?.trim() ?? "";
}

function anthropicKey(): string {
  return process.env.ANTHROPIC_API_KEY?.trim() ?? "";
}

function isLiveOpenRouterKey(key: string): boolean {
  return key.length > 20 && key.startsWith("sk-or-") && !key.includes("test-");
}

function isLiveAnthropicDirectKey(key: string): boolean {
  return key.length > 20 && key.startsWith("sk-ant-") && !key.includes("test-");
}

export function hasLiveLlmKey(): boolean {
  return (
    isLiveOpenRouterKey(openRouterKey()) ||
    isLiveAnthropicDirectKey(anthropicKey())
  );
}

/** @deprecated Prefer hasLiveLlmKey — kept as an alias for call-site compatibility. */
export const hasLiveAnthropicKey = hasLiveLlmKey;

export function llmProvider(): "openrouter" | "anthropic" | "none" {
  if (isLiveOpenRouterKey(openRouterKey())) return "openrouter";
  if (isLiveAnthropicDirectKey(anthropicKey())) return "anthropic";
  return "none";
}

export function getAnthropic(): Anthropic {
  if (isTestMode()) {
    throw new AppError(
      "INTERNAL",
      "Live Anthropic client was requested in test mode.",
      500,
    );
  }
  const provider = llmProvider();
  if (provider === "none") {
    throw new AppError(
      "UNAUTHORIZED",
      "OPENROUTER_API_KEY (sk-or-) or ANTHROPIC_API_KEY (sk-ant-) is missing or still a placeholder.",
      401,
    );
  }
  if (!cached) {
    if (provider === "openrouter") {
      cached = new Anthropic({
        apiKey: openRouterKey(),
        baseURL: normalizeOpenRouterBaseURL(process.env.OPENROUTER_BASE_URL),
        maxRetries: 2,
        defaultHeaders: {
          "HTTP-Referer": process.env.APP_PUBLIC_URL || "https://atlas.local",
          "X-Title": "Atlas Research",
        },
      });
    } else {
      cached = new Anthropic({
        apiKey: anthropicKey(),
        maxRetries: 2,
      });
    }
  }
  return cached;
}

export function mapAnthropicError(error: unknown): never {
  if (error instanceof Anthropic.RateLimitError) {
    throw new AppError(
      "RATE_LIMITED",
      "Claude rate limit exceeded after SDK retries.",
      429,
    );
  }
  if (error instanceof Anthropic.AuthenticationError) {
    throw new AppError("UNAUTHORIZED", "Claude rejected the API key.", 401);
  }
  if (error instanceof Anthropic.APIError) {
    const message = error.message || "Claude request failed.";
    if (/credit balance is too low|purchase credits|billing/i.test(message)) {
      const billingHint =
        llmProvider() === "anthropic"
          ? "Add credits at console.anthropic.com (Plans & Billing), then regenerate the brief."
          : "Add credits at https://openrouter.ai/settings/credits, then regenerate the brief.";
      throw new AppError(
        "UPSTREAM",
        `LLM API credits are exhausted. ${billingHint}`,
        402,
      );
    }
    throw new AppError(
      "UPSTREAM",
      message,
      error.status ?? 502,
    );
  }
  throw error;
}

export function resetAnthropicClient() {
  cached = undefined;
}
