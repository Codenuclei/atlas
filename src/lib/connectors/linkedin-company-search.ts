import { z } from "zod";
import { clampMaxItems } from "@/lib/utils";
import { firstText, type ScrapedRecord } from "@/lib/normalize";
import type { Connector } from "@/lib/connectors/types";

export const linkedinCompanySearchSchema = z.object({
  searchQuery: z.string().min(1),
  maxItems: z.number().optional(),
  locations: z.array(z.string()).optional(),
  searches: z.array(z.string()).optional(),
});

export type LinkedinCompanySearchInput = z.infer<typeof linkedinCompanySearchSchema>;

export const linkedinCompanySearchConnector: Connector<LinkedinCompanySearchInput> = {
  id: "linkedin-company-search",
  label: "LinkedIn company search",
  sourceType: "company",
  kind: "search",
  actorId: "harvestapi/linkedin-company-search",
  usdPerThousand: 3,
  capability:
    "Search LinkedIn company pages by name, industry, or location. Use when the user asks for companies, startups, or employers. Never ask for a company URL. Params: searchQuery (required), maxItems, locations[], searches[].",
  inputSchema: linkedinCompanySearchSchema,
  buildRun(input) {
    const maxItems = clampMaxItems(input.maxItems);
    return {
      executor: "apify",
      actorId: "harvestapi/linkedin-company-search",
      maxItems,
      input: {
        searchQuery: input.searchQuery,
        searches: input.searches?.length ? input.searches : [input.searchQuery],
        maxItems,
        locations: input.locations ?? [],
      },
    };
  },
  normalize(raw): ScrapedRecord {
    const url = firstText(raw.linkedinUrl, raw.url, raw.companyUrl);
    const name = firstText(raw.name, raw.universalName);
    return {
      sourceType: "company",
      externalId: firstText(raw.id, raw.universalName, url, name) || "company",
      title: name || "LinkedIn company",
      subtitle: firstText(raw.tagline, raw.description, raw.industry),
      url,
      location: firstText(
        raw.location,
        Array.isArray(raw.locations) && raw.locations[0]
          ? firstText(
              (raw.locations[0] as { city?: string }).city,
              (raw.locations[0] as { country?: string }).country,
            )
          : "",
      ),
      imageUrl: firstText(raw.logo, raw.logoUrl, raw.image),
      raw,
    };
  },
  costEstimate(input) {
    const itemCount = clampMaxItems(input.maxItems);
    return {
      usd: (itemCount / 1000) * 3,
      itemCount,
      note: "$3 per 1,000 LinkedIn companies",
    };
  },
};
