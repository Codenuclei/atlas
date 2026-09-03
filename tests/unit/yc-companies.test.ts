import { describe, expect, it } from "vitest";
import {
  YC_ACTOR_ID,
  broadenYcCompaniesInput,
  currentYcBatch,
  normalizeYcCompany,
  COHESIVITY_YC_FOUNDER_EXPAND_COMPANY_LIMIT,
  expandYcFounders,
  withExpandedYcFounders,
  ycFounderExpandCompanyLimit,
  parseYcBatch,
  parseYcIndustry,
  prepareYcActorInput,
  recentYcBatches,
  ycBatchesForMonths,
  ycBatchesForYear,
  ycCompaniesConnector,
  ycKeywordsFrom,
} from "@/lib/connectors/yc-companies";
import ycFixture from "../fixtures/yc-company.json";

describe("YC actor id", () => {
  it("uses haketa/ycombinator-companies-scraper", () => {
    expect(YC_ACTOR_ID).toBe("haketa/ycombinator-companies-scraper");
    expect(ycCompaniesConnector.actorId).toBe(
      "haketa/ycombinator-companies-scraper",
    );
  });
});

describe("prepareYcActorInput", () => {
  it("defaults maxRecords to 100 when maxItems is missing", () => {
    expect(prepareYcActorInput({ industry: "Education" }).maxRecords).toBe(100);
  });

  it("clamps maxItems 0 / negative to >= 1 (default 100)", () => {
    expect(prepareYcActorInput({ industry: "Fintech", maxItems: 0 }).maxRecords).toBe(100);
    expect(prepareYcActorInput({ industry: "Fintech", maxItems: -5 }).maxRecords).toBe(100);
    expect(prepareYcActorInput({ industry: "Fintech", maxItems: 50 }).maxRecords).toBe(50);
  });

  it("buildRun never exposes platform maxItems below 1", () => {
    const run = ycCompaniesConnector.buildRun({ industry: "Education", maxItems: 0 });
    expect(run.maxItems).toBeGreaterThanOrEqual(1);
    expect((run.input as { maxRecords: number }).maxRecords).toBeGreaterThanOrEqual(1);
  });

  it("matches the live haketa actor input shape for Education-only search", () => {
    const input = prepareYcActorInput({
      query: "",
      industry: "Education",
      isHiring: false,
      maxItems: 100,
      _orchestrated: true,
    });
    expect(input).toMatchObject({
      query: "",
      batches: [],
      industries: ["Education"],
      regions: [],
      statuses: [],
      stages: [],
      hiringOnly: false,
      topCompaniesOnly: false,
      maxRecords: 100,
      hitsPerPage: 1000,
      requestDelay: 300,
    });
    expect(input).not.toHaveProperty("fullDetails");
    expect(input).not.toHaveProperty("tags");
  });

  it("maps AI-orchestrated filters into the Apify payload", () => {
    const input = prepareYcActorInput({
      query: "",
      batches: ["Summer 2026", "Spring 2026"],
      industry: "Education",
      tags: ["AI", "Education"],
      isHiring: false,
      maxItems: 100,
      _orchestrated: true,
    });
    expect(input.batches).toEqual(["Summer 2026", "Spring 2026"]);
    expect(input.industries).toEqual(["Education"]);
    // Haketa has no tags facet — orthogonal AI tag folds into query.
    expect(input.query).toBe("AI");
    expect(input.maxRecords).toBe(100);
    expect(input.hiringOnly).toBe(false);
    expect(input.topCompaniesOnly).toBe(false);
  });

  it("clears sentence-length free-text instead of sending pitches to Apify", () => {
    const actor = prepareYcActorInput({
      query: "SAVRA is an AI teaching companion for lesson plans",
      industry: "Education",
      batches: ["Fall 2025"],
    });
    expect(actor.query).toBe("");
    expect(actor.industries).toEqual(["Education"]);
    expect(actor.batches).toEqual(["Fall 2025"]);
  });
});

