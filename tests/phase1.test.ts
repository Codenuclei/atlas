import { describe, expect, it } from "vitest";
import { prepareYcActorInput } from "@/lib/connectors/yc-companies";
import { buildYcEvidenceContext } from "@/lib/ai/synthesize";
import {
  companiesForNextPass,
  shouldScheduleProgressivePass,
  YC_BRIEF_PASS_SIZE,
} from "@/lib/ai/progressive-brief";
import {
  DEFAULT_MAX_ITEMS,
  YC_ACTOR_MAX_RECORDS,
  clampMaxItems,
  maxItemsCap,
} from "@/lib/utils";
import type { ScrapedRecord } from "@/lib/normalize";

function ycCompany(name: string, extra: Record<string, unknown> = {}): ScrapedRecord {
  return {
    sourceType: "yc",
    externalId: name.toLowerCase(),
    title: name,
    subtitle: "Winter 2024 · Education",
    url: `https://www.ycombinator.com/companies/${name.toLowerCase()}`,
    location: "San Francisco",
    imageUrl: "",
    raw: {
      name,
      batch: "Winter 2024",
      industry: "Education",
      oneLiner: "Test company",
      website: "https://example.com",
      ycUrl: `https://www.ycombinator.com/companies/${name.toLowerCase()}`,
      founders: [{ name: "Ada Lovelace", linkedinUrl: "https://linkedin.com/in/ada" }],
      tags: ["AI", "Education"],
      apifyInternalBlob: { should: "never appear in evidence" },
      ...extra,
    },
  };
}

describe("prepareYcActorInput limits", () => {
  it("defaults maxRecords to DEFAULT_MAX_ITEMS (500)", () => {
    const actor = prepareYcActorInput({ industry: "Education" });
    expect(actor.maxRecords).toBe(DEFAULT_MAX_ITEMS);
    expect(actor.hitsPerPage).toBe(YC_ACTOR_MAX_RECORDS);
  });

  it("clamps requested maxItems to platform cap and actor ceiling", () => {
    const actor = prepareYcActorInput({ maxItems: 2000, industry: "Education" });
    expect(actor.maxRecords).toBe(Math.min(maxItemsCap(), YC_ACTOR_MAX_RECORDS));
    expect(actor.maxRecords).toBeLessThanOrEqual(YC_ACTOR_MAX_RECORDS);
  });

  it("respects MAX_ITEMS_CAP env via clampMaxItems", () => {
    expect(clampMaxItems(800, DEFAULT_MAX_ITEMS)).toBe(
      Math.min(800, maxItemsCap()),
    );
  });
});

describe("buildYcEvidenceContext", () => {
  it("returns curated fields only — never raw Apify JSON keys", () => {
    const records = [ycCompany("Acme")];
    const ctx = buildYcEvidenceContext(records, "Education startups", 10);
    expect(ctx.query).toBe("Education startups");
    expect(ctx.companies).toHaveLength(1);
    const company = ctx.companies[0];
    expect(company).toMatchObject({
      recordKind: "company",
      name: "Acme",
      batch: "Winter 2024",
      industry: "Education",
      oneLiner: "Test company",
      website: "https://example.com",
    });
    expect(company.tags).toEqual(["AI", "Education"]);
    expect(company.founders?.[0]?.name).toBe("Ada Lovelace");
    expect(JSON.stringify(company)).not.toContain("apifyInternalBlob");
    expect(JSON.stringify(company)).not.toContain("should");
  });
});

describe("progressive brief scheduling", () => {
  it("schedules a pass every YC_BRIEF_PASS_SIZE companies", () => {
    expect(YC_BRIEF_PASS_SIZE).toBe(50);
    expect(shouldScheduleProgressivePass(49, null)).toBe(false);
    expect(shouldScheduleProgressivePass(50, null)).toBe(true);
    expect(
      shouldScheduleProgressivePass(100, {
        passes: [],
        accumulatedSummary: "",
        lastPassCompanyCount: 50,
      }),
    ).toBe(true);
    expect(
      shouldScheduleProgressivePass(75, {
        passes: [],
        accumulatedSummary: "",
        lastPassCompanyCount: 50,
        inProgress: true,
      }),
    ).toBe(false);
  });

  it("slices the next 50 YC companies for each pass", () => {
    const records = Array.from({ length: 120 }, (_, i) =>
      ycCompany(`Co${i + 1}`),
    );
    const first = companiesForNextPass(records, null);
    expect(first).toHaveLength(50);
    expect(first[0].title).toBe("Co1");
    expect(first[49].title).toBe("Co50");

    const second = companiesForNextPass(records, {
      passes: [{ passNumber: 1, itemCountAtPass: 50, companyCount: 50, completedAt: "" }],
      accumulatedSummary: "pass 1",
      lastPassCompanyCount: 50,
    });
    expect(second).toHaveLength(50);
    expect(second[0].title).toBe("Co51");
  });
});
