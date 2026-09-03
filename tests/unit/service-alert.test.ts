import { describe, expect, it } from "vitest";
import { classifyServiceAlerts } from "@/lib/service-alert";

describe("classifyServiceAlerts", () => {
  it("maps Apify credit exhaustion messages", () => {
    const alerts = classifyServiceAlerts([
      "Apify usage/credits are exhausted (or too low to charge any results). Top up at console.apify.com/billing",
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].service).toBe("Apify");
    expect(alerts[0].title).toBe("Apify");
  });

  it("maps Anthropic billing failures", () => {
    const alerts = classifyServiceAlerts([
      "credit balance is too low to access the Claude API",
    ]);
    expect(alerts[0]?.service).toBe("Anthropic");
  });

  it("maps Cohesivity SQL budget errors", () => {
    const alerts = classifyServiceAlerts(["Cohesivity Postgres error (429)"]);
    expect(alerts[0]?.service).toBe("Cohesivity");
  });

  it("dedupes multiple errors for the same service", () => {
    const alerts = classifyServiceAlerts([
      "Apify rate limit exceeded",
      "Apify rejected the API token",
    ]);
    expect(alerts).toHaveLength(1);
  });
});
