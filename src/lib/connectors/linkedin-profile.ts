import { z } from "zod";
import { clampMaxItems } from "@/lib/utils";
import { firstText, type ScrapedRecord } from "@/lib/normalize";
import type { Connector } from "@/lib/connectors/types";

export const linkedinProfileSchema = z.object({
  queries: z.array(z.string().min(1).max(300)).max(100).default([]),
  profileScraperMode: z.string().optional(),
});

export type LinkedinProfileInput = z.infer<typeof linkedinProfileSchema>;

export const linkedinProfileConnector: Connector<LinkedinProfileInput> = {
  id: "linkedin-profile",
  label: "LinkedIn profile details",
  sourceType: "profile",
  kind: "detail",
  actorId: "harvestapi/linkedin-profile-scraper",
  usdPerThousand: 4,
  capability:
    "Internal detail connector. Enrich already-resolved LinkedIn profile URLs or public identifiers. Do not plan this as the first step and never ask the user for a URL. Params: queries[] of profile URLs or public IDs.",
  inputSchema: linkedinProfileSchema,
  buildRun(input) {
    const queries = input.queries.slice(0, clampMaxItems(input.queries.length, 25));
    return {
      executor: "apify",
      actorId: "harvestapi/linkedin-profile-scraper",
      maxItems: queries.length,
      input: {
        profileScraperMode:
          input.profileScraperMode ?? "Profile details no email ($4 per 1k)",
        queries,
      },
    };
  },
  normalize(raw): ScrapedRecord {
    const url = firstText(raw.linkedinUrl, raw.url, raw.profileUrl);
    const name = firstText(raw.fullName, raw.name);
    return {
      sourceType: "profile",
      externalId: firstText(raw.id, raw.publicIdentifier, url, name) || "profile",
      title: name || "LinkedIn profile",
      subtitle: firstText(raw.headline, raw.about),
      url,
      location: firstText(raw.location),
      imageUrl: firstText(raw.photo, raw.profilePicture),
      raw,
    };
  },
  costEstimate(input) {
    const itemCount = Math.min(input.queries.length, clampMaxItems(input.queries.length));
    return {
      usd: (itemCount / 1000) * 4,
      itemCount,
      note: "$4 per 1,000 LinkedIn profile details",
    };
  },
};
