import { afterEach, describe, expect, it } from "vitest";
import {
  hasLiveLlmKey,
  llmProvider,
  normalizeOpenRouterBaseURL,
  resetAnthropicClient,
} from "@/lib/ai/client";

describe("normalizeOpenRouterBaseURL", () => {
  it("defaults to OpenRouter api root without /v1", () => {
    expect(normalizeOpenRouterBaseURL()).toBe("https://openrouter.ai/api");
    expect(normalizeOpenRouterBaseURL("")).toBe("https://openrouter.ai/api");
    expect(normalizeOpenRouterBaseURL(null)).toBe("https://openrouter.ai/api");
  });

  it("strips a trailing /v1 so the SDK can append /v1/messages", () => {
    expect(normalizeOpenRouterBaseURL("https://openrouter.ai/api/v1")).toBe(
      "https://openrouter.ai/api",
    );
    expect(normalizeOpenRouterBaseURL("https://openrouter.ai/api/v1/")).toBe(
      "https://openrouter.ai/api",
    );
  });

  it("trims trailing slashes without removing a non-v1 path", () => {
    expect(normalizeOpenRouterBaseURL("https://openrouter.ai/api/")).toBe(
      "https://openrouter.ai/api",
    );
  });
});

describe("llm key selection", () => {
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    resetAnthropicClient();
    process.env.OPENROUTER_API_KEY = "sk-or-v-test-placeholder-not-live";
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  });

  it("treats sk-or-v-test placeholders as non-live", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v-test-placeholder-not-live";
    delete process.env.ANTHROPIC_API_KEY;
    expect(hasLiveLlmKey()).toBe(false);
    expect(llmProvider()).toBe("none");
  });

  it("prefers a live OpenRouter key over Anthropic", () => {
    process.env.OPENROUTER_API_KEY =
      "sk-or-v-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.ANTHROPIC_API_KEY =
      "sk-ant-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(hasLiveLlmKey()).toBe(true);
    expect(llmProvider()).toBe("openrouter");
  });

  it("falls back to a live Anthropic key when OpenRouter is absent", () => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.ANTHROPIC_API_KEY =
      "sk-ant-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(hasLiveLlmKey()).toBe(true);
    expect(llmProvider()).toBe("anthropic");
  });
});
