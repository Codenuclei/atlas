import { describe, expect, it } from "vitest";
import {
  YC_ACTOR_ID,
  currentYcBatch,
  enrichYcCompaniesInput,
  expandYcFounders,
  normalizeYcCompany,
  parseYcBatch,
  parseYcIndustry,
  prepareYcActorInput,
  ycCompaniesConnector,
  ycKeywordsFrom,
} from "@/lib/connectors/yc-companies";
import { enrichPlanFromQuery } from "@/lib/ai/planner";
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
  it("sets fullDetails and extractFounders and maps filters", () => {
    const input = prepareYcActorInput({
      query: "fintech startups",
      batch: "Summer 2026",
      industry: "Fintech",
      isHiring: true,
      maxItems: 25,
    });
    expect(input.fullDetails).toBe(true);
    expect(input.extractFounders).toBe(true);
    expect(input.batches).toEqual(["Summer 2026"]);
    expect(input.industries).toEqual(["Fintech"]);
    expect(input.isHiring).toBe(true);
    expect(input.maxResults).toBe(25);
  });

  it("derives batch+industry from user text instead of dumping raw query", () => {
    const actor = prepareYcActorInput(
      {},
      "YC Summer 2026 fintech companies\n\nScope: Y Combinator companies and founders.",
    );
    expect(actor.batches).toEqual(["Summer 2026"]);
    expect(actor.industries).toEqual(["Fintech"]);
    expect(actor.query).toBe("");
    expect(actor.query).not.toMatch(/Scope|YC|2026/i);
  });
});

describe("enrichYcCompaniesInput / ycKeywordsFrom", () => {
  it("fills empty Claude params from the user request", () => {
    const enriched = enrichYcCompaniesInput(
      {},
      "YC Summer 2026 fintech companies",
    );
    expect(enriched).toMatchObject({
      batch: "Summer 2026",
      industry: "Fintech",
    });
    expect(enriched.query).toBeFalsy();
  });

  it("strips Scope lines and season words from keywords", () => {
    expect(
      ycKeywordsFrom(
        "YC Summer 2026 fintech companies\n\nScope: Y Combinator companies and founders.",
      ),
    ).toBe("fintech");
  });
});

describe("enrichPlanFromQuery", () => {
  it("repairs empty yc-companies params before run", () => {
    const plan = enrichPlanFromQuery(
      {
        interpretation: "Find YC fintech",
        intent: "companies",
        expectedResultType: "companies",
        clarificationNeeded: "",
        steps: [
          {
            connectorId: "yc-companies",
            purpose: "Find companies",
            dependsOn: [],
            params: {},
          },
        ],
      },
      "YC Summer 2026 fintech companies",
    );
    expect(plan.steps[0].params).toMatchObject({
      batch: "Summer 2026",
      industry: "Fintech",
    });
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

  it("maps fintech industry aliases", () => {
    expect(parseYcIndustry("YC Summer 2026 fintech")).toBe("Fintech");
  });
});
