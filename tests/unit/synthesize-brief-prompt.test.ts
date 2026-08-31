import { describe, expect, it } from "vitest";
import {
  BRIEF_MAX_TOKENS,
  YC_BRIEF_INSTRUCTIONS,
  scoreResultsSystemPrompt,
  selectYcEvidence,
  synthesisBriefSystemPrompt,
  ycSignals,
} from "@/lib/ai/synthesize";
import {
  expandYcFounders,
  normalizeYcCompany,
} from "@/lib/connectors/yc-companies";
import ycFixture from "../fixtures/yc-company.json";

describe("YC research brief prompt", () => {
  it("requires per-company why / product / founder linkage / how", () => {
    expect(YC_BRIEF_INSTRUCTIONS).toContain("Why included");
    expect(YC_BRIEF_INSTRUCTIONS).toContain("What it does");
    expect(YC_BRIEF_INSTRUCTIONS).toContain("Founder linkage");
    expect(YC_BRIEF_INSTRUCTIONS).toContain("How they got here");
    expect(YC_BRIEF_INSTRUCTIONS).toContain("founder linkage: evidence missing");
  });

  it("keeps core sections and adds pattern sections", () => {
    for (const section of [
      "COMPANIES BY INDUSTRY",
      "BATCH SNAPSHOT",
      "REPEATING PATTERNS",
      "EMERGING / NEW PATTERNS",
      "FOUNDERS TO CONTACT",
      "RESEARCH NOTES",
    ]) {
      expect(YC_BRIEF_INSTRUCTIONS).toContain(section);
    }
  });

  it("keeps honesty rules and density guidance", () => {
    expect(YC_BRIEF_INSTRUCTIONS).toContain("Never invent");
    expect(YC_BRIEF_INSTRUCTIONS).toContain("Founder-profile-only");
    expect(YC_BRIEF_INSTRUCTIONS).toMatch(/16k|20k/);
    expect(YC_BRIEF_INSTRUCTIONS).toMatch(/directory dump/i);
    expect(YC_BRIEF_INSTRUCTIONS).toContain("Company records in evidence");
  });

  it("requires completing all six sections without mid-section cuts", () => {
    expect(YC_BRIEF_INSTRUCTIONS).toContain("LENGTH / COMPLETION");
    expect(YC_BRIEF_INSTRUCTIONS).toContain(
      "Always finish all six section headers",
    );
    expect(YC_BRIEF_INSTRUCTIONS).toContain("Never cut mid-section");
    expect(YC_BRIEF_INSTRUCTIONS).toContain("RESEARCH NOTES must appear");
  });

  it("budgets enough output tokens for dense company+founder briefs", () => {
    expect(BRIEF_MAX_TOKENS).toBeGreaterThanOrEqual(24576);
  });

  it("is wired into both scoring and streaming system prompts", () => {
    expect(synthesisBriefSystemPrompt("yc")).toBe(YC_BRIEF_INSTRUCTIONS);
    expect(scoreResultsSystemPrompt("yc")).toContain("Why included");
    expect(scoreResultsSystemPrompt("yc")).toContain("REPEATING PATTERNS");
    expect(scoreResultsSystemPrompt("yc")).toContain(
      "RESEARCH NOTES must appear",
    );
  });
});

describe("ycSignals / selectYcEvidence", () => {
  it("emits company records with one-liner, website, and YC URL", () => {
    const company = normalizeYcCompany(ycFixture);
    const signal = ycSignals(company);
    expect(signal).toMatchObject({
      recordKind: "company",
      name: "Stripe",
      oneLiner: "Payments infrastructure",
      website: "https://stripe.com",
      ycUrl: "https://www.ycombinator.com/companies/stripe",
      teamSize: 8000,
      status: "Public",
    });
    expect(signal.founders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Patrick Collison" }),
      ]),
    );
  });

  it("links founder signals back to company one-liner and URLs", () => {
    const company = normalizeYcCompany(ycFixture);
    const founder = expandYcFounders(company)[0];
    const signal = ycSignals(founder);
    expect(signal).toMatchObject({
      recordKind: "founder",
      name: "Patrick Collison",
      companyName: "Stripe",
      companyOneLiner: "Payments infrastructure",
      companyWebsite: "https://stripe.com",
      companyYcUrl: "https://www.ycombinator.com/companies/stripe",
    });
  });

  it("keeps companies ahead of founders so profiles cannot displace them", () => {
    const company = normalizeYcCompany(ycFixture);
    const founders = expandYcFounders(company);
    const padded = [
      ...founders,
      ...founders,
      company,
      ...Array.from({ length: 40 }, (_, index) => ({
        ...founders[0],
        externalId: `extra-${index}`,
        title: `Founder ${index}`,
      })),
    ];
    const selected = selectYcEvidence(padded, 10);
    expect(selected[0]?.sourceType).toBe("yc");
    expect(selected[0]?.title).toBe("Stripe");
    expect(selected.some((row) => row.sourceType === "yc")).toBe(true);
  });
});
