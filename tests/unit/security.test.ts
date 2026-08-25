import { describe, expect, it } from "vitest";
import { recordsToCsv, safeExternalUrl } from "@/lib/export";
import { assertApiAccess, assertSameOrigin } from "@/lib/request-security";
import { validatePlan } from "@/lib/ai/planner";
import type { ScrapePlan } from "@/lib/ai/plan-schema";
import { sanitizeForSqliteJson } from "@/lib/normalize";

describe("security boundaries", () => {
  it("rejects dangerous scraped URL schemes", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBe("");
    expect(safeExternalUrl("data:text/html,bad")).toBe("");
    expect(safeExternalUrl("https://example.com/path")).toBe(
      "https://example.com/path",
    );
  });

  it("neutralizes spreadsheet formulas in CSV exports", () => {
    const csv = recordsToCsv([
      {
        sourceType: "company",
        externalId: "1",
        title: "=HYPERLINK(\"https://evil.test\")",
        subtitle: "+cmd",
        url: "https://example.com",
        location: "@payload",
        imageUrl: "",
        raw: {},
      },
    ]);
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).toContain(`'+cmd`);
    expect(csv).toContain(`'@payload`);
  });

  it("sanitizes broken unicode escapes for SQLite JSON", () => {
    const cleaned = sanitizeForSqliteJson({
      caption: "broken \\u12 and null\u0000",
    });
    expect(JSON.stringify(cleaned)).toContain("\\\\u12");
    expect(cleaned.caption).not.toContain("\u0000");
  });

  it("rejects cross-origin mutations", () => {
    const request = new Request("http://localhost:3000/api/plan", {
      headers: { origin: "https://evil.test" },
    });
    expect(() => assertSameOrigin(request)).toThrow(/Cross-origin/);
  });

  it("allows public origin when proxied behind a different upstream host", () => {
    const request = new Request("http://127.0.0.1:8080/api/plan", {
      headers: {
        origin: "https://azure-condor-drafting.cohesivity.app",
        host: "127.0.0.1:8080",
        "x-forwarded-host": "azure-condor-drafting.cohesivity.app",
        "x-forwarded-proto": "https",
      },
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it("allows localhost but blocks remote API access without a token", () => {
    expect(() =>
      assertApiAccess(new Request("http://localhost:3000/api/health")),
    ).not.toThrow();
    expect(() =>
      assertApiAccess(new Request("http://10.0.0.9:3000/api/health")),
    ).toThrow(/Remote API access/);
  });

  it("rejects plans with more than six steps", () => {
    const step = {
      connectorId: "yc-companies",
      params: { query: "fintech", maxItems: 10 },
      dependsOn: [] as string[],
      purpose: "Find companies",
    };
    const plan: ScrapePlan = {
      interpretation: "Find companies",
      intent: "companies",
      expectedResultType: "companies",
      clarificationNeeded: "",
      steps: Array.from({ length: 7 }, () => ({ ...step })),
    };
    expect(() => validatePlan(plan)).toThrow();
  });
});