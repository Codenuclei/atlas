import { z } from "zod";
import { clampMaxItems } from "@/lib/utils";
import { firstText, type ScrapedRecord } from "@/lib/normalize";
import type { Connector } from "@/lib/connectors/types";

export const ycCompaniesSchema = z.object({
  query: z.string().optional(),
  batch: z.string().optional(),
  industry: z.string().optional(),
  isHiring: z.boolean().optional(),
  maxItems: z.number().optional(),
});

export type YcCompaniesInput = z.infer<typeof ycCompaniesSchema>;

const STOP_WORDS =
  /\b(yc|y combinator|ycombinator|companies|company|startups?|startup|hiring|hire|hired|looking|find|show|list|get|the|and|for|with|that|who|went|through|from|into|in|on|at|of|to|a|an)\b/gi;

const INDUSTRY_ALIASES: Array<[RegExp, string]> = [
  [/\bfintech\b/i, "Fintech"],
  [/\bhealth ?care\b|\bbiotech\b/i, "Healthcare"],
  [/\bconsumer\b/i, "Consumer"],
  [/\beducation\b|\bedtech\b/i, "Education"],
  [/\bclimate\b/i, "Industrials"],
  [/\bb2b\b/i, "B2B"],
];

export function prepareYcActorInput(input: YcCompaniesInput) {
  const raw = input.query ?? "";
  const keywords = raw.replace(STOP_WORDS, " ").replace(/\s+/g, " ").trim();
  const inferredIndustry =
    input.industry ||
    INDUSTRY_ALIASES.find(([pattern]) => pattern.test(`${raw} ${keywords}`))?.[1];
  const hiring =
    input.isHiring ??
    /\b(hiring|hire|hired|jobs?|roles?|openings?)\b/i.test(raw);
  const maxItems = clampMaxItems(input.maxItems, 50);

  return {
    query: keywords,
    batches: input.batch ? [input.batch] : [],
    industries: inferredIndustry ? [inferredIndustry] : [],
    hiringOnly: hiring,
    maxRecords: maxItems,
  };
}

export const ycCompaniesConnector: Connector<YcCompaniesInput> = {
  id: "yc-companies",
  label: "Y Combinator companies",
  sourceType: "yc",
  kind: "search",
  actorId: "haketa/ycombinator-companies-scraper",
  usdPerThousand: 0,
  capability:
    "Search YC companies via Apify actor haketa/ycombinator-companies-scraper. Put SHORT keywords in query (e.g. fintech, AI), never the full user sentence. Set isHiring true when they mention hiring. Set industry when they name one (Fintech, Healthcare, B2B, Consumer). Default maxItems to 50.",
  inputSchema: ycCompaniesSchema,
  buildRun(input) {
    const actorInput = prepareYcActorInput(input);
    return {
      executor: "apify",
      actorId: "haketa/ycombinator-companies-scraper",
      maxItems: actorInput.maxRecords,
      input: actorInput,
    };
  },
  normalize(raw): ScrapedRecord {
    const slug = firstText(raw.slug, raw.objectID);
    return {
      sourceType: "yc",
      externalId:
        firstText(raw.companyId, raw.id, raw.objectID, slug, raw.name) || "yc",
      title: firstText(raw.name) || "YC company",
      subtitle: firstText(
        raw.oneLiner,
        raw.one_liner,
        raw.description,
        raw.longDescription,
        raw.industry,
      ),
      url:
        firstText(raw.ycProfileUrl, raw.ycUrl, raw.url) ||
        (slug
          ? `https://www.ycombinator.com/companies/${slug}`
          : firstText(raw.website)),
      location: firstText(raw.location, raw.all_locations),
      imageUrl: firstText(raw.logoUrl, raw.small_logo_thumb_url, raw.logo),
      raw,
    };
  },
  costEstimate(input) {
    const actorInput = prepareYcActorInput(input);
    return {
      usd: 0,
      itemCount: actorInput.maxRecords,
      note: `YC via Apify · query "${actorInput.query || "all"}"${actorInput.hiringOnly ? " · hiring only" : ""}`,
    };
  },
};
