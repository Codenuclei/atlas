import { z } from "zod";
import { clampMaxItems } from "@/lib/utils";
import type { Connector } from "@/lib/connectors/types";
import { youtubeContentConnector } from "@/lib/connectors/youtube-content";

export const youtubeContentExamplesSchema = z.object({
  searchQueries: z
    .array(z.string().trim().min(2).max(160))
    .max(6)
    .default([]),
  maxItems: z.number().int().min(1).max(100).default(40),
});

export type YoutubeContentExamplesInput = z.infer<
  typeof youtubeContentExamplesSchema
>;

export const youtubeContentExamplesConnector: Connector<YoutubeContentExamplesInput> =
  {
    id: "youtube-content-examples",
    label: "Aligned YouTube examples",
    sourceType: "youtube",
    kind: "search",
    actorId: "streamers/youtube-scraper",
    usdPerThousand: 2,
    capability:
      "Internal research step. After owned-channel content is collected, search YouTube for multiple external examples aligned with the identified audience and content pillars. searchQueries[] is hydrated internally; maxItems controls the total evidence pool.",
    inputSchema: youtubeContentExamplesSchema,
    buildRun(input) {
      const maxItems = clampMaxItems(input.maxItems, 40);
      return {
        executor: "apify",
        actorId: "streamers/youtube-scraper",
        maxItems,
        input: {
          searchQueries: input.searchQueries,
          startUrls: [],
          maxResults: maxItems,
          maxResultsShorts: 0,
          maxResultStreams: 0,
          sortingOrder: "views",
        },
      };
    },
    normalize(raw) {
      const record = youtubeContentConnector.normalize(raw);
      return {
        ...record,
        subtitle: `Reference example · ${record.subtitle}`,
        raw: { ...raw, researchRole: "reference" },
      };
    },
    costEstimate(input) {
      const itemCount = clampMaxItems(input.maxItems, 40);
      return {
        usd: Math.max(0.05, (itemCount / 1000) * 2),
        itemCount,
        note: "Estimated YouTube reference-research actor usage.",
      };
    },
  };