describe("ycKeywordsFrom / season helpers used by AI tools", () => {
  it("strips Scope lines and season words from keywords", () => {
    expect(
      ycKeywordsFrom(
        "YC Summer 2026 fintech companies\n\nScope: Y Combinator companies and founders.",
      ),
    ).toBe("fintech");
  });

  it("lists N recent seasons when the model chooses a count", () => {
    expect(
      recentYcBatches(6, new Date("2026-08-26T12:00:00Z")),
    ).toEqual([
      "Summer 2026",
      "Spring 2026",
      "Winter 2026",
      "Fall 2025",
      "Summer 2025",
      "Spring 2025",
    ]);
  });

  it("lists all seasons for a calendar year when the model asks", () => {
    expect(ycBatchesForYear(2025)).toEqual([
      "Winter 2025",
      "Spring 2025",
      "Summer 2025",
      "Fall 2025",
    ]);
  });

  it("builds Apify JSON for education companies in calendar 2025", () => {
    const input = prepareYcActorInput({
      industry: "Education",
      batches: ycBatchesForYear(2025),
      maxItems: 100,
      isHiring: false,
    });
    expect(input.batches).toEqual([
      "Winter 2025",
      "Spring 2025",
      "Summer 2025",
      "Fall 2025",
    ]);
    expect(input.industries).toEqual(["Education"]);
    expect(input.query).toBe("");
    expect(input.maxRecords).toBe(100);
  });

  it("maps a months lookback into seasons without hardcoding year windows", () => {
    expect(
      ycBatchesForMonths(12, new Date("2026-08-26T12:00:00Z")),
    ).toEqual([
      "Summer 2026",
      "Spring 2026",
      "Winter 2026",
      "Fall 2025",
    ]);
  });
});

describe("normalizeYcCompany", () => {
  it("builds subtitle as batch · industry · oneLiner", () => {
    const record = normalizeYcCompany(ycFixture);
    expect(record.title).toBe("Stripe");
    expect(record.subtitle).toBe(
      "Summer 2009 · Fintech · Payments infrastructure",
    );
    expect(record.sourceType).toBe("yc");
  });

  it("keeps YC directory URL primary and website/oneLiner on raw", () => {
    const record = normalizeYcCompany(ycFixture);
    expect(record.url).toBe("https://www.ycombinator.com/companies/stripe");
    expect(record.raw.website).toBe("https://stripe.com");
    expect(record.raw.ycUrl).toBe(
      "https://www.ycombinator.com/companies/stripe",
    );
    expect(record.raw.oneLiner).toBe("Payments infrastructure");
    expect(record.raw.longDescription).toContain("economic infrastructure");
    expect(record.raw.teamSize).toBe(8000);
    expect(record.raw.status).toBe("Public");
  });

  it("derives YC URL from slug when Apify omits url/ycUrl", () => {
    const record = normalizeYcCompany({
      name: "Ramp",
      slug: "ramp",
      website: "https://ramp.com",
      oneLiner: "Corporate cards",
      batch: "Winter 2020",
      industry: "Fintech",
    });
    expect(record.url).toBe("https://www.ycombinator.com/companies/ramp");
    expect(record.raw.website).toBe("https://ramp.com");
    expect(record.raw.ycUrl).toBe(
      "https://www.ycombinator.com/companies/ramp",
    );
  });
});

describe("expandYcFounders", () => {
  it("produces profile records with LinkedIn URLs from fixture founders", () => {
    const company = normalizeYcCompany(ycFixture);
    const founders = expandYcFounders(company);
    expect(founders).toHaveLength(2);
    expect(founders[0]).toMatchObject({
      sourceType: "profile",
      title: "Patrick Collison",
      url: "https://www.linkedin.com/in/patrick-collison",
    });
    expect(founders[1]).toMatchObject({
      sourceType: "profile",
      title: "John Collison",
      url: "https://www.linkedin.com/in/john-collison",
    });
    expect(founders[0].raw.researchRole).toBe("yc-founder");
    expect(founders[0].raw.linkedinUrl).toContain("linkedin.com/in/");
  });

  it("links founders to company one-liner, website, and YC URL (does not drop company)", () => {
    const company = normalizeYcCompany(ycFixture);
    const founders = expandYcFounders(company);
    expect(company.sourceType).toBe("yc");
    expect(founders[0].raw).toMatchObject({
      companyName: "Stripe",
      companyOneLiner: "Payments infrastructure",
      companyWebsite: "https://stripe.com",
      companyYcUrl: "https://www.ycombinator.com/companies/stripe",
      companyBatch: "Summer 2009",
      companyIndustry: "Fintech",
    });
  });
});

