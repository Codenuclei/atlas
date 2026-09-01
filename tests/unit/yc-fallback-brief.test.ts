import { describe, expect, it } from "vitest";
import {
  buildYcFallbackBrief,
  detectIndiaSignals,
  extractPatterns,
  scoreYcCompanyRelevance,
} from "@/lib/ai/yc-fallback-brief";
import { normalizeYcCompany } from "@/lib/connectors/yc-companies";
import type { ScrapedRecord } from "@/lib/normalize";
import ycFixture from "../fixtures/yc-company.json";

function companyFromPartial(
  partial: Record<string, unknown>,
): ScrapedRecord {
  return normalizeYcCompany(partial);
}

const indiaAiCompany = companyFromPartial({
  id: "india-ai-1",
  objectID: "india-ai-1",
  name: "BangaloreLLM",
  slug: "bangalorellm",
  url: "https://www.ycombinator.com/companies/bangalorellm",
  website: "https://bangalorellm.example",
  oneLiner: "AI infrastructure for enterprise LLM ops",
  batch: "Winter 2025",
  industry: "B2B",
  teamSize: 8,
  status: "Active",
  location: "Bangalore, India",
  founders: [
    {
      name: "Aditya Sharma",
      title: "CEO",
      bio: "Ex-IIT Delhi; previously built ML infra in Hyderabad.",
      linkedinUrl: "https://www.linkedin.com/in/aditya-sharma-example",
    },
    {
      name: "Priya Reddy",
      title: "CTO",
      bio: "BITS Pilani alum building developer tools.",
      linkedinUrl: "https://www.linkedin.com/in/priya-reddy-example",
    },
  ],
});

const usFintechCompany = companyFromPartial({
  id: "us-fin-1",
  objectID: "us-fin-1",
  name: "LedgerBay",
  slug: "ledgerbay",
  url: "https://www.ycombinator.com/companies/ledgerbay",
  website: "https://ledgerbay.example",
  oneLiner: "Payments infrastructure for mid-market retailers",
  batch: "Summer 2018",
  industry: "Fintech",
  teamSize: 40,
  status: "Active",
  location: "San Francisco, CA, USA",
  founders: [
    {
      name: "James Miller",
      title: "CEO",
      bio: "Previously at a US payments company.",
      linkedinUrl: "https://www.linkedin.com/in/james-miller-example",
    },
    {
      name: "Sarah Thompson",
      title: "CTO",
      bio: "Built billing systems in Seattle.",
      linkedinUrl: "https://www.linkedin.com/in/sarah-thompson-example",
    },
  ],
});

const marketplaceCompany = companyFromPartial({
  id: "mkt-1",
  objectID: "mkt-1",
  name: "CargoMart",
  slug: "cargomart",
  url: "https://www.ycombinator.com/companies/cargomart",
  website: "https://cargomart.example",
  oneLiner: "B2B marketplace for industrial logistics",
  batch: "Fall 2024",
  industry: "B2B",
  teamSize: 12,
  status: "Active",
  location: "Austin, TX, USA",
  founders: [
    {
      name: "Chris Nguyen",
      title: "CEO",
      bio: "Marketplace operator.",
      linkedinUrl: "https://www.linkedin.com/in/chris-nguyen-example",
    },
    {
      name: "Alex Kim",
      title: "CTO",
      bio: "Infra engineer.",
      linkedinUrl: "https://www.linkedin.com/in/alex-kim-example",
    },
  ],
});

describe("detectIndiaSignals", () => {
  it("flags common South Asian name patterns", () => {
    const signal = detectIndiaSignals({ names: ["Aditya Sharma", "Priya Reddy"] });
    expect(signal.matched).toBe(true);
    expect(signal.caveat).toMatch(/possible India connection/i);
    expect(signal.reasons.some((r) => /name token/i.test(r))).toBe(true);
  });

  it("flags India location / school mentions in bios", () => {
    const signal = detectIndiaSignals({
      names: ["Alex Example"],
      bios: ["Studied at IIT Bombay, lived in Mumbai"],
      locations: ["Bangalore"],
    });
    expect(signal.matched).toBe(true);
    expect(signal.reasons.join(" ")).toMatch(/IIT|Mumbai|Bangalore/i);
  });

  it("does not invent signals for unrelated Western names", () => {
    const signal = detectIndiaSignals({
      names: ["Patrick Collison", "John Collison"],
      bios: ["Co-founder of Stripe in San Francisco"],
      locations: ["San Francisco, CA, USA"],
    });
    expect(signal.matched).toBe(false);
  });
});

describe("scoreYcCompanyRelevance", () => {
  it("ranks India-signal company higher for Indian founders query", () => {
    const query = "Indian founders in AI";
    const indiaScore = scoreYcCompanyRelevance(query, indiaAiCompany);
    const usScore = scoreYcCompanyRelevance(query, usFintechCompany);
    expect(indiaScore.india.matched).toBe(true);
    expect(usScore.india.matched).toBe(false);
    expect(indiaScore.score).toBeGreaterThan(usScore.score);
  });
});

describe("buildYcFallbackBrief", () => {
  it("contains all six section headers", () => {
    const stripe = normalizeYcCompany(ycFixture);
    const brief = buildYcFallbackBrief(
      "Indian founders",
      [indiaAiCompany, usFintechCompany, marketplaceCompany, stripe],
      "credit balance is too low",
    );
    for (const section of [
      "COMPANIES BY INDUSTRY",
      "BATCH SNAPSHOT",
      "REPEATING PATTERNS",
      "EMERGING / NEW PATTERNS",
      "FOUNDERS TO CONTACT",
      "RESEARCH NOTES",
    ]) {
      expect(brief.summary).toContain(section);
    }
    expect(brief.summary).toMatch(/credits are exhausted|credit balance/i);
    expect(brief.summary).toMatch(/not an Apify/i);
    expect(brief.scores.length).toBeGreaterThan(0);
    expect(brief.scores[0]!.score).toBeGreaterThanOrEqual(
      brief.scores[brief.scores.length - 1]!.score,
    );
  });

  it("patterns section cites concrete company names when fixtures suffice", () => {
    const stripe = normalizeYcCompany(ycFixture);
    const brief = buildYcFallbackBrief("YC B2B and fintech companies", [
      indiaAiCompany,
      usFintechCompany,
      marketplaceCompany,
      stripe,
    ]);
    const patterns = extractPatterns([
      scoreYcCompanyRelevance("YC B2B", indiaAiCompany),
      scoreYcCompanyRelevance("YC B2B", usFintechCompany),
      scoreYcCompanyRelevance("YC B2B", marketplaceCompany),
      scoreYcCompanyRelevance("YC B2B", stripe),
    ]);
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect(patterns.some((p) => p.examples.length >= 2)).toBe(true);
    expect(brief.summary).toMatch(/REPEATING PATTERNS[\s\S]*(BangaloreLLM|LedgerBay|CargoMart|Stripe)/);
  });
});
