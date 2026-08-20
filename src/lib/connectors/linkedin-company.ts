import { z } from "zod";
import { clampMaxItems } from "@/lib/utils";
import { firstText, type ScrapedRecord } from "@/lib/normalize";
import type { Connector } from "@/lib/connectors/types";

export const linkedinCompanySchema = z.object({
  companies: z.array(z.string().min(1).max(300)).max(100).default([]),
});

export type LinkedinCompanyInput = z.infer<typeof linkedinCompanySchema>;

export const linkedinCompanyConnector: Connector<LinkedinCompanyInput> = {
  id: "linkedin-company",
  label: "LinkedIn company details",
  sourceType: "company",
  kind: "detail",
  actorId: "harvestapi/linkedin-company",
  usdPerThousand: 3,
  capability:
    "Internal detail connector. Enrich already-resolved LinkedIn company URLs or names. Do not plan this as the first step and never ask the user for a URL. Params: companies[] of company URLs or names.",
  inputSchema: linkedinCompanySchema,
  buildRun(input) {
    const companies = input.companies.slice(0, clampMaxItems(input.companies.length, 25));
    return {
      executor: "apify",
      actorId: "harvestapi/linkedin-company",
      maxItems: companies.length,
      input: { companies },
    };
  },
  normalize(raw): ScrapedRecord {
    const url = firstText(raw.linkedinUrl, raw.url);
    const name = firstText(raw.name, raw.universalName);
    const hq = Array.isArray(raw.locations)
      ? (raw.locations as Array<{ city?: string; country?: string; headquarter?: boolean }>).find(
          (item) => item.headquarter,
        ) ?? raw.locations[0]
      : undefined;
    return {
      sourceType: "company",
      externalId: firstText(raw.id, raw.universalName, url, name) || "company",
      title: name || "LinkedIn company",
      subtitle: firstText(raw.tagline, raw.description),
      url,
      location: firstText(
        hq && typeof hq === "object" ? `${hq.city ?? ""} ${hq.country ?? ""}`.trim() : "",
        raw.location,
      ),
      imageUrl: firstText(raw.logo, raw.logoUrl),
      raw,
    };
  },
  costEstimate(input) {
    const itemCount = Math.min(input.companies.length, clampMaxItems(input.companies.length));
    return {
      usd: (itemCount / 1000) * 3,
      itemCount,
      note: "$3 per 1,000 LinkedIn company details",
    };
  },
};
