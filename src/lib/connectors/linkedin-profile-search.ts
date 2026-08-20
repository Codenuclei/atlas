import { z } from "zod";
import { clampMaxItems } from "@/lib/utils";
import { firstText, type ScrapedRecord } from "@/lib/normalize";
import type { Connector } from "@/lib/connectors/types";

export const linkedinProfileSearchSchema = z.object({
  searchQuery: z.string().min(1),
  maxItems: z.number().optional(),
  locations: z.array(z.string()).optional(),
  currentCompanies: z.array(z.string()).optional(),
  currentJobTitles: z.array(z.string()).optional(),
  schools: z.array(z.string()).optional(),
});

export type LinkedinProfileSearchInput = z.infer<typeof linkedinProfileSearchSchema>;

export const linkedinProfileSearchConnector: Connector<LinkedinProfileSearchInput> = {
  id: "linkedin-profile-search",
  label: "LinkedIn profile search",
  sourceType: "profile",
  kind: "search",
  actorId: "harvestapi/linkedin-profile-search",
  usdPerThousand: 4,
  capability:
    "Search public LinkedIn people by criteria. Use for founders, employees, or people matching titles, companies, schools, or locations. Never ask the user for a profile URL. Params: searchQuery (required), maxItems, locations[], currentCompanies[], currentJobTitles[], schools[].",
  inputSchema: linkedinProfileSearchSchema,
  buildRun(input) {
    const maxItems = clampMaxItems(input.maxItems);
    return {
      executor: "apify",
      actorId: "harvestapi/linkedin-profile-search",
      maxItems,
      input: {
        searchQuery: input.searchQuery,
        maxItems,
        locations: input.locations ?? [],
        currentCompanies: input.currentCompanies ?? [],
        currentJobTitles: input.currentJobTitles ?? [],
        schools: input.schools ?? [],
      },
    };
  },
  normalize(raw): ScrapedRecord {
    const url = firstText(raw.linkedinUrl, raw.url, raw.profileUrl);
    const name = firstText(raw.fullName, raw.name, raw.firstName && raw.lastName ? `${raw.firstName} ${raw.lastName}` : "");
    return {
      sourceType: "profile",
      externalId: firstText(raw.id, raw.publicIdentifier, url, name) || "profile",
      title: name || "LinkedIn profile",
      subtitle: firstText(raw.headline, raw.occupation, raw.currentCompany),
      url,
      location: firstText(
        raw.location,
        typeof raw.geo === "object" && raw.geo ? (raw.geo as { full?: string }).full : "",
      ),
      imageUrl: firstText(raw.photo, raw.profilePicture, raw.image),
      raw,
    };
  },
  costEstimate(input) {
    const itemCount = clampMaxItems(input.maxItems);
    return {
      usd: (itemCount / 1000) * 4,
      itemCount,
      note: "$4 per 1,000 LinkedIn profiles",
    };
  },
};
