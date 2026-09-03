import { describe, expect, it } from "vitest";
import {
  classifyServiceAlerts,
  classifyServiceError,
} from "@/lib/service-errors";

describe("classifyServiceError", () => {
  it("maps Apify credit exhaustion messages", () => {
    const alert = classifyServiceError(
      "Apify usage/credits are exhausted (or too low to charge any results). Top up at console.apify.com/billing",
    );
    expect(alert?.service).toBe("Apify");
    expect(alert?.title).toBe("Apify");
    expect(alert?.tone).toBe("danger");
  });

  it("maps Anthropic billing failures via classifyAnthropicFailure", () => {
    const alert = classifyServiceError(
      "credit balance is too low to access the Claude API",
    );
    expect(alert?.service).toBe("Anthropic");
  });

  it("maps OpenRouter errors", () => {
    const alert = classifyServiceError("OpenRouter rejected the model request");
    expect(alert?.service).toBe("OpenRouter");
  });

  it("maps Cohesivity SQL budget errors", () => {
    const alert = classifyServiceError("Cohesivity Postgres error (429)");
    expect(alert?.service).toBe("Cohesivity");
  });
});

describe("classifyServiceAlerts", () => {
  it("dedupes multiple errors for the same service", () => {
    const alerts = classifyServiceAlerts([
      "Apify rate limit exceeded",
      "Apify rejected the API token",
    ]);
    expect(alerts).toHaveLength(1);
  });
});
