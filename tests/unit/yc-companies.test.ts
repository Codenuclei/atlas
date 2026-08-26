import { describe, expect, it } from "vitest";
import {
  YC_ACTOR_ID,
  currentYcBatch,
  normalizeYcCompany,
  expandYcFounders,
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
  it("uses apivault_labs/yc-companies-scraper", () => {
    expect(YC_ACTOR_ID).toBe("apivault_labs/yc-companies-scraper");
    expect(ycCompaniesConnector.actorId).toBe(
      "apivault_labs/yc-companies-scraper",
    );
  });
});

describe("prepareYcActorInput", () => {
  it("maps AI-orchestrated filters into the Apify payload", () => {
    const input = prepareYcActorInput({
      query: "",
      batches: ["Summer 2026", "Spring 2026"],
      industry: "Education",
      tags: ["AI", "Education"],
      isHiring: false,
      maxItems: 50,
      _orchestrated: true,
    });
    expect(input.fullDetails).toBe(true);
    expect(input.extractFounders).toBe(true);
    expect(input.batches).toEqual(["Summer 2026", "Spring 2026"]);
    expect(input.industries).toEqual(["Education"]);
    expect(input.tags).toEqual(["AI"]);
    expect(input.query).toBe("");
    expect(input.maxResults).toBe(50);
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
