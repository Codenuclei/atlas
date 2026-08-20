import Anthropic from "@anthropic-ai/sdk";
import { AppError } from "@/lib/errors";
import { isTestMode } from "@/lib/utils";

let cached: Anthropic | undefined;

export function hasLiveAnthropicKey() {
  const key = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  return key.length > 20 && key.startsWith("sk-ant-") && !key.includes("test-");
}

export function getAnthropic(): Anthropic {
  if (isTestMode()) {
    throw new AppError(
      "INTERNAL",
      "Live Anthropic client was requested in test mode.",
      500,
    );
  }
  if (!hasLiveAnthropicKey()) {
    throw new AppError(
      "UNAUTHORIZED",
      "ANTHROPIC_API_KEY is missing or still a placeholder. Add a real sk-ant- key to .env.",
      401,
    );
  }
  if (!cached) {
    cached = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      maxRetries: 2,
    });
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
    throw new AppError(
      "UPSTREAM",
      error.message || "Claude request failed.",
      error.status ?? 502,
    );
  }
  throw error;
}

export function resetAnthropicClient() {
  cached = undefined;
}
