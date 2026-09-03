import { describe, expect, it } from "vitest";
import type { ScrapedRecord } from "@/lib/normalize";
import type { BoardRecord } from "@/components/creatives-board";
import { buildYcEvidenceRows } from "@/lib/yc-evidence-rows";

function ycCompany(name: string): BoardRecord {
  const record: ScrapedRecord = {
    sourceType: "yc",
    externalId: name.toLowerCase(),
    title: name,
    subtitle: "Winter 2024 · Education",
    url: `https://www.ycombinator.com/companies/${name.toLowerCase()}`,
    location: "SF",
    imageUrl: "",
    raw: {
      name,
      batch: "Winter 2024",
      industry: "Education",
      oneLiner: "Learning platform",
      website: "https://acme.test",
      ycUrl: `https://www.ycombinator.com/companies/${name.toLowerCase()}`,
      founders: [{ name: "Ada Lovelace", linkedinUrl: "https://linkedin.com/in/ada" }],
    },
    score: 0.82,
  };
  return { record, role: "reference" };
}

describe("buildYcEvidenceRows", () => {
  it("maps company fields and founder names from raw.founders", () => {
    const rows = buildYcEvidenceRows([ycCompany("Acme")]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Acme",
      oneLiner: "Learning platform",
      founders: "Ada Lovelace",
      website: "https://acme.test",
      ycUrl: "https://www.ycombinator.com/companies/acme",
      batch: "Winter 2024",
      industry: "Education",
      score: 0.82,
    });
    expect(rows[0].linkedInUrls).toEqual(["https://linkedin.com/in/ada"]);
  });

  it("merges linked founder profile rows by company name", () => {
    const company = ycCompany("Acme");
    const profile: BoardRecord = {
      record: {
        sourceType: "profile",
        externalId: "ada",
        title: "Grace Hopper",
        subtitle: "Co-Founder · Acme",
        url: "https://linkedin.com/in/grace",
        location: "",
        imageUrl: "",
        raw: {
          researchRole: "yc-founder",
          source: "yc-companies",
          companyName: "Acme",
          companyYcUrl: "https://www.ycombinator.com/companies/acme",
        },
      },
      role: "reference",
    };
    const rows = buildYcEvidenceRows([company, profile]);
    expect(rows[0].founders).toContain("Ada Lovelace");
    expect(rows[0].founders).toContain("Grace Hopper");
    expect(rows[0].linkedInUrls).toContain("https://linkedin.com/in/grace");
  });
});