describe("withExpandedYcFounders / cohesivity cap", () => {
  it("expands founders for a capped company count on Cohesivity", () => {
    expect(ycFounderExpandCompanyLimit("cohesivity")).toBe(
      COHESIVITY_YC_FOUNDER_EXPAND_COMPANY_LIMIT,
    );
    expect(COHESIVITY_YC_FOUNDER_EXPAND_COMPANY_LIMIT).toBeGreaterThan(0);
    expect(COHESIVITY_YC_FOUNDER_EXPAND_COMPANY_LIMIT).toBeLessThanOrEqual(100);
    const company = normalizeYcCompany(ycFixture);
    const out = withExpandedYcFounders(
      [company],
      ycFounderExpandCompanyLimit("cohesivity"),
    );
    expect(out.filter((row) => row.sourceType === "yc")).toHaveLength(1);
    expect(out.filter((row) => row.sourceType === "profile")).toHaveLength(2);
    expect(out[1].raw.linkedinUrl).toContain("linkedin.com/in/");
    expect(out[1].url).toContain("linkedin.com/in/");
  });

  it("returns a new array at limit 0 so callers can clear the input safely", () => {
    const company = normalizeYcCompany(ycFixture);
    const input = [company];
    const out = withExpandedYcFounders(input, 0);
    expect(out).not.toBe(input);
    input.length = 0;
    expect(out).toHaveLength(1);
  });

  it("expands founders for prisma / unlimited", () => {
    expect(ycFounderExpandCompanyLimit("prisma")).toBe(Number.POSITIVE_INFINITY);
    const company = normalizeYcCompany(ycFixture);
    const out = withExpandedYcFounders([company], Number.POSITIVE_INFINITY);
    expect(out.length).toBe(1 + expandYcFounders(company).length);
    expect(out.filter((row) => row.sourceType === "profile")).toHaveLength(2);
  });

  it("caps expansion to the first N companies", () => {
    const a = normalizeYcCompany({ ...ycFixture, name: "A", slug: "a", objectID: "a" });
    const b = normalizeYcCompany({ ...ycFixture, name: "B", slug: "b", objectID: "b" });
    const out = withExpandedYcFounders([a, b], 1);
    expect(out.filter((row) => row.sourceType === "yc")).toHaveLength(2);
    expect(out.filter((row) => row.sourceType === "profile")).toHaveLength(2);
    expect(out.filter((row) => row.raw.companyName === "A")).toHaveLength(2);
    expect(out.some((row) => row.raw.companyName === "B" && row.sourceType === "profile")).toBe(
      false,
    );
  });
});

describe("broadenYcCompaniesInput", () => {
  it("swaps Education industry to the Education tag before dropping batches", () => {
    const result = broadenYcCompaniesInput({
      industry: "Education",
      batches: ["Winter 2025", "Spring 2025", "Summer 2025", "Fall 2025"],
      isHiring: false,
      maxItems: 50,
    });
    expect(result).not.toBeNull();
    expect(result?.input.industry).toBeUndefined();
    expect(result?.input.tags).toEqual(["Education"]);
    expect(result?.input.batches).toEqual([
      "Winter 2025",
      "Spring 2025",
      "Summer 2025",
      "Fall 2025",
    ]);
  });

  it("drops batches while keeping industry when no tag swap applies", () => {
    const result = broadenYcCompaniesInput({
      industry: "Fintech",
      batches: ["Winter 2025"],
      maxItems: 50,
    });
    expect(result?.input.batches).toBeUndefined();
    expect(result?.input.industry).toBe("Fintech");
  });

  it("drops stacked AI tag first when Education∩AI is too sparse", () => {
    const result = broadenYcCompaniesInput(
      {
        industry: "Education",
        tags: ["AI"],
        batches: ["Fall 2025", "Summer 2026"],
        maxItems: 50,
      },
      { sparse: true },
    );
    expect(result?.input.tags).toBeUndefined();
    expect(result?.input.industry).toBe("Education");
    expect(result?.input.batches).toEqual(["Fall 2025", "Summer 2026"]);
    expect(result?.notice).toMatch(/Only a few companies matched those tags/i);
  });
});

describe("parseYcBatch / parseYcIndustry / currentYcBatch", () => {
  it('parses "Winter 2024"', () => {
    expect(parseYcBatch("YC companies from Winter 2024")).toBe("Winter 2024");
  });

  it('parses short code "S25"', () => {
    expect(parseYcBatch("YC S25 fintech")).toBe("Summer 2025");
  });

  it('resolves "current batch" from mocked date', () => {
    const july = new Date("2026-07-15T12:00:00Z");
    expect(currentYcBatch(july)).toBe("Summer 2026");
    expect(parseYcBatch("YC current batch founders", july)).toBe("Summer 2026");
  });

  it("maps fintech and education industry aliases", () => {
    expect(parseYcIndustry("YC Summer 2026 fintech")).toBe("Fintech");
    expect(parseYcIndustry("AI teaching lesson plans for teachers")).toBe(
      "Education",
    );
  });
});
